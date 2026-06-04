-- Find accounts that appear in more than one assigned/completed order.
with order_accounts as (
  select
    o.id as order_id,
    upper(right(o.id::text, 8)) as short_order_id,
    o.buyer_username,
    o.total_price,
    o.status,
    o.created_at,
    account_item.account_id,
    account_item.email
  from shop_orders o
  cross join lateral (
    select
      o.account_id::text as account_id,
      o.account_email as email
    where o.account_id is not null

    union all

    select
      account->>'id' as account_id,
      account->>'email' as email
    from jsonb_array_elements(coalesce(o.accounts, '[]'::jsonb)) account
  ) account_item
  where o.status in ('assigned', 'completed')
),
duplicates as (
  select account_id
  from order_accounts
  where account_id is not null
  group by account_id
  having count(distinct order_id) > 1
)
select
  oa.email,
  oa.account_id,
  oa.short_order_id,
  oa.order_id,
  oa.buyer_username,
  oa.total_price,
  oa.status,
  oa.created_at
from order_accounts oa
join duplicates d on d.account_id = oa.account_id
order by oa.account_id, oa.created_at;

-- Focus on the two emails from the reported screenshot.
select
  upper(right(id::text, 8)) as short_order_id,
  id as order_id,
  buyer_username,
  total_price,
  status,
  account_email,
  accounts,
  created_at
from shop_orders
where status in ('assigned', 'completed')
  and (
    account_email in (
      'sherwinhardingabbigail9515@hotmail.com',
      'rowancosimajerome5915@hotmail.com'
    )
    or accounts @> '[{"email":"sherwinhardingabbigail9515@hotmail.com"}]'::jsonb
    or accounts @> '[{"email":"rowancosimajerome5915@hotmail.com"}]'::jsonb
  )
order by created_at;
