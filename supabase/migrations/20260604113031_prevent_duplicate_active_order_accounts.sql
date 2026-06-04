create or replace function public.shop_order_account_ids(p_account_id uuid, p_accounts jsonb)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct account_id), array[]::uuid[])
  from (
    select p_account_id as account_id
    where p_account_id is not null
    union all
    select (item->>'id')::uuid as account_id
    from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) as item
    where item ? 'id'
      and item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) ids;
$$;

create or replace function public.prevent_duplicate_active_order_accounts()
returns trigger
language plpgsql
as $$
declare
  new_account_ids uuid[];
  duplicated_account_id uuid;
begin
  if new.status not in ('assigned', 'completed') then
    return new;
  end if;

  new_account_ids := public.shop_order_account_ids(new.account_id, new.accounts);
  if coalesce(array_length(new_account_ids, 1), 0) = 0 then
    return new;
  end if;

  select existing_id
  into duplicated_account_id
  from shop_orders existing
  cross join lateral unnest(public.shop_order_account_ids(existing.account_id, existing.accounts)) existing_id
  where existing.id <> new.id
    and existing.status in ('assigned', 'completed')
    and existing_id = any(new_account_ids)
  limit 1;

  if duplicated_account_id is not null then
    raise exception 'Account % is already assigned to another active/completed order', duplicated_account_id;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_active_order_accounts_trigger on shop_orders;
create trigger prevent_duplicate_active_order_accounts_trigger
before insert or update of status, account_id, accounts on shop_orders
for each row
execute function public.prevent_duplicate_active_order_accounts();
