// ============ النصوص: ردود المشرف + البحث + الأوامر ============
import { Markup } from 'telegraf';
import { bot, db, isAdmin, isOwner, safe, getNode, getFile, createNode, clearState, addAdmin } from '../core.js';
import { adminsView, syncCommands } from './panel.js';
import { view, fileIcon, refreshView } from '../views.js';
import { fileCaption, fileKb } from './files.js';
import { PREFIX } from '../config.js';

bot.command('cancel', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await clearState(ctx.from.id);
  ctx.reply('تم إلغاء الوضع الحالي.');
});

// ردود المشرف على رسائل الطلب (add / rnn / rnf) ثم تنظيف المحادثة
async function handleAdminReply(ctx, text, m) {
  const [, act, idStr, kind, msgStr] = m;
  const id = Number(idStr);
  const msgId = msgStr ? Number(msgStr) : undefined;

  if (act === 'add') {
    if (kind === 'l' && id !== 0) {
      await ctx.reply('🚫 لا يمكن إضافة مستوى داخل مستوى. أضفه من الصفحة الرئيسية.');
    } else {
      const names = text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30);
      for (const n of names) await createNode(id, n, kind);
      await view(ctx, id, 0, msgId);
    }
  } else if (act === 'adm') {
    if (isOwner(ctx)) {
      const fwd = ctx.message.forward_origin?.sender_user || ctx.message.forward_from;
      const uid = fwd?.id || Number(text.replace(/\D/g, ''));
      if (uid) {
        try {
          await addAdmin(uid, fwd?.first_name || null, ctx.from.id);
          await syncCommands();
        } catch (e) {
          await ctx.reply('❌ ' + e.message);
        }
      } else await ctx.reply('❌ أرسل رقم المعرّف (ID) أو حوّل رسالة من الشخص.');
      await adminsView(ctx, msgId);
    }
  } else if (act === 'rnn') {
    const node = await getNode(id);
    const pre = Object.values(PREFIX).find((p) => node?.name.startsWith(p)) || ''; // نحافظ على أيقونة النوع
    await db.from('nodes').update({ name: pre + text.slice(0, 60) }).eq('id', id);
    await view(ctx, id, 0, msgId);
  } else if (act === 'rnf') {
    await db.from('files').update({ title: text.slice(0, 100) }).eq('id', id);
    const f = await getFile(id);
    if (f && msgId)
      await safe(ctx.telegram.editMessageCaption(ctx.chat.id, msgId, undefined, await fileCaption(f, true), {
        reply_markup: fileKb(id).reply_markup,
      }));
    if (f) await safe(refreshView(ctx, f.node_id)); // يظهر العنوان الجديد في القائمة
  }

  // حذف رسالة الطلب + رد المشرف
  await safe(ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.reply_to_message.message_id));
  await safe(ctx.deleteMessage());
}

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const m = ctx.message.reply_to_message?.text?.match(/🔖 (add|rnn|rnf|adm):(\d+)(?::([fsl]))?(?::(\d+))?/);
  if (isAdmin(ctx) && m) return handleAdminReply(ctx, text, m);

  // بحث
  const q = text.replace(/[%_,()]/g, ' ').slice(0, 60);
  const { data } = await db.from('files').select('id,title,kind').ilike('title', `%${q}%`).limit(15);
  if (!data?.length) return ctx.reply('لا نتائج. جرّب كلمة أخرى أو /start');
  ctx.reply(
    `🔎 نتائج البحث (${data.length}):`,
    Markup.inlineKeyboard(
      data.map((f) => [Markup.button.callback(`${fileIcon(f)} ${f.title.slice(0, 50)}`, `f:${f.id}`)])
    )
  );
});
