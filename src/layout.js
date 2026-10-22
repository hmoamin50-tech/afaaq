// ============ هيكل القوائم + حماية المحتوى القديم ============
import { db, ok, createNode } from './core.js';
import { ACADEMIC, CONTACT, LEGACY_NAME, LEVELS, DEPARTMENTS } from './config.js';

let holder = null;
export async function legacyId() {
  if (holder) return holder;
  const { data } = await db.from('nodes').select('id').is('parent_id', null).eq('name', LEGACY_NAME).limit(1);
  holder = data?.[0]?.id ?? null;
  return holder;
}

// ينشئ الهيكل الجديد مرة واحدة. أي محتوى موجود مسبقاً يُنقل كما هو إلى «ملفات قديمة» (لا حذف إطلاقاً).
export async function seedLayout() {
  const roots = ok(await db.from('nodes').select('id,name').is('parent_id', null)).data || [];
  if (roots.some((r) => r.name === ACADEMIC)) return; // تم الإنشاء سابقاً

  const mk = async (name, position) =>
    ok(await db.from('nodes').insert({ parent_id: null, name, position }).select().single()).data;

  const old = roots.filter((r) => r.name !== LEGACY_NAME);
  let hold = roots.find((r) => r.name === LEGACY_NAME);
  if (old.length) {
    hold = hold || (await mk(LEGACY_NAME, 3));
    ok(await db.from('nodes').update({ parent_id: hold.id }).in('id', old.map((r) => r.id)));
    console.log(`📥 نُقل ${old.length} مجلد قديم إلى «${LEGACY_NAME}»`);
  }

  const acad = await mk(ACADEMIC, 1);
  await mk(CONTACT, 2);
  for (const d of DEPARTMENTS) {
    const dep = await createNode(acad.id, d.name, 'f');
    for (let i = 0; i < d.levels; i++) await createNode(dep.id, LEVELS[i], 'l'); // ينشئ Semester 1/2 تلقائياً
  }
  console.log('✅ تم إنشاء هيكل القوائم الجديد');
}

// عدد الملفات التي ما زالت في المجلد القديم (للمشرف)
export async function legacyFileCount() {
  const hid = await legacyId();
  if (!hid) return null;
  let ids = [hid];
  let frontier = [hid];
  while (frontier.length) {
    const { data } = await db.from('nodes').select('id').in('parent_id', frontier);
    frontier = (data || []).map((n) => n.id);
    ids = ids.concat(frontier);
  }
  const { count } = await db.from('files').select('*', { count: 'exact', head: true }).in('node_id', ids);
  return count ?? 0;
}
