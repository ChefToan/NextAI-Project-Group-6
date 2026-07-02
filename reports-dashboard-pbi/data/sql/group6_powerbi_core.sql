-- Read-only Group 6 reporting extracts for Power BI.
-- These queries mirror the website report builder catalog:
-- EVENT_SESSION_USAGE2_G6 is the populated usage subclass table.
-- event_bal_impacts_t/resource 840 supplies USD revenue impacts.

-- 1) Daily usage and revenue fact.
with base_events as (
  select
    e.poid_id0 as event_id,
    e.account_obj_id0 as account_id,
    to_char(date '1970-01-01' + e.start_t / 86400, 'YYYY-MM-DD') as event_day,
    to_char(date '1970-01-01' + e.start_t / 86400, 'YYYY-MM') as event_month,
    to_number(to_char(date '1970-01-01' + e.start_t / 86400, 'HH24')) as event_hour,
    u.model_code2_g6 as model,
    e.rum_name,
    u.input_tokens2_g6 as input_tokens,
    u.output_tokens2_g6 as output_tokens
  from event_t e
  join EVENT_SESSION_USAGE2_G6 u on u.obj_id0 = e.poid_id0
  where e.poid_type = '/event/session/usagegr6'
    and e.account_obj_id0 in (
      select distinct a.poid_id0
      from account_t a
      join service_t s on s.account_obj_id0 = a.poid_id0
      where s.poid_type = '/service/nextaig6'
        and lower(s.login) not in ('web_acme_1')
    )
),
impact_rows as (
  select
    b.*,
    nvl(to_char(bi.gl_id), '0') as gl_id,
    case nvl(to_char(bi.gl_id), '0')
      when '102' then 'recurring'
      when '104' then 'usage'
      when '0' then 'unassigned'
      else 'other'
    end as revenue_type,
    nvl(bi.amount, 0) as impact_amount,
    row_number() over (
      partition by b.event_id
      order by nvl(to_char(bi.gl_id), '0'), nvl(bi.rec_id, 0)
    ) as impact_rank
  from base_events b
  left join event_bal_impacts_t bi on bi.obj_id0 = b.event_id and bi.resource_id = 840
)
select
  event_day,
  event_month,
  event_hour,
  model,
  rum_name,
  gl_id,
  revenue_type,
  sum(case when impact_rank = 1 then 1 else 0 end) as event_count,
  count(distinct case when impact_rank = 1 then account_id end) as active_accounts,
  sum(case when impact_rank = 1 and rum_name = 'PromptG6' then 1 else 0 end) as prompts,
  sum(case when impact_rank = 1 then input_tokens else 0 end) as input_tokens,
  sum(case when impact_rank = 1 then output_tokens else 0 end) as output_tokens,
  sum(case when impact_rank = 1 then input_tokens + output_tokens else 0 end) as total_tokens,
  round(sum(case when impact_rank = 1 then input_tokens + output_tokens else 0 end) / 1000, 2) as token_blocks,
  round(nvl(sum(impact_amount), 0), 2) as usage_revenue
from impact_rows
group by
  event_day,
  event_month,
  event_hour,
  model,
  rum_name,
  gl_id,
  revenue_type;

-- 2) Account/service dimension.
select distinct
  a.poid_id0 as account_id,
  a.status as account_status,
  to_char(date '1970-01-01' + a.created_t / 86400, 'YYYY-MM-DD') as account_created_day,
  s.poid_id0 as service_id,
  s.login as service_login,
  s.status as service_status
from account_t a
join service_t s on s.account_obj_id0 = a.poid_id0
where s.poid_type = '/service/nextaig6'
  and lower(s.login) not in ('web_acme_1');

-- 3) Monthly finance fact for tax and billed/unbilled review.
with g6_scope as (
  select distinct a.poid_id0 as account_id
  from account_t a
  join service_t s on s.account_obj_id0 = a.poid_id0
  where s.poid_type = '/service/nextaig6'
    and lower(s.login) not in ('web_acme_1')
),
bill_months as (
  select
    to_char(date '1970-01-01' + start_t / 86400, 'YYYY-MM') as finance_month,
    count(case when bill_no is not null then 1 end) as billed_bill_count,
    count(case when bill_no is null then 1 end) as unbilled_bill_count,
    round(sum(case when bill_no is not null then nvl(current_total, 0) else 0 end), 2) as billed_usd,
    round(sum(case when bill_no is null then nvl(current_total, 0) else 0 end), 2) as unbilled_usd,
    round(sum(case when bill_no is not null then -nvl(recvd, 0) else 0 end), 2) as collected_usd,
    round(sum(case when bill_no is not null then nvl(due, 0) else 0 end), 2) as outstanding_usd,
    round(sum(case when bill_no is not null then nvl(disputed, 0) else 0 end), 2) as disputed_usd,
    round(sum(case when bill_no is not null then nvl(writeoff, 0) else 0 end), 2) as writeoff_usd,
    round(sum(case when bill_no is not null then nvl(adjusted, 0) else 0 end), 2) as adjusted_usd
  from bill_t
  where account_obj_id0 in (select account_id from g6_scope)
    and start_t > 0
  group by to_char(date '1970-01-01' + start_t / 86400, 'YYYY-MM')
),
tax_months as (
  select
    to_char(date '1970-01-01' + e.start_t / 86400, 'YYYY-MM') as finance_month,
    round(sum(case when bi.tax_code = 'AIT' and nvl(bi.rate_tag, 'x') <> 'Tax' then nvl(bi.amount, 0) else 0 end), 2) as ait_taxable_base_usd,
    round(sum(case when bi.tax_code = 'AIT' and bi.rate_tag = 'Tax' then nvl(bi.amount, 0) else 0 end), 2) as ait_collected_usd
  from event_t e
  join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840
  where e.account_obj_id0 in (select account_id from g6_scope)
  group by to_char(date '1970-01-01' + e.start_t / 86400, 'YYYY-MM')
)
select
  coalesce(b.finance_month, t.finance_month) as finance_month,
  nvl(b.billed_bill_count, 0) as billed_bill_count,
  nvl(b.unbilled_bill_count, 0) as unbilled_bill_count,
  nvl(b.billed_usd, 0) as billed_usd,
  nvl(b.unbilled_usd, 0) as unbilled_usd,
  nvl(b.collected_usd, 0) as collected_usd,
  nvl(b.outstanding_usd, 0) as outstanding_usd,
  nvl(b.disputed_usd, 0) as disputed_usd,
  nvl(b.writeoff_usd, 0) as writeoff_usd,
  nvl(b.adjusted_usd, 0) as adjusted_usd,
  nvl(t.ait_taxable_base_usd, 0) as ait_taxable_base_usd,
  nvl(t.ait_collected_usd, 0) as ait_collected_usd,
  round(nvl(t.ait_taxable_base_usd, 0) * 0.05, 2) as expected_ait_usd,
  round(greatest(nvl(t.ait_taxable_base_usd, 0) * 0.05 - nvl(t.ait_collected_usd, 0), 0), 2) as ait_gap_usd
from bill_months b
full outer join tax_months t on t.finance_month = b.finance_month
order by 1;

-- 4) Customer bill ledger: paid, unpaid, and unbilled bill rows.
with g6_scope as (
  select distinct a.poid_id0 as account_id
  from account_t a
  join service_t s on s.account_obj_id0 = a.poid_id0
  where s.poid_type = '/service/nextaig6'
    and lower(s.login) not in ('web_acme_1')
)
select
  b.poid_id0 as bill_id,
  nvl(b.bill_no, to_char(b.poid_id0)) as bill_reference,
  case
    when b.bill_no is null then 'Unbilled'
    when nvl(b.due, 0) <= 0.005 then 'Paid'
    else 'Unpaid'
  end as bill_status,
  a.poid_id0 as account_id,
  nvl(a.descr, s.login) as customer_name,
  s.login as service_login,
  to_char(date '1970-01-01' + b.start_t / 86400, 'YYYY-MM') as bill_month,
  to_char(date '1970-01-01' + b.start_t / 86400, 'YYYY-MM-DD') as bill_start_day,
  to_char(date '1970-01-01' + b.end_t / 86400, 'YYYY-MM-DD') as bill_end_day,
  case when b.due_t > 0 then to_char(date '1970-01-01' + b.due_t / 86400, 'YYYY-MM-DD') end as due_day,
  round(nvl(b.current_total, 0), 2) as billed_usd,
  round(-nvl(b.recvd, 0), 2) as received_usd,
  round(nvl(b.due, 0), 2) as outstanding_usd,
  round(nvl(b.disputed, 0), 2) as disputed_usd,
  round(nvl(b.writeoff, 0), 2) as writeoff_usd,
  round(nvl(b.adjusted, 0), 2) as adjusted_usd
from bill_t b
join account_t a on a.poid_id0 = b.account_obj_id0
join service_t s on s.account_obj_id0 = a.poid_id0
where b.account_obj_id0 in (select account_id from g6_scope)
  and s.poid_type = '/service/nextaig6'
  and lower(s.login) not in ('web_acme_1')
  and b.start_t > 0
order by
  case
    when b.bill_no is null then 2
    when nvl(b.due, 0) <= 0.005 then 3
    else 1
  end,
  b.due_t nulls last,
  a.poid_id0,
  b.start_t;

-- 5) Sanity checks for comparing exported CSVs to the website API.
select 'usage_events' as metric, to_char(count(*)) as value
from event_t e
where e.poid_type = '/event/session/usagegr6'
  and e.account_obj_id0 in (
    select distinct a.poid_id0
    from account_t a
    join service_t s on s.account_obj_id0 = a.poid_id0
    where s.poid_type = '/service/nextaig6'
      and lower(s.login) not in ('web_acme_1')
  )
union all
select 'usage_revenue_usd', to_char(round(nvl(sum(bi.amount), 0), 2))
from event_t e
join EVENT_SESSION_USAGE2_G6 u on u.obj_id0 = e.poid_id0
left join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840
where e.poid_type = '/event/session/usagegr6'
  and e.account_obj_id0 in (
    select distinct a.poid_id0
    from account_t a
    join service_t s on s.account_obj_id0 = a.poid_id0
    where s.poid_type = '/service/nextaig6'
      and lower(s.login) not in ('web_acme_1')
  );
