// ============ /merge: حذف «تلخيص» و«شروحات فيديو» ونقل محتواهما إلى «مقررات» ============
import { Markup } from 'telegraf';
import { bot, db, ok, isAdmin, adminAct, safe, esc } from '../core.js';
import { mergePlan } from '../planner.js';

async function all(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data } = ok(await db.from(table).select(cols).order('id').range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
async function load() {
  const nodes = await all('nodes', 'id,parent_id,name');
  const fc = new Map();
  (await all('files', 'id,node_id')).forEach((f) => fc.set(f.node_id, (fc.get(f.node_id) || 0) + 1));
  return mergePlan(nodes, fc);
}

bot.command('merge', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const items = await load();
  if (!items.length) return ctx.reply('لا توجد مجلدات «تلخيص» أو «شروحات فيديو».');
  const files = items.reduce((a, i) => a + i.files, 0);
  await ctx.reply(
    `🧹 <b>دمج المجلدات</b>\n\n• مجلدات ستُحذف: <b>${items.length}</b> («تلخيص» و«شروحات فيديو»)\n• ملفات ستُنقل إلى «مقررات»: <b>${files}</b>\n• «امتحانات» و«مقررات» لا تتغير.\n\nلا يُحذف أي ملف، فقط المجلدات الفارغة بعد النقل.`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✅ نفّذ', 'mrg:yes'), Markup.button.callback('❌ إلغاء', 'mrg:no')]]) }
  );
});

adminAct('mrg:no', async (ctx) => { await ctx.answerCbQuery('أُلغي'); await safe(ctx.deleteMessage()); });

adminAct('mrg:yes', async (ctx) => {
  await ctx.answerCbQuery('جارٍ التنفيذ…');
  await safe(ctx.editMessageText('⏳ جارٍ الدمج…'));
  let moved = 0, deleted = 0; const failed = [];
  for (const it of await load()) {
    try {
      let target = it.target;
      if (!target) { // مادة بلا «مقررات»: ننشئها
        target = ok(await db.from('nodes').insert({ parent_id: it.parent, name: '📚 مقررات', position: 0 }).select().single()).data.id;
      }
      ok(await db.from('files').update({ node_id: target }).eq('node_id', it.id));
      ok(await db.from('nodes').update({ parent_id: target }).eq('parent_id', it.id));
      const { count } = await db.from('files').select('*', { count: 'exact', head: true }).eq('node_id', it.id);
      if (count) throw new Error('بقيت ملفات');           // أمان: لا نحذف مجلداً فيه ملفات
      ok(await db.from('nodes').delete().eq('id', it.id));
      moved += it.files; deleted++;
    } catch (e) { failed.push(`${it.name}: ${e.message}`); }
  }
  let t = `✅ <b>تم</b>\n🗑 مجلدات محذوفة: <b>${deleted}</b>\n📄 ملفات نُقلت إلى «مقررات»: <b>${moved}</b>`;
  if (failed.length) t += `\n\n❌ تعذّر:\n${failed.slice(0, 5).map(esc).join('\n')}`;
  await ctx.reply(t, { parse_mode: 'HTML' });
});
