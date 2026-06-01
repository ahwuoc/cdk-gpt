create extension if not exists pgcrypto;

do $$ begin
  create type account_status as enum ('reg-success', 'reg-failed', 'not-registered');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type account_sale_status as enum ('available', 'reserved', 'sold');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type admin_user_role as enum ('admin', 'user');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type order_status as enum ('pending', 'assigned', 'completed', 'cancelled', 'refunded');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type transaction_type as enum ('credit', 'debit', 'purchase', 'refund', 'set');
exception
  when duplicate_object then null;
end $$;

create table if not exists shop_admin_users (
  id uuid not null default gen_random_uuid() unique,
  username text primary key,
  password_hash text not null,
  role admin_user_role not null default 'user',
  balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shop_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  account_id text not null,
  status account_status not null,
  sale_status account_sale_status not null default 'reserved',
  sold_order_id uuid null,
  sold_at timestamptz null,
  password text null,
  session_token text null,
  mailkp text null,
  password_mailkp text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shop_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_username text null references shop_admin_users(username) on update cascade on delete set null,
  buyer_contact text not null,
  unit_price numeric not null,
  quantity integer not null default 1,
  total_price numeric not null,
  status order_status not null default 'pending',
  account_id uuid null,
  account_email text null,
  accounts jsonb null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assigned_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null
);

create table if not exists shop_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists shop_transactions (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  type transaction_type not null,
  amount numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists shop_accounts_sale_lookup_idx
  on shop_accounts (status, sale_status, created_at);

create index if not exists shop_accounts_sold_order_id_idx
  on shop_accounts (sold_order_id);

create index if not exists shop_orders_buyer_username_created_at_idx
  on shop_orders (buyer_username, created_at desc);

create index if not exists shop_orders_status_idx
  on shop_orders (status);

create index if not exists shop_transactions_username_created_at_idx
  on shop_transactions (username, created_at desc);

create or replace function deduct_admin_user_balance(p_username text, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update shop_admin_users
  set
    balance = balance - p_amount,
    updated_at = now()
  where username = lower(trim(p_username))
    and balance >= p_amount;

  return found;
end;
$$;

create or replace function increment_admin_user_balance(p_username text, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update shop_admin_users
  set
    balance = balance + p_amount,
    updated_at = now()
  where username = lower(trim(p_username));

  return found;
end;
$$;

alter table shop_admin_users enable row level security;
alter table shop_accounts enable row level security;
alter table shop_orders enable row level security;
alter table shop_settings enable row level security;
alter table shop_transactions enable row level security;

revoke execute on function deduct_admin_user_balance(text, numeric) from public, anon, authenticated;
revoke execute on function increment_admin_user_balance(text, numeric) from public, anon, authenticated;
grant execute on function deduct_admin_user_balance(text, numeric) to service_role;
grant execute on function increment_admin_user_balance(text, numeric) to service_role;

insert into shop_settings (key, value)
values ('shop_price', '10000'::jsonb)
on conflict (key) do nothing;
