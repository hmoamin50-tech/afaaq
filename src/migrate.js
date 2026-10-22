// ============ إنشاء الجداول تلقائياً ============
import pg from 'pg';
import { DB_URL, LEVEL_CHILDREN } from './config.js';

const SCHEMA_SQL = `
create table if not exists nodes (
  id bigserial primary key,
  parent_id bigint references nodes(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz default now()
);
create index if not exists nodes_parent_idx on nodes(parent_id);

create table if not exists files (
  id bigserial primary key,
  node_id bigint not null references nodes(id) on delete cascade,
  title text not null,
  kind text not null default 'document',
  file_id text not null,
  file_unique_id text,
  file_size bigint,
  created_at timestamptz default now()
);
create index if not exists files_node_idx on files(node_id);

create table if not exists admin_state (
  admin_id bigint primary key,
  mode text,
  target_id bigint
);

create table if not exists users (
  id bigint primary key,
  username text,
  first_name text,
  joined_at timestamptz default now()
);

create table if not exists admins (
  id bigint primary key,
  name text,
  added_by bigint,
  created_at timestamptz default now()
);

alter table admins enable row level security;
alter table nodes enable row level security;
alter table files enable row level security;
alter table admin_state enable row level security;
alter table users enable row level security;
`;

export async function migrate() {
  if (!DB_URL) {
    console.warn('⚠️ DATABASE_URL غير موجود — لن يتم إنشاء الجداول تلقائياً.');
    return;
  }
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(SCHEMA_SQL);

    // بيانات أولية: فقط إذا كانت الشجرة فارغة تماماً
    const { rows } = await client.query('select count(*)::int as c from nodes');
    if (rows[0].c === 0) {
      const lvl = await client.query(
        'insert into nodes (parent_id, name, position) values (null, $1, 1) returning id',
        ['🎓 المستوى الأول']
      );
      for (const [i, name] of LEVEL_CHILDREN.entries())
        await client.query('insert into nodes (parent_id, name, position) values ($1, $2, $3)', [lvl.rows[0].id, name, i + 1]);
      console.log('✅ تمت إضافة المستوى الأول وفصليه');
    }
    await client.query("notify pgrst, 'reload schema'");
    console.log('✅ قاعدة البيانات جاهزة');
  } catch (e) {
    console.error('❌ فشل إنشاء القاعدة:', e.message);
  } finally {
    await client.end().catch(() => {});
  }
}
