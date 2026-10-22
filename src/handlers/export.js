// ============ تصدير الشجرة والملفات كـ JSON (للمشرف) ============
import { bot, db, ok, isAdmin } from '../core.js';

async function all(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data } = ok(await db.from(table).select(cols).order('id').range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export async function buildExport() {
  const nodes = await all('nodes', 'id,parent_id,name,position');
  const files = await all('files', 'id,node_id,title,kind,file_size');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (id) => {
    const names = [];
    for (let c = byId.get(id); c; c = byId.get(c.parent_id)) names.unshift(c.name);
    return names.join(' > ');
  };
  return {
    exported_at: new Date().toISOString(),
    nodes: nodes.map((n) => ({ ...n, path: pathOf(n.id) })),
    files: files.map((f) => ({ id: f.id, title: f.title, kind: f.kind, size: f.file_size, node_id: f.node_id, path: pathOf(f.node_id) })),
  };
}

bot.command('export', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const data = await buildExport();
  await ctx.replyWithDocument(
    { source: Buffer.from(JSON.stringify(data, null, 1), 'utf-8'), filename: 'library-export.json' },
    { caption: `📦 ${data.nodes.length} مجلد — ${data.files.length} ملف\nأرسل هذا الملف لـ Claude.` }
  );
});
