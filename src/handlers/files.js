// ============ جانب المستخدم: البدء، التنقل، إرسال الملفات ============
import { Markup } from 'telegraf';
import { bot, db, isAdmin, getNode, getFile, crumbs } from '../core.js';
import { view } from '../views.js';
import { redeemInvite } from './panel.js';

export const fileKb = (id) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل العنوان', `rnf:${id}`), Markup.button.callback('🔀 نقل', `mvf:${id}`)],
    [Markup.button.callback('🗑 حذف', `delf:${id}`)],
  ]);

export async function fileCaption(f, admin) {
  if (!admin) return f.title;
  return `${f.title}\n📍 ${await crumbs(await getNode(f.node_id))}\n🆔 #${f.id}`;
}

async function sendFile(ctx, f) {
  const admin = isAdmin(ctx);
  const extra = { caption: await fileCaption(f, admin), ...(admin ? fileKb(f.id) : {}) };
  return f.kind === 'video' ? ctx.replyWithVideo(f.file_id, extra) : ctx.replyWithDocument(f.file_id, extra);
}

bot.start(async (ctx) => {
  await db.from('users').upsert({ id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name });
  if (ctx.payload && (await redeemInvite(ctx))) return;
  await view(ctx, 0);
});

bot.action(/^n:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await view(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
});

bot.action(/^f:(\d+)$/, async (ctx) => {
  const f = await getFile(ctx.match[1]);
  if (!f) return ctx.answerCbQuery('الملف غير موجود', { show_alert: true });
  await ctx.answerCbQuery('جارٍ الإرسال...');
  await sendFile(ctx, f);
});
