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

-- 3) Sanity checks for comparing exported CSVs to the website API.
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
