// ============ رفع الملفات ============
// رسالة حالة واحدة تبقى دائماً أسفل المحادثة وتُحدَّث مع كل ملف،
// وتُعالَج الملفات المتزامنة بالتتابع حتى لا تتداخل.
import { Markup } from 'telegraf';
import { bot, db, isAdmin, safe, esc, getNode, crumbs, getState } from '../core.js';

const queues = new Map();   // adminId -> Promise
const sessions = new Map(); // adminId -> { target, count, dup, statusId }

const enqueue = (id, fn) => {
  const p = (queues.get(id) || Promise.resolve()).then(fn).catch((e) => console.error('upload:', e.message));
  queues.set(id, p);
  return p;
};
export const resetSession = (adminId) => sessions.delete(adminId);

bot.on(['document', 'video'], (ctx) =>
  enqueue(ctx.from.id, async () => {
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

    let s = sessions.get(ctx.from.id);
    if (!s || s.target !== st.target_id) {
      s = { target: st.target_id, count: 0, dup: 0, statusId: null };
      sessions.set(ctx.from.id, s);
    }

    // منع التكرار داخل نفس المجلد
    const { data: same } = await db.from('files').select('id')
      .eq('node_id', st.target_id).eq('file_unique_id', d.file_unique_id).limit(1);
    if (same?.length) {
      s.dup++;
    } else {
      const { error } = await db.from('files').insert({
        node_id: st.target_id, title, kind, file_id: d.file_id,
        file_unique_id: d.file_unique_id, file_size: d.file_size,
      });
      if (error) return ctx.reply('❌ ' + error.message);
      s.count++;
    }

    const node = await getNode(st.target_id);
    const text =
      `✅ أُضيف <b>${s.count}</b> ملف` +
      (s.dup ? `\n⚠️ تم تجاهل ${s.dup} مكرر` : '') +
      `\n📍 ${esc(await crumbs(node))}\n📄 آخر ملف: ${esc(title)}` +
      `\n\nأرسل المزيد أو اضغط «إنهاء الرفع».`;

    if (s.statusId) await safe(ctx.telegram.deleteMessage(ctx.chat.id, s.statusId));
    const sent = await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('✅ إنهاء الرفع', 'upend')]]),
    });
    s.statusId = sent.message_id;
  })
);
