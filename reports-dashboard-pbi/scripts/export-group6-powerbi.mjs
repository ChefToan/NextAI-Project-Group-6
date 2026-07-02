import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const oracledb = require("oracledb");

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(WORKSPACE_ROOT, "..");
const OUT_DIR = path.join(WORKSPACE_ROOT, "data", "extracts");
const SERVICE_TYPE = "/service/nextaig6";
const EXCLUDED_LOGIN = "web_acme_1";

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows) {
  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ];
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

async function runQuery(conn, sql, binds = {}) {
  const result = await conn.execute(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    maxRows: 50000,
  });
  return result.rows ?? [];
}

async function main() {
  const env = loadEnv(path.join(PROJECT_ROOT, ".env.local"));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const conn = await oracledb.getConnection({
    user: env.ORACLE_USER,
    password: env.ORACLE_PASSWORD,
    connectString: env.ORACLE_CONNECT_STRING,
  });

  const g6Scope = `
    select distinct a.poid_id0
    from account_t a
    join service_t s on s.account_obj_id0 = a.poid_id0
    where s.poid_type = :serviceType
      and lower(s.login) not in (:excludedLogin)
  `;

  const extracts = [
    {
      file: "fact_group6_usage_daily.csv",
      sql: `
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
            and e.account_obj_id0 in (${g6Scope})
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
          revenue_type
        order by 1, 4, 5, 6`,
    },
    {
      file: "dim_group6_account_service.csv",
      sql: `
        select distinct
          a.poid_id0 as account_id,
          a.status as account_status,
          to_char(date '1970-01-01' + a.created_t / 86400, 'YYYY-MM-DD') as account_created_day,
          s.poid_id0 as service_id,
          s.login as service_login,
          s.status as service_status
        from account_t a
        join service_t s on s.account_obj_id0 = a.poid_id0
        where s.poid_type = :serviceType
          and lower(s.login) not in (:excludedLogin)
        order by 1`,
    },
    {
      file: "fact_group6_sanity_checks.csv",
      sql: `
        select 'usage_events' as metric, to_char(count(*)) as value
        from event_t e
        where e.poid_type = '/event/session/usagegr6'
          and e.account_obj_id0 in (${g6Scope})
        union all
        select 'usage_revenue_usd', to_char(round(nvl(sum(bi.amount), 0), 2))
        from event_t e
        join EVENT_SESSION_USAGE2_G6 u on u.obj_id0 = e.poid_id0
        left join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840
        where e.poid_type = '/event/session/usagegr6'
          and e.account_obj_id0 in (${g6Scope})
        union all
        select 'active_accounts', to_char(count(*))
        from (${g6Scope})`,
    },
  ];

  try {
    for (const extract of extracts) {
      const rows = await runQuery(conn, extract.sql, { serviceType: SERVICE_TYPE, excludedLogin: EXCLUDED_LOGIN });
      const file = path.join(OUT_DIR, extract.file);
      writeCsv(file, rows);
      console.log(`${extract.file}: ${rows.length} row(s)`);
    }
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
