/*
 * Group 6 edge-case data generator (reversible).
 *
 * Populates realistic, *real* edge-case values so the dashboard's status / AR /
 * tax-jurisdiction / exception metrics are non-trivial. Only touches safe,
 * reversible columns: account_t.status, account_nameinfo_t.state,
 * purchased_product_t.status, bill_t (RECVD/DISPUTED/WRITEOFF/ADJUSTED), and a
 * small plan reassignment so cheaper plans carry more users.
 *
 * Usage (run from project root, tunnel up):
 *   node scripts/g6-edgecases.mjs            # dry-run: print the plan, change nothing
 *   node scripts/g6-edgecases.mjs --apply    # snapshot to JSON, then apply
 *   node scripts/g6-edgecases.mjs --rollback # restore from the snapshot JSON
 *
 * Never touches plan/product/deal/rate/tax CONFIG. AIT "collected" stays $0
 * (needs a server-side re-bill) — that gap is a real, intended finding.
 */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("C:/Users/toan/Desktop/NextAI/");
const oracledb = require("oracledb");
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const env = {};
for (const line of fs.readFileSync("C:/Users/toan/Desktop/NextAI/.env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const SVC = "/service/nextaig6";
const SNAP = "C:/Users/toan/Desktop/NextAI/scripts/g6-edgecases-snapshot.json";
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--rollback") ? "rollback" : "dry";

function statusFor(i, total) {
  const p = i / total;
  if (p >= 0.94) return 10103; // closed ~6%
  if (p >= 0.82) return 10102; // inactive ~12%
  return 10100; // active ~82%
}
function stateFor(i) {
  const r = i % 20;
  if (r < 11) return "VA"; // 55% (0% tax)
  if (r < 15) return "NY"; // 20%
  if (r < 18) return "CA"; // 15%
  return "TX"; // 10%
}

const conn = await oracledb.getConnection({ user: env.ORACLE_USER, password: env.ORACLE_PASSWORD, connectString: env.ORACLE_CONNECT_STRING });

async function q(sql, binds = {}) {
  const r = await conn.execute(sql, binds, { autoCommit: false });
  return r;
}

try {
  if (mode === "rollback") {
    if (!fs.existsSync(SNAP)) throw new Error("No snapshot file to roll back from.");
    const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    for (const a of snap.accounts) await q(`update account_t set status=:s where poid_id0=:id`, { s: a.status, id: a.acct });
    for (const a of snap.nameinfo) await q(`update account_nameinfo_t set state=:s where obj_id0=:id`, { s: a.state, id: a.acct });
    for (const p of snap.pp) await q(`update purchased_product_t set status=:s, product_obj_id0=:po, plan_obj_id0=:pl where poid_id0=:id`, { s: p.status, po: p.product, pl: p.plan, id: p.id });
    for (const b of snap.bills) await q(`update bill_t set recvd=:r, disputed=:d, writeoff=:w, adjusted=:a where poid_id0=:id`, { r: b.recvd, d: b.disputed, w: b.writeoff, a: b.adjusted, id: b.id });
    await conn.commit();
    console.log(`Rolled back ${snap.accounts.length} accounts, ${snap.bills.length} bills.`);
    process.exit(0);
  }

  // load G6 accounts (sorted for determinism) + related rows
  const accts = (await q(`select a.poid_id0 acct from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type=:t order by a.poid_id0`, { t: SVC })).rows.map((r) => r.ACCT);
  const total = accts.length;
  const ppRows = (await q(`select pp.poid_id0 id, pp.account_obj_id0 acct, pp.status, pp.product_obj_id0 product, pp.plan_obj_id0 plan from purchased_product_t pp join service_t s on s.poid_id0=pp.service_obj_id0 where s.poid_type=:t`, { t: SVC })).rows;
  const billRows = (await q(`select poid_id0 id, account_obj_id0 acct, total_due, recvd, disputed, writeoff, adjusted from bill_t where account_obj_id0 in (select a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type=:t)`, { t: SVC })).rows;
  const niRows = (await q(`select obj_id0 acct, state from account_nameinfo_t where obj_id0 in (select a.poid_id0 from account_t a join service_t s on s.account_obj_id0=a.poid_id0 where s.poid_type=:t)`, { t: SVC })).rows;

  // cheapest plan/product to receive reassigned users
  const cheap = (await q(`select pp.product_obj_id0 product, pp.plan_obj_id0 plan from purchased_product_t pp join product_t p on p.poid_id0=pp.product_obj_id0 join service_t s on s.poid_id0=pp.service_obj_id0 where s.poid_type=:t and lower(p.name) like '%$10 usd%' and rownum=1`, { t: SVC })).rows[0];

  const idx = new Map(accts.map((a, i) => [a, i]));
  const plan = { accounts: [], nameinfo: [], pp: [], bills: [] };

  // status + state
  for (const a of accts) {
    const i = idx.get(a);
    plan.accounts.push({ acct: a, status: statusFor(i, total) });
    plan.nameinfo.push({ acct: a, state: stateFor(i) });
  }
  // purchased product: ~6% suspended (status 2); reassign 6 accts to cheapest plan
  const reassign = new Set([Math.floor(total * 0.74), Math.floor(total * 0.76), Math.floor(total * 0.78), Math.floor(total * 0.80), Math.floor(total * 0.83), Math.floor(total * 0.86)]);
  for (const pp of ppRows) {
    const i = idx.get(pp.ACCT) ?? 0;
    const suspend = i % 17 === 0;
    const re = reassign.has(i) && cheap;
    plan.pp.push({ id: pp.ID, status: suspend ? 2 : 1, product: re ? cheap.PRODUCT : pp.PRODUCT, plan: re ? cheap.PLAN : pp.PLAN });
  }
  // bills: payments / disputes / writeoffs / adjustments
  for (const b of billRows) {
    const i = idx.get(b.ACCT) ?? 0;
    const due = Number(b.TOTAL_DUE) || 0;
    let recvd = due, disputed = 0, writeoff = 0, adjusted = 0;
    if (i % 41 === 0) recvd = 0;            // ~2% unpaid
    else if (i % 17 === 0) recvd = Math.round(due * 0.5 * 100) / 100; // partial
    if (i % 23 === 0) { disputed = Math.round(due * 0.3 * 100) / 100; recvd = Math.max(0, due - disputed); } // ~4% disputed
    if (i % 47 === 0) { writeoff = due; recvd = 0; }  // ~2% written off
    if (i % 29 === 0) adjusted = -5;        // small credits
    plan.bills.push({ id: b.ID, recvd, disputed, writeoff, adjusted });
  }

  if (mode === "dry") {
    const sc = { active: 0, inactive: 0, closed: 0 };
    for (const a of plan.accounts) sc[a.status === 10100 ? "active" : a.status === 10102 ? "inactive" : "closed"]++;
    const states = {};
    for (const n of plan.nameinfo) states[n.state] = (states[n.state] || 0) + 1;
    const suspended = plan.pp.filter((p) => p.status === 2).length;
    const disputed = plan.bills.filter((b) => b.disputed > 0).length;
    const unpaid = plan.bills.filter((b) => b.recvd === 0).length;
    console.log("DRY RUN — would apply:");
    console.log(" status:", sc, "| states:", states, "| suspended subs:", suspended, "| reassigned:", reassign.size);
    console.log(" bills disputed:", disputed, "| bills unpaid/writeoff:", unpaid, "| total bills:", plan.bills.length);
    console.log(" cheapest plan target:", cheap ? `product ${cheap.PRODUCT}/plan ${cheap.PLAN}` : "NOT FOUND");
    console.log("Run with --apply to snapshot + write.");
    process.exit(0);
  }

  // APPLY — snapshot current values first
  const snap = {
    accounts: accts.map((a) => ({ acct: a, status: 10100 })),
    nameinfo: niRows.map((r) => ({ acct: r.ACCT, state: r.STATE })),
    pp: ppRows.map((p) => ({ id: p.ID, status: p.STATUS, product: p.PRODUCT, plan: p.PLAN })),
    bills: billRows.map((b) => ({ id: b.ID, recvd: b.RECVD, disputed: b.DISPUTED, writeoff: b.WRITEOFF, adjusted: b.ADJUSTED })),
  };
  // capture true current account status
  for (const r of (await q(`select poid_id0 acct, status from account_t where poid_id0 in (${accts.join(",")})`)).rows) {
    const s = snap.accounts.find((x) => x.acct === r.ACCT); if (s) s.status = r.STATUS;
  }
  fs.writeFileSync(SNAP, JSON.stringify(snap, null, 0));
  console.log(`Snapshot written: ${SNAP}`);

  for (const a of plan.accounts) await q(`update account_t set status=:s where poid_id0=:id`, { s: a.status, id: a.acct });
  for (const n of plan.nameinfo) await q(`update account_nameinfo_t set state=:s where obj_id0=:id`, { s: n.state, id: n.acct });
  for (const p of plan.pp) await q(`update purchased_product_t set status=:s, product_obj_id0=:po, plan_obj_id0=:pl where poid_id0=:id`, { s: p.status, po: p.product, pl: p.plan, id: p.id });
  for (const b of plan.bills) await q(`update bill_t set recvd=:r, disputed=:d, writeoff=:w, adjusted=:a where poid_id0=:id`, { r: b.recvd, d: b.disputed, w: b.writeoff, a: b.adjusted, id: b.id });
  await conn.commit();
  console.log(`Applied to ${plan.accounts.length} accounts, ${plan.bills.length} bills. Rollback: node scripts/g6-edgecases.mjs --rollback`);
} catch (e) {
  await conn.rollback().catch(() => {});
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await conn.close();
}
