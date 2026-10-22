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

alter table nodes       enable row level security;
alter table files       enable row level security;
alter table admin_state enable row level security;
alter table users       enable row level security;
alter table admins      enable row level security;

-- بيانات أولية: فقط إذا كانت الشجرة فارغة
do $$
declare lid bigint;
begin
  if not exists (select 1 from nodes) then
    insert into nodes (parent_id, name, position) values (null, '🎓 المستوى الأول', 1) returning id into lid;
    insert into nodes (parent_id, name, position) values
      (lid, '📅 الفصل الدراسي الأول', 1),
      (lid, '📅 الفصل الدراسي الثاني', 2);
  end if;
end $$;

notify pgrst, 'reload schema';
