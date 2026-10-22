// ============ عرض المجلدات ============
import { Markup } from 'telegraf';
import { db, ok, isAdmin, getNode, children, crumbs, getState, show, esc, lastView } from './core.js';
import { PAGE, WELCOME } from './config.js';

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
export const fileIcon = (f) => (f.kind === 'video' ? '🎬' : '📄');

export async function view(ctx, nodeId = 0, page = 0, msgId) {
  const admin = isAdmin(ctx);
  const st = admin ? await getState(ctx.from.id) : null;
  const node = nodeId ? await getNode(nodeId) : null;
  const id = node?.id ?? 0;
  const uploading = st?.mode === 'upload' && st.target_id === id;
  const moving = st?.mode?.startsWith('move_');

  // المجلدات (زرّان في الصف)
  const kids = await children(id || null);
  const rows = [];
  for (let i = 0; i < kids.length; i += 2)
    rows.push(kids.slice(i, i + 2).map((k) => Markup.button.callback(k.name.slice(0, 32), `n:${k.id}:0`)));

  // الملفات: ترتيب أبجدي/رقمي طبيعي (محاضرة 2 قبل محاضرة 10)
  let total = 0;
  if (id) {
    const { data } = ok(await db.from('files').select('id,title,kind').eq('node_id', id));
    const files = (data || []).sort((a, b) => collator.compare(a.title, b.title));
    total = files.length;
    page = Math.max(0, Math.min(page, Math.ceil(total / PAGE) - 1)); // بعد الحذف قد تختفي الصفحة الأخيرة
    files.slice(page * PAGE, page * PAGE + PAGE).forEach((f) =>
      rows.push([Markup.button.callback(`${fileIcon(f)} ${f.title.slice(0, 50)}`, `f:${f.id}`)])
    );
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `n:${id}:${page - 1}`));
    if ((page + 1) * PAGE < total) nav.push(Markup.button.callback('التالي ▶️', `n:${id}:${page + 1}`));
    if (nav.length) rows.push(nav);
  }

  // شريط المشرف: يظهر حسب الوضع الحالي فقط
  let banner = '';
  if (admin) {
    if (moving) {
      banner = '\n\n🔀 <b>وضع النقل:</b> تصفّح إلى المكان الجديد ثم اضغط «انقل إلى هنا».';
      rows.push([Markup.button.callback('📥 انقل إلى هنا', `mvhere:${id}`)]);
      rows.push([Markup.button.callback('❌ إلغاء النقل', 'mvcancel')]);
    } else if (uploading) {
      banner = '\n\n📤 <b>وضع الرفع مفعّل:</b> أرسل الملفات/الفيديوهات الآن.';
      rows.push([Markup.button.callback('➕ إضافة', `add:${id}`), Markup.button.callback('✅ إنهاء الرفع', 'upend')]);
    } else {
      const r = [Markup.button.callback('➕ إضافة', `add:${id}`)];
      if (id) r.push(Markup.button.callback('📤 رفع ملفات', `up:${id}`));
      rows.push(r);
      if (id) rows.push([Markup.button.callback('⚙️ إدارة هذا المجلد', `mg:${id}`)]);
      else rows.push([Markup.button.callback('🛠 لوحة التحكم', 'panel')]);
    }
  }

  // التنقل
  if (node && !uploading) {
    const nav = [];
    if (node.parent_id) nav.push(Markup.button.callback('🔙 رجوع', `n:${node.parent_id}:0`));
    nav.push(Markup.button.callback('🏠 الرئيسية', 'n:0:0'));
    rows.push(nav);
  }

  let text = node ? `📍 ${esc(await crumbs(node))}` : WELCOME;
  if (!kids.length && !total)
    text += admin ? '\n\n<i>فارغ — استخدم ➕ إضافة أو 📤 رفع ملفات.</i>' : '\n\n<i>لا يوجد محتوى هنا بعد.</i>';

  const shownId = await show(ctx, text + banner, Markup.inlineKeyboard(rows), msgId);
  lastView.set(ctx.chat.id, { msgId: shownId, nodeId: id, page });
}

// يعيد رسم آخر قائمة معروضة (إن كانت لنفس المجلد) ليظهر أي تغيير فوراً
export async function refreshView(ctx, nodeId) {
  const lv = lastView.get(ctx.chat.id);
  if (!lv || (nodeId !== undefined && lv.nodeId !== Number(nodeId))) return;
  await view(ctx, lv.nodeId, lv.page, lv.msgId);
}
