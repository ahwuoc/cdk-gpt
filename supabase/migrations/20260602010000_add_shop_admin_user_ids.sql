alter table shop_admin_users
  add column if not exists id uuid not null default gen_random_uuid();

create unique index if not exists shop_admin_users_id_key
  on shop_admin_users (id);
