// ============ الإعدادات والثوابت ============
const env = process.env;
const clean = (v = '') => String(v).trim().replace(/^["']|["']$/g, '');

let sbUrl = clean(env.SUPABASE_URL);
let dbUrl = clean(env.DATABASE_URL);

// إصلاح الخلط الشائع بين SUPABASE_URL و DATABASE_URL
if (/^postgres(ql)?:\/\//i.test(sbUrl)) {
  if (!dbUrl) dbUrl = sbUrl;
  const m = sbUrl.match(/db\.([a-z0-9]+)\.supabase\.co/i) || sbUrl.match(/postgres\.([a-z0-9]+)[:@]/i);
  sbUrl = m ? `https://${m[1]}.supabase.co` : sbUrl;
} else if (sbUrl && !/^https?:\/\//i.test(sbUrl)) {
  sbUrl = 'https://' + sbUrl;
}
console.log('Supabase URL:', sbUrl || '(غير موجود)');

export const BOT_TOKEN = clean(env.BOT_TOKEN);
export const SB_URL = sbUrl;
export const SB_KEY = clean(env.SUPABASE_KEY); // service_role
export const DB_URL = dbUrl;
export const WEBHOOK_SECRET = env.WEBHOOK_SECRET || 'change-me-please';
export const RENDER_HOST = env.RENDER_EXTERNAL_HOSTNAME;
export const PORT = env.PORT || 3000;
export const ADMINS = new Set(
  (env.ADMIN_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean)
);

export const PAGE = 8; // عدد الملفات في الصفحة

export const WELCOME =
  '👋 أهلاً بك في\n\n📚 <b>مجموعة آفاق</b>\nمكتبة طلاب كلية الهندسة — جامعة كسلا\n\nاختر من القائمة، أو اكتب اسم ملف للبحث عنه:';

// التفرعات التلقائية
export const SUBJECT_SECTIONS = ['📚 مقررات', '📝 تلخيص', '🎬 شروحات فيديو', '🧪 امتحانات'];
export const LEVEL_CHILDREN = ['Semester 1', 'Semester 2'];
export const PREFIX = { f: '', s: '', l: '' };               // الأسماء الجديدة بلا أيقونات بادئة
export const LEGACY_PREFIXES = ['📁 ', '📘 ', '🎓 '];         // للحفاظ على أيقونات المجلدات القديمة عند إعادة التسمية

// ============ هيكل القوائم (يُنشأ مرة واحدة) ============
export const ACADEMIC = 'المحتوى الأكاديمي 📚📚';
export const CONTACT = 'تواصل معنا 📩';
export const LEGACY_NAME = '📥 ملفات قديمة (غير مصنفة)';
export const LEVELS = ['المستوى الأول', 'المستوى الثاني', 'المستوى الثالث', 'المستوى الرابع', 'المستوى الخامس'];
export const DEPARTMENTS = [
  { name: 'قسم دبلوم', levels: 3 },
  { name: 'مدنية 🏗', levels: 5 },
  { name: 'كهرباء ⚡', levels: 5 },
  { name: 'ميكانيكا ⚙️', levels: 5 },
  { name: 'إضافات مفيدة 👷', levels: 0 },
];

// أزرار لوحة المفاتيح السفلية
export const BACK_LABEL = 'رجوع 🔙';
export const MAIN_LABEL = 'القائمة الرئيسية 🔝';
export const ADMIN_LABEL = 'لوحة المشرف ⚙️';
