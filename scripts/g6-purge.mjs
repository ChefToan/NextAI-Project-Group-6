/*
 * Group 6 PURGE — deletes all customer/account-scoped data for /service/nextaig6
 * (accounts, services, billinfo, bills, items, events, balances, purchased
 * products, payinfo, usage detail) so a fresh dataset can be generated.
 *
 * PRESERVES all config: product_t, plan_t, deal_t, discount_t, rate_t,
 * rate_plan_t, rate_plan_selector_t, config_t, strings_t, and every AU_ audit
 * and _BAK_ backup table. Those are never referenced for deletion.
 *
 * Scope is airtight: every delete is filtered to Group 6 accounts, defined as
 * the accounts that own a /service/nextaig6 service. Other groups' rows can
 * never match these predicates.
 *
 * BRM tables have no DB-level foreign keys, so order is for tidiness only.
 *
 *   node scripts/g6-purge.mjs            # DRY RUN: print per-table counts, change nothing
 *   node scripts/g6-purge.mjs --apply    # CTAS-backup each table, then delete, then COMMIT
 *
 * --apply writes backups to tables named  G6BAK_<runId>_<n>  and a manifest
 * scripts/g6-purge-backup-<runId>.json  mapping backup -> source for restore.
 */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("C:/Users/toan/Desktop/NextAI/");
const oracledb = require("oracledb");
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const env = {};
for (const line of fs.readFileSync("C:/Users/toan/Desktop/NextAI/.env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const SVC = "/service/nextaig6";
const APPLY = process.argv.includes("--apply");
const NOBACKUP = process.argv.includes("--no-backup");

// Group 6 scoping subqueries (no huge literal id lists).
const G6ACCT = `(select a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type='${SVC}')`;
const G6EVENT = `(select e.poid_id0 from event_t e where e.account_obj_id0 in ${G6ACCT})`;

// Account-scoped tables (deleted by ACCOUNT_OBJ_ID0). Explicit allowlist — the
// purge can only ever touch tables named here.
const ACCT_TABLES = [
  "EVENT_BAL_IMPACTS_T", "EVENT_BAL_IMPACTS_T_MP", "EVENT_BILLING_TAXES_T",
  "EVENT_BILLING_BUNDLE_T", "EVENT_INV_ACTIVITIES_T", "EVENT_CUSTOMER_NOTE_T", "EVENT_T",
  "ITEM_T", "BILL_T", "BILLINFO_T",
  "PURCHASED_PRODUCT_T", "PURCHASED_DISCOUNT_T", "PURCHASED_BUNDLE_T", "PURCHASED_DEPOSIT_T",
  "BAL_GRP_T", "ORDERED_BALGROUP_T",
  "SERVICE_T", "SUBSCRIBER_CONTRACT_T", "DEVICE_SERVICES_T", "DEVICE_T",
  "PAYINFO_T", "PROFILE_T", "INVOICE_T", "NEWSFEED_T", "NOTE_T",
  "UNIQUENESS_T", "UNIQUE_ACCT_NO_T", "CONGERO_INFO_G6_T", "JOURNAL_T",
];
// Tables keyed by the account poid itself (OBJ_ID0 = account).
const ACCT_OBJ_TABLES = ["ACCOUNT_NAMEINFO_T"];

const conn = await oracledb.getConnection({ user: env.ORACLE_USER, password: env.ORACLE_PASSWORD, connectString: env.ORACLE_CONNECT_STRING });
const sel = async (sql, b = {}) => (await conn.execute(sql, b, { maxRows: 5000 })).rows;
const exec = async (sql) => (await conn.execute(sql, [], { autoCommit: false }));

async function cols(table) {
  const r = await sel(`select column_name from all_tab_columns where table_name='${table}' and owner=sys_context('USERENV','CURRENT_SCHEMA')`);
  return new Set(r.map((x) => x.COLUMN_NAME));
}
async function tableExists(t) {
  return (await sel(`select 1 from all_tables where table_name='${t}' and owner=sys_context('USERENV','CURRENT_SCHEMA')`)).length > 0;
}

try {
  const acct = Number((await sel(`select count(*) c from account_t where poid_id0 in ${G6ACCT}`))[0].C);
  if (acct === 0) { console.log("No Group 6 accounts found — nothing to purge."); process.exit(0); }

  // Build the work plan: { table, predicate, count }
  const plan = [];

  // 1) event-only child/subclass tables keyed by event poid (not in ACCT allowlist)
  const evTabs = (await sel(`select table_name from all_tables where owner=sys_context('USERENV','CURRENT_SCHEMA') and (table_name like 'EVENT\\_%' escape '\\' or table_name='EVENT_SESSION_USAGE2_G6') order by table_name`)).map((r) => r.TABLE_NAME);
  for (const t of evTabs) {
    if (t === "EVENT_T" || ACCT_TABLES.includes(t) || t.startsWith("AU_") || t.includes("_BAK")) continue;
    const c = await cols(t);
    const key = c.has("OBJ_ID0") ? "OBJ_ID0" : c.has("POID_ID0") ? "POID_ID0" : null;
    if (!key) continue;
    plan.push({ table: t, pred: `${key} in ${G6EVENT}` });
  }

  // 2) account-scoped allowlist
  for (const t of ACCT_TABLES) {
    if (!(await tableExists(t))) continue;
    const c = await cols(t);
    if (!c.has("ACCOUNT_OBJ_ID0")) { console.log(`  (skip ${t}: no ACCOUNT_OBJ_ID0)`); continue; }
    plan.push({ table: t, pred: `account_obj_id0 in ${G6ACCT}` });
  }

  // 3) tables keyed by account poid
  for (const t of ACCT_OBJ_TABLES) {
    if (!(await tableExists(t))) continue;
    plan.push({ table: t, pred: `obj_id0 in ${G6ACCT}` });
  }

  // 4) the accounts themselves (must be last)
  plan.push({ table: "ACCOUNT_T", pred: `poid_id0 in ${G6ACCT}` });

  // Count everything
  let grand = 0;
  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — Group 6 accounts: ${acct}\n`);
  console.log("table".padEnd(34), "rows to delete");
  for (const p of plan) {
    p.count = Number((await sel(`select count(*) c from ${p.table} where ${p.pred}`))[0].C);
    grand += p.count;
    if (p.count > 0) console.log(p.table.padEnd(34), p.count);
  }
  console.log("".padEnd(34, "-"));
  console.log("TOTAL rows".padEnd(34), grand);

  if (!APPLY) {
    console.log("\nDRY RUN only — nothing changed. Re-run with --apply to back up and delete.");
    process.exit(0);
  }

  const work = plan.filter((x) => x.count > 0);
  const runId = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const manifest = { runId, svc: SVC, accounts: acct, tables: [] };

  // Phase 1 — back up every affected table first. CTAS is DDL and auto-commits,
  // so if the run dies here you are left with backups and ZERO deletions.
  // Skipped entirely with --no-backup (then the delete is irreversible).
  if (NOBACKUP) {
    console.log("\n--no-backup: skipping backups; deletion will be irreversible.");
  } else {
    let n = 0;
    for (const p of work) {
      p.bak = `G6BAK_${runId}_${n++}`;
      await exec(`create table ${p.bak} as select * from ${p.table} where ${p.pred}`);
      manifest.tables.push({ source: p.table, backup: p.bak, rows: p.count });
      console.log(`  backed up ${p.table} -> ${p.bak} (${p.count})`);
    }
    fs.writeFileSync(`C:/Users/toan/Desktop/NextAI/scripts/g6-purge-backup-${runId}.json`, JSON.stringify(manifest, null, 2));
    console.log(`  manifest: scripts/g6-purge-backup-${runId}.json`);
  }

  // Phase 2 — delete everything in a single transaction; any error rolls back
  // all deletes (backups, already committed by the DDL above, are kept).
  let deleted = 0;
  for (const p of work) {
    const del = await exec(`delete from ${p.table} where ${p.pred}`);
    deleted += del.rowsAffected ?? 0;
    console.log(`  deleted ${p.table}: ${del.rowsAffected}`);
  }
  await conn.commit();
  console.log(`\nCOMMITTED. Deleted ${deleted} rows. Backups: G6BAK_${runId}_*  Restore from the manifest if needed.`);
} catch (e) {
  await conn.rollback().catch(() => {});
  console.error("ERROR (rolled back):", e.message);
  process.exitCode = 1;
} finally {
  await conn.close();
}
