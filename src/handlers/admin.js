// ============ أدوات المشرف: إضافة، إدارة، نقل، حذف ============
import { Markup } from 'telegraf';
import {
  adminAct, db, safe, esc, getNode, getFile, children, crumbs, nextPos, swap,
  getState, setState, clearState, show, forceReply,
} from '../core.js';
import { view } from '../views.js';
import { fileKb } from './files.js';
import { resetSession } from './upload.js';
import { PREFIX } from '../config.js';


/* ---------- إضافة ---------- */
adminAct(/^add:(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCbQuery();
  // خيار «مستوى» يظهر في الصفحة الرئيسية فقط (قبل الدخول إلى أي مستوى)
  const rows = [[Markup.button.callback('📘 مادة (تفرعات تلقائية)', `addk:${id}:s`)]];
  if (id === '0') rows.push([Markup.button.callback('🎓 مستوى (فصلان تلقائياً)', `addk:${id}:l`)]);
  rows.push([Markup.button.callback('📁 مجلد عادي (تخصص/أي شيء)', `addk:${id}:f`)]);
  rows.push([Markup.button.callback('↩️ إلغاء', `n:${id}:0`)]);
  await safe(ctx.editMessageReplyMarkup(Markup.inlineKeyboard(rows).reply_markup));
});

adminAct(/^addk:(\d+):([fsl])$/, async (ctx) => {
  const [, id, k] = ctx.match;
  if (k === 'l' && id !== '0')
    return ctx.answerCbQuery('🚫 لا يمكن إضافة مستوى داخل مستوى — المستويات من الصفحة الرئيسية فقط', { show_alert: true });
  await ctx.answerCbQuery();
  const label = {
    s: 'المادة (ستُنشأ مقررات/تلخيص/فيديو/امتحانات تلقائياً)',
    l: 'المستوى (سيُنشأ الفصلان تلقائياً)',
    f: 'المجلد',
  }[k];
  await forceReply(ctx, `✏️ أرسل اسم ${label}\n(يمكنك إرسال عدة أسماء، كل اسم في سطر)\n(رد على هذه الرسالة)`, `add:${id}:${k}`);
});

/* ---------- رفع ---------- */
adminAct(/^up:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await setState(ctx.from.id, 'upload', id);
  resetSession(ctx.from.id);
  await ctx.answerCbQuery('وضع الرفع مفعّل');
  await view(ctx, id);
});

adminAct('upend', async (ctx) => {
  const st = await getState(ctx.from.id);
  await clearState(ctx.from.id);
  resetSession(ctx.from.id);
  await ctx.answerCbQuery('تم إنهاء الرفع ✅');
  await view(ctx, st?.target_id || 0); // يحوّل رسالة الحالة إلى عرض المجلد
});

/* ---------- إدارة مجلد ---------- */
async function manageView(ctx, node) {
  const sibs = await children(node.parent_id);
  const pos = sibs.findIndex((s) => s.id === node.id) + 1;
  await show(
    ctx,
    `⚙️ <b>إدارة</b>\n${esc(await crumbs(node))}\n\n🔢 الترتيب: ${pos} من ${sibs.length}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✏️ إعادة تسمية', `rnn:${node.id}`)],
      [Markup.button.callback('⬆️ تقديم', `nup:${node.id}`), Markup.button.callback('⬇️ تأخير', `ndn:${node.id}`)],
      [Markup.button.callback('🔀 نقل', `mvn:${node.id}`), Markup.button.callback('🗑 حذف', `deln:${node.id}`)],
      [Markup.button.callback('🔙 رجوع', `n:${node.id}:0`)],
    ])
  );
}

adminAct(/^mg:(\d+)$/, async (ctx) => {
  const node = await getNode(ctx.match[1]);
  if (!node) return ctx.answerCbQuery('غير موجود');
  await ctx.answerCbQuery();
  await manageView(ctx, node);
});

adminAct(/^rnn:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await forceReply(ctx, '✏️ أرسل الاسم الجديد (رد على هذه الرسالة)', `rnn:${ctx.match[1]}`);
});

for (const [re, dir] of [[/^nup:(\d+)$/, -1], [/^ndn:(\d+)$/, 1]]) {
  adminAct(re, async (ctx) => {
    const node = await getNode(ctx.match[1]);
    if (!node) return ctx.answerCbQuery('غير موجود');
    const moved = await swap(node, dir);
    await ctx.answerCbQuery(moved ? 'تم ✅' : dir < 0 ? 'هو الأول بالفعل' : 'هو الأخير بالفعل');
    if (moved) await manageView(ctx, node); // يحدّث رقم الترتيب
  });
}

adminAct(/^deln:(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  const node = await getNode(id);
  if (!node) return ctx.answerCbQuery('غير موجود');
  await ctx.answerCbQuery();
  await show(ctx, `⚠️ حذف «${esc(node.name)}» وكل ما بداخله من مجلدات وملفات؟`, Markup.inlineKeyboard([
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

/* ---------- نقل (ملفات + مجلدات) ---------- */
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
    const moved = await getNode(st.target_id);
    if (moved?.name.startsWith(PREFIX.l) && dest)
      return ctx.answerCbQuery('🚫 المستوى مكانه الصفحة الرئيسية فقط', { show_alert: true });
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

/* ---------- أزرار بطاقة الملف ---------- */
adminAct(/^rnf:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await forceReply(ctx, '✏️ أرسل العنوان الجديد للملف (رد على هذه الرسالة)', `rnf:${ctx.match[1]}`);
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
  await safe(ctx.deleteMessage()); // نحذف البطاقة بدل تركها في المحادثة
});
