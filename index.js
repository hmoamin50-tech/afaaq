import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const {
  BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_KEY, // service_role key
  DATABASE_URL, // رابط Postgres (Session pooler) لإنشاء الجداول تلقائياً
  ADMIN_IDS = '',
  WEBHOOK_SECRET = 'change-me-please',
  RENDER_EXTERNAL_HOSTNAME,
  PORT = 3000,
} = process.env;

const ADMINS = new Set(ADMIN_IDS.split(',').map((s) => Number(s.trim())).filter(Boolean));
const isAdmin = (ctx) => ADMINS.has(ctx.from?.id);
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const PAGE = 8;
const ok = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r;
};

const WELCOME =
  '👋 أهلاً بك في\n\n📚 *مجموعة آفاق*\nمكتبة طلاب كلية الهندسة — جامعة كسلا\n\nاختر من القائمة، أو اكتب اسم ملف للبحث عنه:';

// التفرعات التلقائية
const SUBJECT_SECTIONS = ['📚 مقررات', '📝 تلخيص', '🎬 شروحات فيديو', '🧪 امتحانات'];
const LEVEL_CHILDREN = ['📅 الفصل الدراسي الأول', '📅 الفصل الدراسي الثاني'];
const PREFIX = { f: '📁 ', s: '📘 ', l: '🎓 ' };

/* ================= helpers ================= */
const safe = async (p) => {
  try { return await p; } catch (e) {
    if (!String(e.message).includes('not modified')) console.error(e.message);
  }
};

const getNode = async (id) => ok(await db.from('nodes').select('*').eq('id', id).maybeSingle()).data;
const getFile = async (id) => ok(await db.from('files').select('*').eq('id', id).maybeSingle()).data;

async function children(parentId) {
  let q = db.from('nodes').select('*').order('position').order('id');
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  return ok(await q).data || [];
}

async function crumbs(node) {
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

// kind: f = مجلد عادي | s = مادة (4 تفرعات) | l = مستوى (فصلان)
async function createNode(parentId, name, kind) {
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

async function swap(node, dir) {
  const sibs = await children(node.parent_id);
  const i = sibs.findIndex((s) => s.id === node.id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return false;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  await Promise.all(sibs.map((s, k) => db.from('nodes').update({ position: k + 1 }).eq('id', s.id)));
  return true;
}

// حالة المشرف: upload | move_file | move_node
const getState = async (id) => (await db.from('admin_state').select('*').eq('admin_id', id).maybeSingle()).data;
const setState = (id, mode, target) => db.from('admin_state').upsert({ admin_id: id, mode, target_id: target });
const clearState = (id) => db.from('admin_state').delete().eq('admin_id', id);

async function show(ctx, text, kb) {
  const extra = { parse_mode: 'Markdown', ...kb };
  if (ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, extra); }
    catch (e) { if (String(e.message).includes('not modified')) return; }
  }
  return ctx.reply(text, extra);
}

const forceReply = (ctx, text) =>
  ctx.reply(text, { reply_markup: { force_reply: true, selective: true } });

/* ================= main view ================= */
async function view(ctx, nodeId = 0, page = 0) {
  const admin = isAdmin(ctx);
  const st = admin ? await getState(ctx.from.id) : null;
  const node = nodeId ? await getNode(nodeId) : null;
  const id = node?.id ?? 0;

  const kids = await children(id || null);
  const rows = [];
  for (let i = 0; i < kids.length; i += 2)
    rows.push(kids.slice(i, i + 2).map((k) => Markup.button.callback(k.name.slice(0, 32), `n:${k.id}:0`)));

  let total = 0;
  if (id) {
    const { data, count } = await db
      .from('files')
      .select('id,title,kind', { count: 'exact' })
      .eq('node_id', id)
      .order('id')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    total = count || 0;
    (data || []).forEach((f) =>
      rows.push([Markup.button.callback(`${f.kind === 'video' ? '🎬' : '📄'} ${f.title.slice(0, 50)}`, `f:${f.id}`)])
    );
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `n:${id}:${page - 1}`));
    if ((page + 1) * PAGE < total) nav.push(Markup.button.callback('التالي ▶️', `n:${id}:${page + 1}`));
    if (nav.length) rows.push(nav);
  }

  let banner = '';
  if (admin) {
    if (st?.mode?.startsWith('move_')) {
      banner = '\n\n🔀 *وضع النقل:* تصفّح إلى المكان الجديد ثم اضغط «انقل إلى هنا».';
      rows.push([Markup.button.callback('📥 انقل إلى هنا', `mvhere:${id}`)]);
      rows.push([Markup.button.callback('❌ إلغاء النقل', 'mvcancel')]);
    } else {
      const r = [Markup.button.callback('➕ إضافة', `add:${id}`)];
      if (id) r.push(Markup.button.callback('📤 رفع ملفات', `up:${id}`));
      rows.push(r);
      if (id) rows.push([Markup.button.callback('⚙️ إدارة هذا المجلد', `mg:${id}`)]);
      if (st?.mode === 'upload' && st.target_id === id) {
        banner = '\n\n📤 *وضع الرفع مفعّل:* أرسل الملفات/الفيديوهات الآن لإضافتها هنا.';
        rows.push([Markup.button.callback('✅ إنهاء الرفع', 'upend')]);
      }
    }
  }

  if (node) {
    const nav = [];
    if (node.parent_id) nav.push(Markup.button.callback('🔙 رجوع', `n:${node.parent_id}:0`));
    nav.push(Markup.button.callback('🏠 الرئيسية', 'n:0:0'));
    rows.push(nav);
  }

  let text = node ? `📍 ${await crumbs(node)}` : WELCOME;
  if (!kids.length && !total) {
    text += admin
      ? '\n\n_فارغ — استخدم ➕ إضافة أو 📤 رفع ملفات._'
      : '\n\n_لا يوجد محتوى هنا بعد._';
  }
  await show(ctx, text + banner, Markup.inlineKeyboard(rows));
}

/* ================= user side ================= */
bot.start(async (ctx) => {
  await db.from('users').upsert({ id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name });
  await view(ctx, 0);
});

bot.action(/^n:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await view(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
});

const fileKb = (id) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل العنوان', `rnf:${id}`), Markup.button.callback('🔀 نقل', `mvf:${id}`)],
    [Markup.button.callback('🗑 حذف', `delf:${id}`)],
  ]);

async function sendFile(ctx, f) {
  const admin = isAdmin(ctx);
  const node = admin ? await getNode(f.node_id) : null;
  const extra = admin
    ? { caption: `${f.title}\n📍 ${await crumbs(node)}\n🆔 #${f.id}`, ...fileKb(f.id) }
    : { caption: f.title };
  return f.kind === 'video' ? ctx.replyWithVideo(f.file_id, extra) : ctx.replyWithDocument(f.file_id, extra);
}

bot.action(/^f:(\d+)$/, async (ctx) => {
  const f = await getFile(ctx.match[1]);
  if (!f) return ctx.answerCbQuery('الملف غير موجود', { show_alert: true });
  await ctx.answerCbQuery('جارٍ الإرسال...');
  await sendFile(ctx, f);
});

/* ================= admin actions ================= */
const adminAct = (re, fn) =>
  bot.action(re, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('للمشرف فقط', { show_alert: true });
    return fn(ctx);
  });

// ---- إضافة ----
adminAct(/^add:(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCbQuery();
  await safe(ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
    [Markup.button.callback('📘 مادة (تفرعات تلقائية)', `addk:${id}:s`)],
    [Markup.button.callback('🎓 مستوى (فصلان تلقائياً)', `addk:${id}:l`)],
    [Markup.button.callback('📁 مجلد عادي (تخصص/أي شيء)', `addk:${id}:f`)],
    [Markup.button.callback('↩️ إلغاء', `n:${id}:0`)],
  ]).reply_markup));
});

adminAct(/^addk:(\d+):([fsl])$/, async (ctx) => {
  const [, id, k] = ctx.match;
  await ctx.answerCbQuery();
  const label = { s: 'المادة (ستُنشأ مقررات/تلخيص/فيديو/امتحانات تلقائياً)', l: 'المستوى (سيُنشأ الفصلان تلقائياً)', f: 'المجلد' }[k];
  await forceReply(ctx, `✏️ أرسل اسم ${label}\n(رد على هذه الرسالة)\n\n🔖 add:${id}:${k}`);
});

// ---- رفع ----
adminAct(/^up:(\d+)$/, async (ctx) => {
  await setState(ctx.from.id, 'upload', Number(ctx.match[1]));
  await ctx.answerCbQuery('وضع الرفع مفعّل');
  await view(ctx, Number(ctx.match[1]));
});
adminAct('upend', async (ctx) => {
  const st = await getState(ctx.from.id);
  await clearState(ctx.from.id);
  await ctx.answerCbQuery('تم إنهاء الرفع ✅');
  await view(ctx, st?.target_id || 0);
});

// ---- إدارة مجلد ----
adminAct(/^mg:(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  const node = await getNode(id);
  if (!node) return ctx.answerCbQuery('غير موجود');
  await ctx.answerCbQuery();
  await show(ctx, `⚙️ إدارة:\n${await crumbs(node)}`, Markup.inlineKeyboard([
    [Markup.button.callback('✏️ إعادة تسمية', `rnn:${id}`)],
    [Markup.button.callback('⬆️ تقديم', `nup:${id}`), Markup.button.callback('⬇️ تأخير', `ndn:${id}`)],
    [Markup.button.callback('🔀 نقل', `mvn:${id}`), Markup.button.callback('🗑 حذف', `deln:${id}`)],
    [Markup.button.callback('🔙 رجوع', `n:${id}:0`)],
  ]));
});

adminAct(/^rnn:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await forceReply(ctx, `✏️ أرسل الاسم الجديد (رد على هذه الرسالة)\n\n🔖 rnn:${ctx.match[1]}`);
});

for (const [re, dir] of [[/^nup:(\d+)$/, -1], [/^ndn:(\d+)$/, 1]]) {
  adminAct(re, async (ctx) => {
    const node = await getNode(ctx.match[1]);
    if (!node) return ctx.answerCbQuery('غير موجود');
    const ok = await swap(node, dir);
    await ctx.answerCbQuery(ok ? 'تم ✅' : dir < 0 ? 'هو الأول بالفعل' : 'هو الأخير بالفعل');
  });
}

adminAct(/^deln:(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  const node = await getNode(id);
  if (!node) return ctx.answerCbQuery('غير موجود');
  await ctx.answerCbQuery();
  await show(ctx, `⚠️ حذف «${node.name}» وكل ما بداخله من مجلدات وملفات؟`, Markup.inlineKeyboard([
    [Markup.button.callback('✅ نعم، احذف', `delnok:${id}`), Markup.button.callback('↩️ إلغاء', `mg:${id}`)],
  ]));
});
adminAct(/^delnok:(\d+)$/, async (ctx) => {
  const node = await getNode(ctx.match[1]);
  if (!node) return ctx.answerCbQuery('غير موجود');
  await db.from('nodes').delete().eq('id', node.id); // cascade
  await ctx.answerCbQuery('تم الحذف 🗑');
  await view(ctx, node.parent_id || 0);
});

// ---- نقل (ملفات + مجلدات) ----
adminAct(/^mvn:(\d+)$/, async (ctx) => {
  const node = await getNode(ctx.match[1]);
  if (!node) return ctx.answerCbQuery('غير موجود');
  await setState(ctx.from.id, 'move_node', node.id);
  await ctx.answerCbQuery('اختر الوجهة');
  await view(ctx, node.parent_id || 0);
});
adminAct(/^mvf:(\d+)$/, async (ctx) => {
  const f = await getFile(ctx.match[1]);
  if (!f) return ctx.answerCbQuery('غير موجود');
  await setState(ctx.from.id, 'move_file', f.id);
  await ctx.answerCbQuery('اختر الوجهة');
  await view(ctx, f.node_id);
});
adminAct('mvcancel', async (ctx) => {
  await clearState(ctx.from.id);
  await ctx.answerCbQuery('أُلغي النقل');
  await view(ctx, 0);
});
adminAct(/^mvhere:(\d+)$/, async (ctx) => {
  const dest = Number(ctx.match[1]);
  const st = await getState(ctx.from.id);
  if (!st?.mode?.startsWith('move_')) return ctx.answerCbQuery('لا يوجد نقل نشط');

  if (st.mode === 'move_file') {
    if (!dest) return ctx.answerCbQuery('لا يمكن وضع ملف في الصفحة الرئيسية', { show_alert: true });
    await db.from('files').update({ node_id: dest }).eq('id', st.target_id);
  } else {
    // منع نقل مجلد داخل نفسه أو داخل أحد أبنائه
    let cur = dest ? await getNode(dest) : null;
    while (cur) {
      if (cur.id === st.target_id)
        return ctx.answerCbQuery('لا يمكن نقل المجلد داخل نفسه', { show_alert: true });
      cur = cur.parent_id ? await getNode(cur.parent_id) : null;
    }
    await db.from('nodes').update({ parent_id: dest || null, position: await nextPos(dest) }).eq('id', st.target_id);
  }
  await clearState(ctx.from.id);
  await ctx.answerCbQuery('تم النقل ✅');
  await view(ctx, dest);
});

// ---- أزرار الملف ----
adminAct(/^rnf:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await forceReply(ctx, `✏️ أرسل العنوان الجديد للملف (رد على هذه الرسالة)\n\n🔖 rnf:${ctx.match[1]}`);
});
adminAct(/^delf:(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCbQuery();
  await safe(ctx.editMessageReplyMarkup(Markup.inlineKeyboard([[
    Markup.button.callback('✅ نعم، احذف', `delfok:${id}`),
    Markup.button.callback('↩️ إلغاء', `fcancel:${id}`),
  ]]).reply_markup));
});
adminAct(/^fcancel:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await safe(ctx.editMessageReplyMarkup(fileKb(ctx.match[1]).reply_markup));
});
adminAct(/^delfok:(\d+)$/, async (ctx) => {
  await db.from('files').delete().eq('id', ctx.match[1]);
  await ctx.answerCbQuery('تم الحذف 🗑');
  await safe(ctx.editMessageCaption('🗑 تم حذف الملف'));
});

/* ================= رفع الملفات ================= */
bot.on(['document', 'video'], async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('رفع الملفات للمشرف فقط.');
  const st = await getState(ctx.from.id);
  if (st?.mode !== 'upload')
    return ctx.reply('افتح المجلد المطلوب ثم اضغط «📤 رفع ملفات» أولاً.');

  const m = ctx.message;
  const d = m.document || m.video;
  const kind = m.video ? 'video' : 'document';
  const title = (m.caption || d.file_name || (kind === 'video' ? 'فيديو' : 'ملف'))
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .slice(0, 100);

  const { error } = await db.from('files').insert({
    node_id: st.target_id, title, kind, file_id: d.file_id, file_unique_id: d.file_unique_id, file_size: d.file_size,
  });
  if (error) return ctx.reply('❌ ' + error.message);
  const node = await getNode(st.target_id);
  await ctx.reply(`✅ أُضيف: ${title}\n📍 ${await crumbs(node)}`);
});

/* ================= أوامر ================= */
bot.command('cancel', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await clearState(ctx.from.id);
  ctx.reply('تم إلغاء الوضع الحالي.');
});

bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const c = (t) => db.from(t).select('*', { count: 'exact', head: true });
  const [u, f, n] = await Promise.all([c('users'), c('files'), c('nodes')]);
  ctx.reply(`👥 المستخدمون: ${u.count}\n📄 الملفات: ${f.count}\n📁 المجلدات: ${n.count}`);
});

/* ================= نص: ردود المشرف + بحث ================= */
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const m = ctx.message.reply_to_message?.text?.match(/🔖 (add|rnn|rnf):(\d+)(?::([fsl]))?/);
  if (isAdmin(ctx) && m) {
    const [, act, idStr, kind] = m;
    const id = Number(idStr);
    if (act === 'add') {
      await createNode(id, text, kind);
      await ctx.reply('✅ تمت الإضافة');
      return view(ctx, id);
    }
    if (act === 'rnn') {
      await db.from('nodes').update({ name: text.slice(0, 60) }).eq('id', id);
      await ctx.reply('✅ تم تغيير الاسم');
      return view(ctx, id);
    }
    if (act === 'rnf') {
      await db.from('files').update({ title: text.slice(0, 100) }).eq('id', id);
      return ctx.reply('✅ تم تعديل العنوان');
    }
  }

  const q = text.replace(/[%_,()]/g, ' ').slice(0, 60);
  const { data } = await db.from('files').select('id,title,kind').ilike('title', `%${q}%`).limit(15);
  if (!data?.length) return ctx.reply('لا نتائج. جرّب كلمة أخرى أو /start');
  ctx.reply(
    `🔎 نتائج البحث (${data.length}):`,
    Markup.inlineKeyboard(
      data.map((f) => [Markup.button.callback(`${f.kind === 'video' ? '🎬' : '📄'} ${f.title.slice(0, 50)}`, `f:${f.id}`)])
    )
  );
});

bot.catch(async (err, ctx) => {
  console.error('Bot error:', err);
  if (ctx && isAdmin(ctx)) await safe(ctx.reply('❌ خطأ: ' + (err.message || err)));
});

/* ================= إنشاء القاعدة تلقائياً ================= */
const SCHEMA_SQL = `
create table if not exists nodes (
  id bigserial primary key,
  parent_id bigint references nodes(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz default now()
);
create index if not exists nodes_parent_idx on nodes(parent_id);

create table if not exists files (
  id bigserial primary key,
  node_id bigint not null references nodes(id) on delete cascade,
  title text not null,
  kind text not null default 'document',
  file_id text not null,
  file_unique_id text,
  file_size bigint,
  created_at timestamptz default now()
);
create index if not exists files_node_idx on files(node_id);

create table if not exists admin_state (
  admin_id bigint primary key,
  mode text,
  target_id bigint
);

create table if not exists users (
  id bigint primary key,
  username text,
  first_name text,
  joined_at timestamptz default now()
);

alter table nodes enable row level security;
alter table files enable row level security;
alter table admin_state enable row level security;
alter table users enable row level security;
`;

async function migrate() {
  if (!DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL غير موجود — لن يتم إنشاء الجداول تلقائياً.');
    return;
  }
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(SCHEMA_SQL);

    // بيانات أولية: فقط إذا كانت الشجرة فارغة تماماً
    const { rows } = await client.query('select count(*)::int as c from nodes');
    if (rows[0].c === 0) {
      const lvl = await client.query(
        "insert into nodes (parent_id, name, position) values (null, $1, 1) returning id",
        ['🎓 المستوى الأول']
      );
      for (const [i, name] of LEVEL_CHILDREN.entries())
        await client.query('insert into nodes (parent_id, name, position) values ($1, $2, $3)', [lvl.rows[0].id, name, i + 1]);
      console.log('✅ تمت إضافة المستوى الأول وفصليه');
    }
    await client.query("notify pgrst, 'reload schema'");
    console.log('✅ قاعدة البيانات جاهزة');
  } catch (e) {
    console.error('❌ فشل إنشاء القاعدة:', e.message);
  } finally {
    await client.end().catch(() => {});
  }
}
await migrate();

/* ================= تشغيل ================= */
if (RENDER_EXTERNAL_HOSTNAME) {
  const app = express();
  app.get('/', (_, res) => res.send('OK'));
  app.use(await bot.createWebhook({
    domain: RENDER_EXTERNAL_HOSTNAME,
    path: '/tg',
    secret_token: WEBHOOK_SECRET,
  }));
  app.listen(PORT, () => console.log('Webhook server on', PORT));
} else {
  bot.launch();
  console.log('Polling mode (local)');
}
process.once('SIGTERM', () => bot.stop('SIGTERM'));
