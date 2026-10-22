// ============ التصفح بلوحة المفاتيح السفلية (للمستخدمين والمشرفين) ============
import { Markup } from 'telegraf';
import { bot, db, ok, isAdmin, safe, esc, getNode, children, getSetting } from '../core.js';
import { view } from '../views.js';
import { sendFile } from './files.js';
import { redeemInvite } from './panel.js';
import { legacyId } from '../layout.js';
import { WELCOME, BACK_LABEL, MAIN_LABEL, ADMIN_LABEL } from '../config.js';

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

/* ---------- مكان المستخدم الحالي ---------- */
const cur = new Map(); // userId -> nodeId (0 = الرئيسية)
async function getCur(ctx) {
  const id = ctx.from.id;
  if (cur.has(id)) return cur.get(id);
  const { data } = await db.from('users').select('cur_node').eq('id', id).maybeSingle();
  const v = Number(data?.cur_node) || 0;
  cur.set(id, v);
  return v;
}
async function setCur(ctx, v) {
  cur.set(ctx.from.id, v);
  await safe(db.from('users').update({ cur_node: v || null }).eq('id', ctx.from.id));
}

/* ---------- لوحة المفاتيح ---------- */
async function keyboardFor(ctx, nodeId) {
  const admin = isAdmin(ctx);
  const hid = admin ? null : await legacyId(); // المجلد القديم للمشرف فقط
  const kids = (await children(nodeId || null)).filter((k) => k.id !== hid);
  const rows = kids.map((k) => [k.name.trim()]);
  if (nodeId) rows.push([BACK_LABEL, MAIN_LABEL]);
  if (admin) rows.push([ADMIN_LABEL]);
  return { kb: Markup.keyboard(rows).resize(), hasKids: kids.length > 0 };
}

/* ---------- إرسال ملفات المجلد ---------- */
async function sendFiles(ctx, files) {
  if (isAdmin(ctx)) {
    for (const f of files.slice(0, 15)) await safe(sendFile(ctx, f)); // بطاقات مع أزرار الإدارة
    if (files.length > 15) await ctx.reply(`… و${files.length - 15} ملف آخر. استخدم «${ADMIN_LABEL}» لعرضها كاملة.`);
    return;
  }
  const docs = files.filter((f) => f.kind !== 'video');
  const vids = files.filter((f) => f.kind === 'video');
  for (let i = 0; i < docs.length; i += 10) {
    const chunk = docs.slice(i, i + 10);
    if (chunk.length === 1) { await safe(sendFile(ctx, chunk[0])); continue; }
    try {
      await ctx.replyWithMediaGroup(chunk.map((f) => ({ type: 'document', media: f.file_id, caption: f.title.slice(0, 1000) })));
    } catch {
      for (const f of chunk) await safe(sendFile(ctx, f));
    }
  }
  for (const v of vids) await safe(sendFile(ctx, v));
}

/* ---------- فتح مجلد ---------- */
export async function openNode(ctx, nodeId = 0) {
  const node = nodeId ? await getNode(nodeId) : null;
  const id = node?.id || 0;
  await setCur(ctx, id);

  let files = [];
  if (id) {
    files = ok(await db.from('files').select('*').eq('node_id', id)).data || [];
    files.sort((a, b) => collator.compare(a.title, b.title));
  }
  const { kb, hasKids } = await keyboardFor(ctx, id);
  let text = node ? esc(node.name) : WELCOME;
  if (node && !hasKids && !files.length) text += '\n\n<i>لا يوجد محتوى هنا بعد.</i>';
  await ctx.reply(text, { parse_mode: 'HTML', ...kb });
  if (files.length) await sendFiles(ctx, files.slice(0, 100));
}

// يعيد لوحة المفاتيح بعد رسائل force_reply (التي تُخفيها)
export async function restoreKeyboard(ctx, text = '✅ تم') {
  const { kb } = await keyboardFor(ctx, await getCur(ctx));
  await safe(ctx.reply(text, kb));
}

/* ---------- /start ---------- */
bot.start(async (ctx) => {
  await db.from('users').upsert({ id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name });
  if (ctx.payload && (await redeemInvite(ctx))) return openNode(ctx, 0);
  await openNode(ctx, 0);
});

/* ---------- معالجة ضغطات لوحة المفاتيح ---------- */
export async function handleNav(ctx, text) {
  const t = text.trim();
  const admin = isAdmin(ctx);
  const here = await getCur(ctx);

  if (t === ADMIN_LABEL) {
    if (!admin) return false;
    await view(ctx, here); // واجهة الإدارة (إضافة/رفع/نقل/حذف) للمجلد الحالي
    return true;
  }
  if (t === MAIN_LABEL) { await openNode(ctx, 0); return true; }
  if (t === BACK_LABEL) {
    const node = here ? await getNode(here) : null;
    await openNode(ctx, node?.parent_id || 0);
    return true;
  }

  const hid = admin ? null : await legacyId();
  const hit = (await children(here || null)).find((k) => k.name.trim() === t && k.id !== hid);
  if (!hit) {
    // لوحة مفاتيح قديمة (بعد إعادة تشغيل أو تعديل القوائم)؟ نعيده للرئيسية بدل البحث
    const { data } = await db.from('nodes').select('id').eq('name', t).limit(1);
    if (data?.length) {
      await ctx.reply('⚠️ تم تحديث القوائم، عدنا للقائمة الرئيسية.');
      await openNode(ctx, 0);
      return true;
    }
    return false; // ليس زراً: يُعامل كبحث
  }

  if (!here && hit.name.includes('تواصل معنا')) {
    await ctx.reply((await getSetting('contact')) || 'لم تُضف معلومات التواصل بعد.');
    return true;
  }
  await openNode(ctx, hit.id);
  return true;
}
