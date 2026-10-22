-- آمن: لا يحذف أي بيانات. شغّله في Supabase > SQL Editor (يمكن تشغيله أكثر من مرة)

create table if not exists nodes (
  id         bigserial primary key,
  parent_id  bigint references nodes(id) on delete cascade,
  name       text not null,
  position   int not null default 0,
  created_at timestamptz default now()
);
create index if not exists nodes_parent_idx on nodes(parent_id);

create table if not exists files (
  id             bigserial primary key,
  node_id        bigint not null references nodes(id) on delete cascade,
  title          text not null,
  kind           text not null default 'document',
  file_id        text not null,
  file_unique_id text,
  file_size      bigint,
  created_at     timestamptz default now()
);
create index if not exists files_node_idx on files(node_id);

create table if not exists admin_state (
  admin_id  bigint primary key,
  mode      text,
  target_id bigint
);

create table if not exists users (
  id         bigint primary key,
  username   text,
  first_name text,
  joined_at  timestamptz default now()
);

create table if not exists admins (
  id         bigint primary key,
  name       text,
  added_by   bigint,
  created_at timestamptz default now()
);

alter table users add column if not exists cur_node bigint;

create table if not exists settings (
  key   text primary key,
  value text
);
alter table settings    enable row level security;

alter table nodes       enable row level security;
alter table files       enable row level security;
alter table admin_state enable row level security;
alter table users       enable row level security;
alter table admins      enable row level security;

-- ملاحظة: هيكل القوائم (المحتوى الأكاديمي ← الأقسام ← المستويات ← الفصول) ينشئه البوت تلقائياً عند أول تشغيل،
-- وينقل أي محتوى قديم إلى مجلد «ملفات قديمة (غير مصنفة)» دون حذف شيء.

notify pgrst, 'reload schema';
