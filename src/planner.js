// ============ مخطِّط التصنيف (دالة نقية بلا اتصال بقاعدة البيانات) ============
import { ACADEMIC, LEGACY_NAME } from './config.js';

export const norm = (s = '') => s.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');
export const clean = (s = '') => s.replace(/^[^\p{L}\p{N}]+/u, '').trim(); // يحذف أيقونة البداية
const LV = [['الخامس', 4], ['الرابع', 3], ['الثالث', 2], ['الثاني', 1], ['الاول', 0]];
export const levelIdx = (name) => { const n = norm(name); return (LV.find(([k]) => n.includes(k)) || [, -1])[1]; };
export const semIdx = (name) => {
  const m = /semester\s*(\d)/i.exec(name); if (m) return Number(m[1]);
  const n = norm(name); return n.includes('الثاني') ? 2 : n.includes('الاول') ? 1 : 0;
};
const DEPT_KW = [['ميكانيك', 'ميكانيك'], ['كهرب', 'كهرب'], ['مدني', 'مدني']];
const deptKey = (name) => (DEPT_KW.find(([k]) => norm(name).includes(k)) || [])[0];

// commonMode: 'all' = المستوى المشترك يُنقل لمدنية ويُنسخ لكهرباء وميكانيكا | 'one' = لمدنية فقط
export function planFrom(nodes, fileCount, commonMode = 'all') {
  const by = new Map();
  nodes.forEach((n) => { const k = n.parent_id || 0; (by.get(k) || by.set(k, []).get(k)).push(n); });
  const kids = (id) => by.get(id) || [];
  const holder = kids(0).find((n) => n.name === LEGACY_NAME);
  const acad = kids(0).find((n) => n.name === ACADEMIC);
  if (!holder || !acad) return { error: 'الهيكل الجديد أو المجلد القديم غير موجود.' };

  const dept = (key) => kids(acad.id).find((d) => norm(d.name).includes(key));
  const dip = kids(acad.id).find((d) => d.name.includes('دبلوم'));
  const semOf = (d, li, si) => {
    const lv = d && kids(d.id).find((n) => levelIdx(n.name) === li);
    return lv && kids(lv.id).find((s) => semIdx(s.name) === si);
  };
  const sub = (id) => kids(id).reduce((a, k) => { const r = sub(k.id); return { files: a.files + r.files, nodes: a.nodes + 1 + r.nodes }; },
    { files: fileCount.get(id) || 0, nodes: 0 });

  const items = [], skipped = [];
  const add = (node, d, li, si, mode, label) => {
    const sem = semOf(d, li, si);
    if (!sem) return skipped.push(`${clean(node.name)}: لا يوجد فصل مقابل (${label})`);
    const dup = kids(sem.id).some((x) => clean(x.name) === clean(node.name));
    if (dup && mode === 'move') return skipped.push(`${clean(node.name)}: موجودة مسبقاً في الوجهة`);
    const s = sub(node.id);
    items.push({ id: node.id, name: clean(node.name), destSem: sem.id, mode, files: s.files, nodes: s.nodes + 1,
      dest: `${d.name} › ${levelName(li)} › Semester ${si}` });
  };
  const levelName = (li) => ['المستوى الأول', 'المستوى الثاني', 'المستوى الثالث', 'المستوى الرابع', 'المستوى الخامس'][li];

  let left = 0;
  for (const lvl of kids(holder.id)) {
    const li = levelIdx(lvl.name), isDip = lvl.name.includes('دبلوم');
    if (li < 0) { skipped.push(`${lvl.name}: مستوى غير معروف`); continue; }
    left += fileCount.get(lvl.id) || 0;
    for (const sem of kids(lvl.id)) {
      const si = semIdx(sem.name);
      left += fileCount.get(sem.id) || 0;
      if (!si) { skipped.push(`${sem.name}: فصل غير معروف`); continue; }
      for (const ch of kids(sem.id)) {
        if (ch.name.startsWith('📘')) {
          if (isDip) add(ch, dip, li, si, 'move', 'دبلوم');
          else {
            const targets = commonMode === 'one' ? ['مدني'] : ['مدني', 'كهرب', 'ميكانيك'];
            targets.forEach((k, i) => add(ch, dept(k), li, si, i === 0 ? 'move' : 'clone', k));
          }
        } else if (ch.name.startsWith('📁') && deptKey(ch.name)) {
          left += fileCount.get(ch.id) || 0;
          for (const s of kids(ch.id)) {
            if (s.name.startsWith('📘')) add(s, dept(deptKey(ch.name)), li, si, 'move', ch.name);
            else skipped.push(`${s.name}: ليست مادة`);
          }
        } else skipped.push(`${ch.name}: غير معروف`);
      }
    }
  }
  // الاستنساخ يجب أن يسبق النقل لنفس المادة
  items.sort((a, b) => (a.mode === b.mode ? 0 : a.mode === 'clone' ? -1 : 1));
  return { items, skipped, left };
}

// ============ دمج «تلخيص» و«شروحات فيديو» داخل «مقررات» ============
const MERGE_NAMES = ['تلخيص', 'شروحات فيديو'];
export function mergePlan(nodes, fileCount) {
  const by = new Map();
  nodes.forEach((n) => { const k = n.parent_id || 0; (by.get(k) || by.set(k, []).get(k)).push(n); });
  const items = [];
  for (const n of nodes) {
    if (!n.parent_id || !MERGE_NAMES.includes(clean(n.name))) continue;
    const target = (by.get(n.parent_id) || []).find((x) => clean(x.name) === 'مقررات');
    items.push({ id: n.id, name: clean(n.name), parent: n.parent_id, target: target?.id ?? null,
      files: fileCount.get(n.id) || 0, children: (by.get(n.id) || []).length });
  }
  return items;
}
