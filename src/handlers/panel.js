// ============ لوحة التحكم، المشرفون، الدليل ============
import crypto from 'node:crypto';
import { Markup } from 'telegraf';
import {
  bot, db, isAdmin, isOwner, adminAct, ownerAct, loadAdmins, removeAdmin, addAdmin,
  show, forceReply, safe,
} from '../core.js';
import { ADMINS, WEBHOOK_SECRET } from '../config.js';
import { legacyId, legacyFileCount } from '../layout.js';

/* ---------- الأوامر الظاهرة في قائمة تيليجرام ---------- */
const USER_CMDS = [
  { command: 'start', description: 'القائمة الرئيسية' },
  { command: 'help', description: 'طريقة الاستخدام' },
];
const ADMIN_CMDS = [
  ...USER_CMDS,
  { command: 'panel', description: 'لوحة التحكم' },
  { command: 'cancel', description: 'إلغاء الوضع الحالي' },
];

export async function syncCommands() {
  await safe(bot.telegram.setMyCommands(USER_CMDS));
  const rows = await loadAdmins();
  const ids = new Set([...ADMINS, ...rows.map((r) => Number(r.id))]);
  for (const id of ids)
    await safe(bot.telegram.setMyCommands(ADMIN_CMDS, { scope: { type: 'chat', chat_id: id } }));
}

/* ---------- الدليل ---------- */
const USER_HELP =
  '📖 <b>طريقة الاستخدام</b>\n\n' +
  '• استخدم الأزرار أسفل الشاشة للتنقل: المحتوى الأكاديمي ← القسم ← المستوى ← الفصل ← المادة.\n' +
  '• عند الوصول لمجلد فيه ملفات تصلك مباشرة.\n' +
  '• اكتب اسم الملف في المحادثة للبحث عنه.\n' +
  '• /start للعودة للقائمة الرئيسية.';

const ADMIN_HELP =
  USER_HELP + '\n\n🛠 <b>للمشرفين</b>\n\n' +
  '• <b>➕ إضافة:</b> مجلد أو مادة (تُنشأ أقسامها تلقائياً). يمكنك إرسال عدة أسماء، كل اسم في سطر.\n' +
  '• <b>⚙️ لوحة المشرف:</b> زر أسفل الشاشة يفتح أدوات الإدارة للمجلد الذي أنت فيه.\n' +
  '• <b>🎓 المستوى:</b> يُنشأ بفصلين تلقائياً (Semester 1/2).\n' +
  '• <b>📥 الملفات القديمة:</b> من /panel ← «الملفات القديمة». افتح الملف ← 🔀 نقل ← اختر القسم ← «انقل إلى هنا». أو من «إدارة المجلد» ← «📦 نقل كل المحتوى» لنقل مجلد كامل دفعة واحدة. هذه الملفات لا تظهر للطلاب في القوائم إلى أن تنقلها (لكن البحث بالاسم يجدها).\n' +
  '• <b>📞 تواصل معنا:</b> من /panel ← «نص تواصل معنا».\n' +
  '• <b>📤 رفع ملفات:</b> افتح المجلد، اضغط رفع، ثم أرسل الملفات وأنهِ الرفع.\n' +
  '• <b>⚙️ إدارة هذا المجلد:</b> إعادة تسمية، تقديم/تأخير، نقل، حذف.\n' +
  '• على أي ملف: تعديل العنوان، نقل، حذف.\n' +
  '• /panel لوحة التحكم، /cancel لإلغاء أي وضع.';

bot.help((ctx) => ctx.reply(isAdmin(ctx) ? ADMIN_HELP : USER_HELP, { parse_mode: 'HTML' }));

/* ---------- لوحة التحكم ---------- */
async function statsText() {
  const c = (t) => db.from(t).select('*', { count: 'exact', head: true });
  const [u, f, n] = await Promise.all([c('users'), c('files'), c('nodes')]);
  let t = `👥 المستخدمون: <b>${u.count}</b>\n📄 الملفات: <b>${f.count}</b>\n📁 المجلدات: <b>${n.count}</b>`;
  const left = await legacyFileCount();
  if (left !== null) t += `\n📥 ملفات غير مصنفة: <b>${left}</b>`;
  return t;
}

async function panelView(ctx) {
  const rows = [[Markup.button.callback('📞 نص «تواصل معنا»', 'ctc')], [Markup.button.callback('📖 الدليل', 'guide')]];
  const hid = await legacyId();
  if (hid) rows.unshift([Markup.button.callback('📥 الملفات القديمة (للتصنيف)', `n:${hid}:0`)]);
  if (isOwner(ctx)) rows.unshift([Markup.button.callback('👥 المشرفون', 'adm')]);
  rows.push([Markup.button.callback('🏠 الرئيسية', 'n:0:0')]);
  await show(ctx, `🛠 <b>لوحة التحكم</b>\n\n${await statsText()}`, Markup.inlineKeyboard(rows));
}

adminAct('ctc', async (ctx) => {
  await ctx.answerCbQuery();
  await forceReply(ctx, '✏️ أرسل نص «تواصل معنا» (أرقام، روابط، أي معلومات) — رد على هذه الرسالة', 'ctc:0');
});

bot.command('panel', (ctx) => isAdmin(ctx) && panelView(ctx));
bot.command('stats', (ctx) => isAdmin(ctx) && panelView(ctx));
adminAct('panel', async (ctx) => { await ctx.answerCbQuery(); await panelView(ctx); });
adminAct('guide', async (ctx) => {
  await ctx.answerCbQuery();
  await show(ctx, ADMIN_HELP, Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'panel')]]));
});

/* ---------- إدارة المشرفين (للمالك) ---------- */
export async function adminsView(ctx, msgId) {
  const list = await loadAdmins();
  const rows = list.map((a) => [
    Markup.button.callback(`👤 ${(a.name || a.id).toString().slice(0, 24)}`, 'noop'),
    Markup.button.callback('❌ إزالة', `admrm:${a.id}`),
  ]);
  rows.push([Markup.button.callback('➕ إضافة بالمعرّف', 'admadd'), Markup.button.callback('🔗 رابط دعوة', 'adminv')]);
  rows.push([Markup.button.callback('🔙 رجوع', 'panel')]);
  const text =
    `👥 <b>المشرفون</b>\n\n👑 المالكون: ${[...ADMINS].join('، ') || '—'}\n` +
    (list.length ? `\nمشرفون مضافون: ${list.length}` : '\n<i>لا يوجد مشرفون مضافون بعد.</i>');
  await show(ctx, text, Markup.inlineKeyboard(rows), msgId);
}

ownerAct('adm', async (ctx) => { await ctx.answerCbQuery(); await adminsView(ctx); });
bot.action('noop', (ctx) => ctx.answerCbQuery());
ownerAct('admadd', async (ctx) => {
  await ctx.answerCbQuery();
  await forceReply(ctx, '➕ أرسل رقم المعرّف (ID) للمشرف الجديد، أو حوّل لي رسالة منه.\n(رد على هذه الرسالة)', 'adm:0');
});
ownerAct(/^admrm:(\d+)$/, async (ctx) => {
  await removeAdmin(ctx.match[1]);
  await safe(bot.telegram.deleteMyCommands({ scope: { type: 'chat', chat_id: Number(ctx.match[1]) } }));
  await ctx.answerCbQuery('تمت الإزالة');
  await adminsView(ctx);
});

/* ---------- رابط الدعوة (صالح ساعة) ---------- */
const sign = (e) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(e).digest('hex').slice(0, 16);
const makeInvite = () => {
  const e = (Math.floor(Date.now() / 1000) + 3600).toString(36);
  return `adm_${e}_${sign(e)}`;
};

ownerAct('adminv', async (ctx) => {
  if (WEBHOOK_SECRET === 'change-me-please')
    return ctx.answerCbQuery('غيّر WEBHOOK_SECRET أولاً لتفعيل الدعوات', { show_alert: true });
  await ctx.answerCbQuery();
  const link = `https://t.me/${ctx.botInfo.username}?start=${makeInvite()}`;
  await show(
    ctx,
    `🔗 <b>رابط دعوة مشرف</b> (صالح لمدة ساعة)\n\n${link}\n\nأرسله للشخص وسيصبح مشرفاً عند فتحه. تستطيع إزالته لاحقاً من هذه القائمة.`,
    Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'adm')]])
  );
});

export async function redeemInvite(ctx) {
  const m = /^adm_([a-z0-9]+)_([a-f0-9]{16})$/.exec(ctx.payload || '');
  if (!m || WEBHOOK_SECRET === 'change-me-please') return false;
  if (sign(m[1]) !== m[2] || parseInt(m[1], 36) < Date.now() / 1000)
    return (await ctx.reply('⏰ انتهت صلاحية رابط الدعوة.'), true);
  if (!isAdmin(ctx)) {
    await addAdmin(ctx.from.id, ctx.from.first_name, null);
    await syncCommands();
    await ctx.reply('🎉 أصبحت الآن مشرفاً. اكتب /help لمعرفة طريقة التحكم.');
  }
  return true;
}
