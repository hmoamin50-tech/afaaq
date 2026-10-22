// ============ /classify: نقل المحتوى القديم إلى الأقسام الجديدة ============
// ينقل مجلدات المواد (مع أقسامها وملفاتها) بتغيير parent_id فقط. لا حذف ولا إعادة رفع.
import { Markup } from 'telegraf';
import { bot, db, ok, isAdmin, adminAct, esc, nextPos, safe } from '../core.js';
import { planFrom, clean } from '../planner.js';

async function all(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data } = ok(await db.from(table).select(cols).order('id').range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function load(mode) {
  const nodes = await all('nodes', 'id,parent_id,name');
  const fc = new Map();
  (await all('files', 'id,node_id')).forEach((f) => fc.set(f.node_id, (fc.get(f.node_id) || 0) + 1));
  return { nodes, plan: planFrom(nodes, fc, mode) };
}

function previewText(plan) {
  const mv = plan.items.filter((i) => i.mode === 'move');
  const cl = plan.items.filter((i) => i.mode === 'clone');
  const g = new Map();
  mv.forEach((i) => g.set(i.dest, [(g.get(i.dest)?.[0] || 0) + 1, (g.get(i.dest)?.[1] || 0) + i.files]));
  let t = '🗂 <b>خطة التصنيف</b>\n\n';
  for (const [d, [n, f]] of g) t += `• ${esc(d)}\n   ${n} مادة — ${f} ملف\n`;
  if (cl.length)
    t += `\n📑 المستوى المشترك (الأول): يُنقل لمدنية، ويمكن <b>نسخه</b> لكهرباء وميكانيكا: ${cl.length} مادة (${cl.reduce((a, i) => a + i.files, 0)} ملف إضافي، نفس الملفات بلا إعادة رفع).\n`;
  if (plan.skipped.length) t += `\n⚠️ سيُترك في القديم:\n${plan.skipped.slice(0, 10).map((s) => '– ' + esc(s)).join('\n')}\n`;
  t += '\nلا يُحذف شيء. اختر:';
  return t;
}

bot.command('classify', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { plan } = await load('all');
  if (plan.error) return ctx.reply('❌ ' + plan.error);
  if (!plan.items.length) return ctx.reply('لا يوجد محتوى قديم قابل للتصنيف.');
  await ctx.reply(previewText(plan), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ نفّذ — المشترك لكل الأقسام الثلاثة', 'cls:all')],
      [Markup.button.callback('✅ نفّذ — المشترك لمدنية فقط', 'cls:one')],
      [Markup.button.callback('❌ إلغاء', 'cls:no')],
    ]),
  });
});

async function cloneTree(srcId, parentId, name, byParent, position) {
  const { data: n } = ok(await db.from('nodes').insert({ parent_id: parentId, name, position }).select().single());
  const { data: files } = ok(await db.from('files').select('title,kind,file_id,file_unique_id,file_size').eq('node_id', srcId));
  if (files.length) ok(await db.from('files').insert(files.map((f) => ({ ...f, node_id: n.id }))));
  let p = 1;
  for (const k of byParent.get(srcId) || []) await cloneTree(k.id, n.id, k.name, byParent, p++);
}

adminAct('cls:no', async (ctx) => { await ctx.answerCbQuery('أُلغي'); await safe(ctx.deleteMessage()); });

adminAct(/^cls:(all|one)$/, async (ctx) => {
  await ctx.answerCbQuery('جارٍ التنفيذ…');
  await safe(ctx.editMessageText('⏳ جارٍ نقل الملفات، لا تغلق المحادثة…'));
  const { nodes, plan } = await load(ctx.match[1]);
  if (plan.error) return ctx.reply('❌ ' + plan.error);

  const byParent = new Map();
  nodes.forEach((n) => (byParent.get(n.parent_id) || byParent.set(n.parent_id, []).get(n.parent_id)).push(n));
  const pos = new Map(); // موضع تالٍ لكل فصل وجهة
  const nextIn = async (id) => { const v = pos.get(id) ?? (await nextPos(id)); pos.set(id, v + 1); return v; };

  let moved = 0, cloned = 0, files = 0, failed = [];
  for (const it of plan.items) {
    try {
      const src = nodes.find((n) => n.id === it.id);
      if (it.mode === 'clone') {
        await cloneTree(src.id, it.destSem, src.name, byParent, await nextIn(it.destSem));
        cloned++;
      } else {
        ok(await db.from('nodes').update({ parent_id: it.destSem, name: clean(src.name), position: await nextIn(it.destSem) }).eq('id', src.id));
        moved++; files += it.files;
      }
    } catch (e) { failed.push(`${it.name}: ${e.message}`); }
  }
  let t = `✅ <b>تم</b>\n\n📘 مواد منقولة: <b>${moved}</b> (${files} ملف)`;
  if (cloned) t += `\n📑 مواد منسوخة للأقسام المشتركة: <b>${cloned}</b>`;
  if (failed.length) t += `\n\n❌ تعذّر:\n${failed.slice(0, 5).map(esc).join('\n')}`;
  t += '\n\nراجع القوائم بـ /start. ما بقي في «الملفات القديمة» هو مجلدات فارغة يمكنك حذفها.';
  await ctx.reply(t, { parse_mode: 'HTML' });
});
