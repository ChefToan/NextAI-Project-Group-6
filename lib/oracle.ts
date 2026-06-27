import "server-only";
import oracledb from "oracledb";

export const runtime = "nodejs";

let poolPromise: Promise<any> | undefined;

export const DEFAULT_ORACLE_CONTEXT_SQL =
  "with latest as (select max(created_t) max_created_t from account_t), metrics as (select 'oracle_schema' metric_name, sys_context('USERENV','CURRENT_SCHEMA') metric_value from dual union all select 'oracle_service', sys_context('USERENV','SERVICE_NAME') from dual union all select 'account_total', to_char(count(*)) from account_t union all select 'account_active_10100', to_char(sum(case when status = 10100 then 1 else 0 end)) from account_t union all select 'account_inactive_10102', to_char(sum(case when status = 10102 then 1 else 0 end)) from account_t union all select 'account_closed_10103', to_char(sum(case when status = 10103 then 1 else 0 end)) from account_t union all select 'account_created_last_7d_from_latest', to_char(count(*)) from account_t cross join latest where created_t >= latest.max_created_t - 604800 union all select 'latest_account_created_at_utc', to_char(date '1970-01-01' + max_created_t / 86400, 'YYYY-MM-DD HH24:MI:SS') from latest union all select 'billinfo_total', to_char(count(*)) from billinfo_t union all select 'billinfo_open_status_0', to_char(sum(case when billing_status = 0 then 1 else 0 end)) from billinfo_t union all select 'service_total', to_char(count(*)) from service_t union all select 'item_total', to_char(count(*)) from item_t union all select 'event_total', to_char(count(*)) from event_t) select metric_name, metric_value from metrics";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function oracleConfigured() {
  return Boolean(
    process.env.ORACLE_USER &&
      process.env.ORACLE_PASSWORD &&
      process.env.ORACLE_CONNECT_STRING,
  );
}

export async function getOraclePool() {
  if (!poolPromise) {
    poolPromise = oracledb.createPool({
      user: required("ORACLE_USER"),
      password: required("ORACLE_PASSWORD"),
      connectString: required("ORACLE_CONNECT_STRING"),
      poolMin: Number(process.env.ORACLE_POOL_MIN ?? 0),
      poolMax: Number(process.env.ORACLE_POOL_MAX ?? 4),
      poolIncrement: Number(process.env.ORACLE_POOL_INCREMENT ?? 1),
    });
  }

  return poolPromise;
}

function assertReadOnly(sql: string) {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed) && !/^with\b/i.test(trimmed)) {
    throw new Error("Only SELECT/WITH statements are allowed for dashboard context.");
  }

  if (/;\s*\S/.test(trimmed) || /\b(insert|update|delete|merge|alter|drop|truncate|grant|revoke|create)\b/i.test(trimmed)) {
    throw new Error("Dashboard context SQL must be a single read-only statement.");
  }
}

export async function runReadOnlyQuery(sql: string, maxRows = 25) {
  if (!oracleConfigured()) return null;

  assertReadOnly(sql);

  const pool = await getOraclePool();
  const connection = await pool.getConnection();

  try {
    const result = await connection.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows,
    });

    return {
      rows: result.rows ?? [],
      metaData:
        result.metaData?.map((column: { name: string }) => column.name) ?? [],
    };
  } finally {
    await connection.close();
  }
}

export async function runContextQuery() {
  const sql = process.env.NEXTAI_ORACLE_CONTEXT_SQL || DEFAULT_ORACLE_CONTEXT_SQL;
  return runReadOnlyQuery(sql, 25);
}
