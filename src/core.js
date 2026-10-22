// ============ قاعدة البيانات + البوت + دوال مشتركة ============
import { createClient } from '@supabase/supabase-js';
import { Telegraf } from 'telegraf';
import { migrate } from './migrate.js';
import { BOT_TOKEN, SB_URL, SB_KEY, ADMINS, PREFIX, SUBJECT_SECTIONS, LEVEL_CHILDREN } from './config.js';

export const db = createClient(SB_URL, SB_KEY);
export const bot = new Telegraf(BOT_TOKEN);

// المالكون (من ADMIN_IDS) + المشرفون المضافون من داخل البوت (جدول admins)
const extraAdmins = new Set();
export const isOwner = (ctx) => ADMINS.has(ctx.from?.id);
export const isAdmin = (ctx) => ADMINS.has(ctx.from?.id) || extraAdmins.has(ctx.from?.id);

export async function loadAdmins() {
  const { data, error } = await db.from('admins').select('*').order('created_at');
  if (error) { console.error('admins:', error.message); return []; }
  extraAdmins.clear();
  data.forEach((a) => extraAdmins.add(Number(a.id)));
  return data;
}
export async function addAdmin(id, name, by) {
  const row = { id, name: name || null, added_by: by || null };
  let { error } = await db.from('admins').upsert(row);
  if (error) {
    // الجدول غير موجود غالباً: ننشئه تلقائياً ثم نعيد المحاولة مرة واحدة
    const fixed = await migrate();
    if (fixed) {
      await new Promise((r) => setTimeout(r, 2000)); // مهلة لتحديث ذاكرة Supabase
      ({ error } = await db.from('admins').upsert(row));
    }
  }
  if (error)
    throw new Error(
      'تعذّر حفظ المشرف: ' + error.message +
      '\nشغّل ملف schema.sql في Supabase > SQL Editor أو اضبط DATABASE_URL.'
    );
  extraAdmins.add(Number(id));
}
export async function removeAdmin(id) {
  ok(await db.from('admins').delete().eq('id', id));
  extraAdmins.delete(Number(id));
}

export const adminAct = (re, fn) =>
  bot.action(re, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('للمشرف فقط', { show_alert: true });
    return fn(ctx);
  });
export const ownerAct = (re, fn) =>
  bot.action(re, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('للمالك فقط', { show_alert: true });
    return fn(ctx);
  });

export const ok = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r;
};

export const safe = async (p) => {
  try { return await p; } catch (e) {
    if (!String(e.message).includes('not modified')) console.error(e.message);
  }
};

export const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- الشجرة ---------- */
export const getNode = async (id) => ok(await db.from('nodes').select('*').eq('id', id).maybeSingle()).data;
export const getFile = async (id) => ok(await db.from('files').select('*').eq('id', id).maybeSingle()).data;

export async function children(parentId) {
  let q = db.from('nodes').select('*').order('position').order('id');
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  return ok(await q).data || [];
}

export async function crumbs(node) {
  const names = [];
  let cur = node;
  while (cur) {
    names.unshift(cur.name);
    cur = cur.parent_id ? await getNode(cur.parent_id) : null;
  }
  return names.join(' › ');
}

async function nextPos(parentId) {
  let q = db.from('nodes').select('position').order('position', { ascending: false }).limit(1);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data } = ok(await q);
  return (data?.[0]?.position ?? 0) + 1;
}
export { nextPos };

// kind: f = مجلد عادي | s = مادة (4 تفرعات) | l = مستوى (فصلان)
export async function createNode(parentId, name, kind) {
  const { data: n } = ok(await db
    .from('nodes')
    .insert({ parent_id: parentId || null, name: (PREFIX[kind] || '') + name.slice(0, 60), position: await nextPos(parentId) })
    .select()
    .single());
  const kids = kind === 's' ? SUBJECT_SECTIONS : kind === 'l' ? LEVEL_CHILDREN : [];
  if (kids.length)
    ok(await db.from('nodes').insert(kids.map((k, i) => ({ parent_id: n.id, name: k, position: i + 1 }))));
  return n;
}

export async function swap(node, dir) {
  const sibs = await children(node.parent_id);
  const i = sibs.findIndex((s) => s.id === node.id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return false;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  await Promise.all(sibs.map((s, k) => db.from('nodes').update({ position: k + 1 }).eq('id', s.id)));
  return true;
}

/* ---------- حالة المشرف: upload | move_file | move_node ---------- */
export const getState = async (id) => (await db.from('admin_state').select('*').eq('admin_id', id).maybeSingle()).data;
export const setState = (id, mode, target) => db.from('admin_state').upsert({ admin_id: id, mode, target_id: target });
export const clearState = (id) => db.from('admin_state').delete().eq('admin_id', id);

/* ---------- الرسائل ---------- */
// يعدّل رسالة موجودة (msgId أو رسالة الضغطة) بدل إرسال رسالة جديدة
// آخر قائمة مجلد معروضة لكل محادثة، لتحديثها تلقائياً بعد أي تغيير
export const lastView = new Map(); // chatId -> { msgId, nodeId, page }

// يرجع رقم الرسالة التي عُرض فيها النص
export async function show(ctx, text, kb, msgId) {
  const extra = { parse_mode: 'HTML', ...kb };
  lastView.delete(ctx.chat.id); // أي عرض آخر يُبطل التتبع؛ view() يعيد تسجيله
  const target = msgId || ctx.callbackQuery?.message?.message_id;
  try {
    if (target) {
      await ctx.telegram.editMessageText(ctx.chat.id, target, undefined, text, extra);
      return target;
    }
  } catch (e) {
    if (String(e.message).includes('not modified')) return target;
  }
  return (await ctx.reply(text, extra)).message_id;
}

// يطلب نصاً من المشرف، ويحفظ رقم الرسالة الأصلية داخل الوسم ليُعدَّل لاحقاً
export function forceReply(ctx, text, tag) {
  const msgId = ctx.callbackQuery?.message?.message_id;
  return ctx.reply(`${text}\n\n🔖 ${tag}${msgId ? ':' + msgId : ''}`, {
    reply_markup: { force_reply: true, selective: true },
  });
}

/* ---------- إعدادات نصية بسيطة (مثل نص «تواصل معنا») ---------- */
export async function getSetting(key) {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return error ? null : data?.value ?? null;
}
export const setSetting = async (key, value) => ok(await db.from('settings').upsert({ key, value }));
