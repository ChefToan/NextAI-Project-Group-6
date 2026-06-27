/*
 * Fast Group 6 dataset refactor.
 *
 * Adds a larger, declining customer distribution across all Group 6 plans and
 * shifts the existing usage/bill period to 2026-05-04 -> 2026-06-05-ish.
 * L01-L10 remain usage-intensity markers only, not plan tiers.
 */
import { createRequire } from "module";
import fs from "fs";

const require = createRequire("C:/Users/toan/Desktop/NextAI/");
const oracledb = require("oracledb");
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

const PROJECT = "C:/Users/toan/Desktop/NextAI";
const SNAP = `${PROJECT}/scripts/g6-diverse-refactor-bulk-snapshot.json`;
const SERVICE_TYPE = "/service/nextaig6";
const MARKER = "NextAI G6 diverse dataset refactor v1";
const TARGET_BILL_START = Date.UTC(2026, 4, 4, 5, 0, 0) / 1000;
const TARGETS = [50, 46, 42, 38, 35, 32, 28, 25, 21, 18, 14, 11];
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--rollback") ? "rollback" : "dry";

const env = {};
for (const line of fs.readFileSync(`${PROJECT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const conn = await oracledb.getConnection({
  user: env.ORACLE_USER,
  password: env.ORACLE_PASSWORD,
  connectString: env.ORACLE_CONNECT_STRING,
});

async function q(sql, binds = {}, maxRows = 1000) {
  return conn.execute(sql, binds, { autoCommit: false, outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows });
}

function n(v) {
  return Number(v) || 0;
}

async function cols(table) {
  const r = await q(`select column_name from user_tab_columns where table_name=:t order by column_id`, { t: table.toUpperCase() });
  return r.rows.map((row) => row.COLUMN_NAME);
}

async function snapshotRows(sql) {
  return (await q(sql, {}, 50000)).rows;
}

async function deleteIds(table, key, ids) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const binds = Object.fromEntries(chunk.map((id, idx) => [`id${idx}`, id]));
    await q(`delete from ${table} where ${key} in (${chunk.map((_, idx) => `:id${idx}`).join(",")})`, binds);
  }
}

async function restoreRows(table, key, rows, fields) {
  for (const row of rows) {
    const binds = { [key]: row[key] };
    for (const field of fields) binds[field] = row[field] ?? null;
    await q(`update ${table} set ${fields.map((field) => `${field}=:${field}`).join(", ")} where ${key}=:${key}`, binds);
  }
}

function targetSql() {
  return TARGETS.map((target, i) => `select ${i + 1} sort_order, ${target} target_count from dual`).join(" union all ");
}

function cte(baseId, delta) {
  return `
with targets as (${targetSql()}),
products as (
  select p.*, row_number() over (
           order by (case when lower(product_name) like '%payg%' or lower(product_name) like '%pay as you go%' then -100 else price end), model_rank
         ) sort_order
    from (
      select p.poid_id0 product_id, p.name product_name, p.descr product_descr,
             min(pl.poid_id0) plan_id, min(pl.name) plan_name,
             nvl(to_number(regexp_substr(p.name || ' ' || p.descr, '\\$([0-9]+)', 1, 1, null, 1)), 0) price,
             case when p.name like '%3.5%' then 1 else 0 end model_rank
        from product_t p
        join purchased_product_t pp on pp.product_obj_id0 = p.poid_id0
        join plan_t pl on pl.poid_id0 = pp.plan_obj_id0
        join service_t s on s.poid_id0 = pp.service_obj_id0
       where s.poid_type = '${SERVICE_TYPE}'
       group by p.poid_id0, p.name, p.descr
    ) p
),
current_counts as (
  select pp.product_obj_id0 product_id, count(distinct pp.account_obj_id0) current_count
    from purchased_product_t pp join service_t s on s.poid_id0 = pp.service_obj_id0
   where s.poid_type = '${SERVICE_TYPE}'
   group by pp.product_obj_id0
),
product_targets as (
  select p.*, t.target_count, nvl(c.current_count, 0) current_count,
         greatest(0, t.target_count - nvl(c.current_count, 0)) add_count
    from products p
    join targets t on t.sort_order = p.sort_order
    left join current_counts c on c.product_id = p.product_id
),
nums as (select level n from dual connect by level <= 60),
templates as (
  select pp.product_obj_id0 product_id, a.poid_id0 template_account_id, s.poid_id0 template_service_id,
         pp.poid_id0 template_pp_id,
         row_number() over (partition by pp.product_obj_id0 order by a.poid_id0) template_rn,
         count(*) over (partition by pp.product_obj_id0) template_count
    from account_t a
    join service_t s on s.account_obj_id0 = a.poid_id0
    join purchased_product_t pp on pp.service_obj_id0 = s.poid_id0
   where s.poid_type = '${SERVICE_TYPE}'
),
adds as (
  select pt.*, nums.n add_idx,
         row_number() over (order by pt.sort_order, nums.n) rn
    from product_targets pt
    join nums on nums.n <= pt.add_count
),
base_counts as (
  select count(distinct a.poid_id0) base_total
    from account_t a join service_t s on s.account_obj_id0 = a.poid_id0
   where s.poid_type = '${SERVICE_TYPE}'
),
map as (
  select a.*, t.template_account_id, t.template_service_id, t.template_pp_id,
         (${baseId} + a.rn * 20 + 1) account_id,
         (${baseId} + a.rn * 20 + 2) service_id,
         (${baseId} + a.rn * 20 + 3) pp_id,
         (${baseId} + a.rn * 20 + 4) billinfo_id,
         (${baseId} + a.rn * 20 + 10) bill_id_base,
         (select base_total from base_counts) + a.rn all_idx,
         lpad(to_char(mod(a.rn - 1, 10) + 1), 2, '0') usage_bucket,
         ${delta} delta
    from adds a
    join templates t
      on t.product_id = a.product_id
     and t.template_rn = mod(a.add_idx - 1, t.template_count) + 1
)`;
}

function statusExpr(idx = "m.all_idx") {
  return `case when ${idx} >= 0.94 * 360 then 10103 when ${idx} >= 0.82 * 360 then 10102 else 10100 end`;
}

function stateExpr(idx = "m.all_idx") {
  return `case when mod(${idx},20) < 9 then 'VA' when mod(${idx},20) < 13 then 'NY' when mod(${idx},20) < 16 then 'CA' when mod(${idx},20) < 18 then 'TX' else 'WA' end`;
}

function dateShift(col, alias = "src") {
  return `case when ${alias}.${col} > 0 then ${alias}.${col} + m.delta else ${alias}.${col} end`;
}

function expr(table, col, alias = "src") {
  const a = alias;
  if (table === "account_t") {
    if (col === "POID_ID0") return "m.account_id";
    if (["CREATED_T", "MOD_T", "LAST_STATUS_T", "EFFECTIVE_T"].includes(col)) return dateShift(col, a);
    if (col === "ACCOUNT_NO") return "'0.0.0.1-' || m.account_id";
    if (col === "DESCR") return `'${MARKER}'`;
    if (col === "LINEAGE") return "'/0.0.0.1:' || m.account_id || '/'";
    if (col === "NAME") return "m.product_name || ' Customer ' || lpad(m.all_idx, 3, '0')";
    if (col === "STATUS") return statusExpr();
  }
  if (table === "account_nameinfo_t") {
    if (col === "OBJ_ID0") return "m.account_id";
    if (col === "STATE") return stateExpr();
  }
  if (table === "service_t") {
    if (col === "POID_ID0") return "m.service_id";
    if (["CREATED_T", "MOD_T", "LAST_STATUS_T", "EFFECTIVE_T"].includes(col)) return dateShift(col, a);
    if (col === "ACCOUNT_OBJ_ID0") return "m.account_id";
    if (col === "LOGIN") return "'nextai_g6_diverse_' || m.rn || '_l' || m.usage_bucket";
    if (col === "STATUS") return statusExpr();
  }
  if (table === "purchased_product_t") {
    if (col === "POID_ID0") return "m.pp_id";
    if (["CREATED_T", "MOD_T", "EFFECTIVE_T", "PURCHASE_START_T", "CYCLE_START_T", "USAGE_START_T", "INSTANTIATED_T", "NEXT_RETRY_T"].includes(col)) return dateShift(col, a);
    if (col === "ACCOUNT_OBJ_ID0") return "m.account_id";
    if (col === "SERVICE_OBJ_ID0") return "m.service_id";
    if (col === "PRODUCT_OBJ_ID0") return "m.product_id";
    if (col === "PLAN_OBJ_ID0") return "m.plan_id";
    if (col === "STATUS") return `case when mod(m.all_idx,17)=0 then 2 else 1 end`;
  }
  if (table === "billinfo_t") {
    if (col === "POID_ID0") return "m.billinfo_id";
    if (["CREATED_T", "MOD_T"].includes(col)) return dateShift(col, a);
    if (col === "ACCOUNT_OBJ_ID0") return "m.account_id";
    if (col === "AR_BILLINFO_OBJ_ID0") return "m.billinfo_id";
  }
  if (table === "bill_t") {
    if (col === "POID_ID0") return "m.bill_id_base + src.bill_rn";
    if (["CREATED_T", "MOD_T", "START_T", "END_T", "DUE_T"].includes(col)) return dateShift(col, a);
    if (col === "ACCOUNT_OBJ_ID0") return "m.account_id";
    if (col === "BILLINFO_OBJ_ID0" || col === "AR_BILLINFO_OBJ_ID0") return "m.billinfo_id";
    if (col === "RECVD") return "case when src.total_due = 0 then 0 when mod(m.all_idx,61)=0 then 0 when mod(m.all_idx,29)=0 then round(src.total_due * 0.75, 2) when mod(m.all_idx,43)=0 then 0 when mod(m.all_idx,19)=0 then round(src.total_due * 0.55, 2) else src.total_due end";
    if (col === "DISPUTED") return "case when src.total_due > 0 and mod(m.all_idx,29)=0 then round(src.total_due * 0.25, 2) else 0 end";
    if (col === "WRITEOFF") return "case when src.total_due > 0 and mod(m.all_idx,61)=0 then src.total_due else 0 end";
    if (col === "ADJUSTED") return "case when src.total_due > 0 and mod(m.all_idx,31)=0 then -7.5 else 0 end";
  }
  return `${a}.${col}`;
}

async function insertClone(table, sourceSql, joinSql, baseId, delta) {
  const columns = await cols(table);
  const sql = `insert into ${table} (${columns.join(", ")})
${cte(baseId, delta)}
select ${columns.map((col) => expr(table, col)).join(", ")}
  from (${sourceSql}) src
  join map m on ${joinSql}`;
  const r = await q(sql);
  console.log(`${table}: inserted ${r.rowsAffected ?? 0}`);
}

async function apply() {
  if (fs.existsSync(SNAP)) throw new Error(`Snapshot exists: ${SNAP}`);
  const oldBillStart = n((await q(`select min(start_t) start_t from bill_t where account_obj_id0 in (select distinct a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}') and start_t > 0`)).rows[0].START_T);
  const delta = TARGET_BILL_START - oldBillStart;
  const maxLow = BigInt((await q(`select to_char(max(id0)) max_id from (select max(poid_id0) id0 from account_t union all select max(poid_id0) from service_t union all select max(poid_id0) from purchased_product_t union all select max(poid_id0) from bill_t union all select max(poid_id0) from billinfo_t union all select max(poid_id0) from item_t)`)).rows[0].MAX_ID) + 200000n;

  const snap = {
    marker: MARKER,
    baseId: maxLow.toString(),
    delta,
    original: {
      events: await snapshotRows(`select poid_id0, start_t, end_t, created_t, mod_t from event_t where poid_type='/event/session/usagegr6'`),
      bills: await snapshotRows(`select poid_id0, start_t, end_t, due_t, recvd, disputed, writeoff, adjusted, state from bill_t where account_obj_id0 in (select distinct a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}')`),
      accounts: await snapshotRows(`select a.poid_id0, a.status, a.descr from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}'`),
      nameinfo: await snapshotRows(`select obj_id0, state from account_nameinfo_t where obj_id0 in (select distinct a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}')`),
      pp: await snapshotRows(`select pp.poid_id0, pp.status from purchased_product_t pp join service_t s on s.poid_id0=pp.service_obj_id0 where s.poid_type='${SERVICE_TYPE}'`),
    },
  };
  fs.writeFileSync(SNAP, JSON.stringify(snap, null, 0));

  await insertClone("account_t", "select * from account_t", "src.poid_id0 = m.template_account_id", maxLow.toString(), delta);
  await insertClone("account_nameinfo_t", "select * from account_nameinfo_t", "src.obj_id0 = m.template_account_id", maxLow.toString(), delta);
  await insertClone("service_t", "select * from service_t", "src.poid_id0 = m.template_service_id", maxLow.toString(), delta);
  await insertClone("purchased_product_t", "select * from purchased_product_t", "src.poid_id0 = m.template_pp_id", maxLow.toString(), delta);
  await insertClone("billinfo_t", "select b.* from (select b.*, row_number() over (partition by account_obj_id0 order by poid_id0) rn from billinfo_t b) b where rn=1", "src.account_obj_id0 = m.template_account_id", maxLow.toString(), delta);
  await insertClone("bill_t", "select b.*, row_number() over (partition by account_obj_id0 order by start_t, poid_id0) bill_rn from bill_t b", "src.account_obj_id0 = m.template_account_id", maxLow.toString(), delta);

  await q(`update event_t set start_t=start_t+:delta, end_t=case when end_t>0 then end_t+:delta else end_t end, created_t=created_t+:delta, mod_t=mod_t+:delta where poid_type='/event/session/usagegr6'`, { delta });
  await q(`update bill_t set start_t=case when start_t>0 then start_t+:delta else start_t end, end_t=case when end_t>0 then end_t+:delta else end_t end, due_t=case when due_t>0 then due_t+:delta else due_t end where account_obj_id0 in (select a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type=:svc and nvl(a.descr,'x') <> :marker)`, { delta, svc: SERVICE_TYPE, marker: MARKER });

  await q(`merge into account_t a using (select acct, rn from (select a.poid_id0 acct, row_number() over(order by a.poid_id0) rn from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}')) x on (a.poid_id0=x.acct) when matched then update set a.status=${statusExpr("x.rn")}`);
  await q(`merge into account_nameinfo_t ni using (select acct, rn from (select a.poid_id0 acct, row_number() over(order by a.poid_id0) rn from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}')) x on (ni.obj_id0=x.acct) when matched then update set ni.state=${stateExpr("x.rn")}`);
  await q(`merge into purchased_product_t pp using (select pp.poid_id0 pp_id, row_number() over(order by pp.account_obj_id0) rn from purchased_product_t pp join service_t s on s.poid_id0=pp.service_obj_id0 where s.poid_type='${SERVICE_TYPE}') x on (pp.poid_id0=x.pp_id) when matched then update set pp.status=case when mod(x.rn,17)=0 then 2 else 1 end`);
  await q(`merge into bill_t b using (select b.poid_id0 bill_id, b.total_due, row_number() over(order by b.account_obj_id0) rn from bill_t b where b.account_obj_id0 in (select a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SERVICE_TYPE}') and b.total_due > 0) x on (b.poid_id0=x.bill_id) when matched then update set b.recvd=case when mod(x.rn,61)=0 then 0 when mod(x.rn,29)=0 then round(x.total_due*0.75,2) when mod(x.rn,43)=0 then 0 when mod(x.rn,19)=0 then round(x.total_due*0.55,2) else x.total_due end, b.disputed=case when mod(x.rn,29)=0 then round(x.total_due*0.25,2) else 0 end, b.writeoff=case when mod(x.rn,61)=0 then x.total_due else 0 end, b.adjusted=case when mod(x.rn,31)=0 then -7.5 else 0 end`);

  await conn.commit();
  console.log(`Applied bulk refactor. Snapshot: ${SNAP}`);
}

async function rollback() {
  if (!fs.existsSync(SNAP)) throw new Error(`No snapshot: ${SNAP}`);
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const generated = (await q(`select a.poid_id0 account_id, s.poid_id0 service_id, pp.poid_id0 pp_id from account_t a join service_t s on s.account_obj_id0=a.poid_id0 join purchased_product_t pp on pp.service_obj_id0=s.poid_id0 where a.descr=:marker`, { marker: MARKER }, 10000)).rows;
  const accountIds = generated.map((r) => r.ACCOUNT_ID);
  await deleteIds("bill_t", "account_obj_id0", accountIds);
  await deleteIds("billinfo_t", "account_obj_id0", accountIds);
  await deleteIds("account_nameinfo_t", "obj_id0", accountIds);
  await deleteIds("purchased_product_t", "account_obj_id0", accountIds);
  await deleteIds("service_t", "account_obj_id0", accountIds);
  await deleteIds("account_t", "poid_id0", accountIds);
  await restoreRows("event_t", "POID_ID0", snap.original.events, ["START_T", "END_T", "CREATED_T", "MOD_T", "ACCOUNT_OBJ_ID0", "SERVICE_OBJ_ID0"]);
  if (snap.original.balImpacts) {
    for (const row of snap.original.balImpacts) {
      await q(
        `update event_bal_impacts_t
            set account_obj_id0=:ACCOUNT_OBJ_ID0,
                product_obj_id0=:PRODUCT_OBJ_ID0,
                offering_obj_id0=:OFFERING_OBJ_ID0
          where obj_id0=:OBJ_ID0 and rec_id=:REC_ID`,
        row,
      );
    }
  }
  await restoreRows("bill_t", "POID_ID0", snap.original.bills, ["START_T", "END_T", "DUE_T", "RECVD", "DISPUTED", "WRITEOFF", "ADJUSTED", "STATE"]);
  await restoreRows("account_t", "POID_ID0", snap.original.accounts, ["STATUS", "DESCR"]);
  await restoreRows("account_nameinfo_t", "OBJ_ID0", snap.original.nameinfo, ["STATE"]);
  await restoreRows("purchased_product_t", "POID_ID0", snap.original.pp, ["STATUS"]);
  await conn.commit();
  fs.unlinkSync(SNAP);
  console.log(`Rolled back bulk refactor; removed ${accountIds.length} generated customers.`);
}

async function dry() {
  const rows = (await q(`${cte("0", "0")} select product_name, current_count, target_count, add_count from product_targets order by sort_order`)).rows;
  console.table(rows.map((r) => ({ product: r.PRODUCT_NAME, current: r.CURRENT_COUNT, target: r.TARGET_COUNT, add: r.ADD_COUNT })));
}

try {
  if (mode === "apply") await apply();
  else if (mode === "rollback") await rollback();
  else await dry();
} catch (e) {
  await conn.rollback().catch(() => {});
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await conn.close();
}
