import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const oracledb = require("oracledb");
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_TYPE = "/service/nextaig6";
const DEFAULT_OUT = "C:\\Users\\toan\\Documents\\Codex\\2026-06-27\\a\\outputs\\group6_customer_product_usage.xlsx";

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name);
  return ix >= 0 && process.argv[ix + 1] ? process.argv[ix + 1] : fallback;
}

function statusLabel(status) {
  const n = Number(status);
  if (n === 10100) return "Active";
  if (n === 10102) return "Inactive";
  if (n === 10103) return "Closed";
  return status == null ? "" : `Status ${status}`;
}

function purchasedStatusLabel(status) {
  const n = Number(status);
  if (n === 1) return "Active";
  if (n === 2) return "Suspended";
  if (n === 3) return "Cancelled";
  return status == null ? "" : `Status ${status}`;
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function isNumeric(value) {
  return typeof value === "number" || (typeof value === "string" && value !== "" && /^-?\d+(?:\.\d+)?$/.test(value));
}

function sheetXml(rows) {
  const widths = rows[0]?.map((_, i) => {
    const max = Math.min(42, Math.max(10, ...rows.map((r) => String(r[i] ?? "").length + 2)));
    return `<col min="${i + 1}" max="${i + 1}" width="${max}" customWidth="1"/>`;
  }).join("") ?? "";

  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (isNumeric(value)) return `<c r="${ref}" t="n"><v>${xml(value)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${widths}</cols>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`;
}

function workbookRels(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypes(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function writeWorkbook(file, sheets) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "nextai-g6-xlsx-"));
  const zipFile = path.join(os.tmpdir(), `nextai-g6-${Date.now()}.zip`);
  try {
    fs.mkdirSync(path.join(staging, "_rels"), { recursive: true });
    fs.mkdirSync(path.join(staging, "xl", "_rels"), { recursive: true });
    fs.mkdirSync(path.join(staging, "xl", "worksheets"), { recursive: true });
    fs.writeFileSync(path.join(staging, "[Content_Types].xml"), contentTypes(sheets));
    fs.writeFileSync(path.join(staging, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    fs.writeFileSync(path.join(staging, "xl", "workbook.xml"), workbookXml(sheets));
    fs.writeFileSync(path.join(staging, "xl", "_rels", "workbook.xml.rels"), workbookRels(sheets));
    fs.writeFileSync(path.join(staging, "xl", "styles.xml"), stylesXml());
    sheets.forEach((sheet, i) => fs.writeFileSync(path.join(staging, "xl", "worksheets", `sheet${i + 1}.xml`), sheetXml(sheet.rows)));

    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ps = [
      "$ErrorActionPreference = 'Stop'",
      `$dest = ${JSON.stringify(file)}`,
      `$zip = ${JSON.stringify(zipFile)}`,
      `$src = ${JSON.stringify(staging)}`,
      "if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }",
      "if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }",
      "$items = Get-ChildItem -LiteralPath $src -Force",
      "Compress-Archive -Path $items.FullName -DestinationPath $zip -Force",
      "Move-Item -LiteralPath $zip -Destination $dest -Force",
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Compress-Archive failed");
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(zipFile, { force: true });
  }
}

async function main() {
  const env = loadEnv(path.join(PROJECT_ROOT, ".env.local"));
  const outFile = argValue("--out", DEFAULT_OUT);
  const conn = await oracledb.getConnection({
    user: env.ORACLE_USER,
    password: env.ORACLE_PASSWORD,
    connectString: env.ORACLE_CONNECT_STRING,
  });

  async function query(sql, binds = {}, maxRows = 20000) {
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows });
    return result.rows ?? [];
  }

  try {
    const summaryRows = await query(
      `with g6 as (
         select distinct a.poid_id0 account_id
           from account_t a join service_t s on s.account_obj_id0 = a.poid_id0
          where s.poid_type = :svc
       )
       select 'accounts' metric, to_char(count(*)) value from g6
       union all select 'services', to_char(count(*)) from service_t where poid_type = :svc
       union all select 'purchased_products', to_char(count(*)) from purchased_product_t pp join service_t s on s.poid_id0 = pp.service_obj_id0 where s.poid_type = :svc
       union all select 'bills', to_char(count(*)) from bill_t where account_obj_id0 in (select account_id from g6)
       union all select 'usage_events', to_char(count(*)) from event_t where poid_type = '/event/session/usagegr6'
       union all select 'usage_min_start_utc', to_char(date '1970-01-01' + min(start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') from event_t where poid_type = '/event/session/usagegr6'
       union all select 'usage_max_start_utc', to_char(date '1970-01-01' + max(start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') from event_t where poid_type = '/event/session/usagegr6'
       union all select 'bill_min_start_utc', to_char(date '1970-01-01' + min(start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') from bill_t where account_obj_id0 in (select account_id from g6)
       union all select 'bill_max_start_utc', to_char(date '1970-01-01' + max(start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') from bill_t where account_obj_id0 in (select account_id from g6)
       union all select 'purchase_min_start_utc', to_char(date '1970-01-01' + min(pp.purchase_start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') from purchased_product_t pp join service_t s on s.poid_id0 = pp.service_obj_id0 where s.poid_type = :svc
       union all select 'purchase_max_start_utc', to_char(date '1970-01-01' + max(pp.purchase_start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') from purchased_product_t pp join service_t s on s.poid_id0 = pp.service_obj_id0 where s.poid_type = :svc`,
      { svc: SERVICE_TYPE },
    );

    const customerRows = await query(
      `with g6 as (
         select distinct a.poid_id0 account_id, a.status account_status,
                to_char(date '1970-01-01' + a.created_t/86400, 'YYYY-MM-DD HH24:MI:SS') account_created_utc,
                s.poid_id0 service_id, s.status service_status
           from account_t a join service_t s on s.account_obj_id0 = a.poid_id0
          where s.poid_type = :svc
       ),
       ni as (
         select obj_id0 account_id,
                max(first_name) first_name, max(last_name) last_name, max(company) company, max(state) state
           from account_nameinfo_t
          where obj_id0 in (select account_id from g6)
          group by obj_id0
       ),
       usage as (
         select e.account_obj_id0 account_id,
                count(*) usage_events,
                sum(case when e.rum_name = 'PromptG6' then 1 else 0 end) prompts,
                sum(u.input_tokens2_g6) input_tokens,
                sum(u.output_tokens2_g6) output_tokens,
                round(sum(nvl(bi.amount,0)),2) usage_revenue,
                to_char(date '1970-01-01' + min(e.start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') first_usage_utc,
                to_char(date '1970-01-01' + max(e.start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') last_usage_utc,
                max(u.model_code2_g6) model_code
           from event_t e
           join EVENT_SESSION_USAGE2_G6 u on u.obj_id0 = e.poid_id0
           left join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840
          where e.poid_type = '/event/session/usagegr6'
          group by e.account_obj_id0
       ),
       bills as (
         select account_obj_id0 account_id,
                count(*) bill_count,
                round(sum(total_due),2) total_due,
                round(sum(recvd),2) total_received,
                round(sum(total_due - recvd - writeoff + adjusted),2) outstanding,
                to_char(date '1970-01-01' + min(start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') first_bill_start_utc,
                to_char(date '1970-01-01' + max(start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') last_bill_start_utc,
                to_char(date '1970-01-01' + max(case when end_t > 0 then end_t end)/86400, 'YYYY-MM-DD HH24:MI:SS') last_bill_end_utc
           from bill_t
          where account_obj_id0 in (select account_id from g6)
          group by account_obj_id0
       )
       select g.account_id, nvl(ni.company, trim(ni.first_name || ' ' || ni.last_name)) customer_name, ni.state,
              g.account_status, g.service_id, g.service_status,
              pp.poid_id0 purchased_product_id, pp.status purchased_status, pp.quantity,
              p.name product_name, pl.name plan_name,
              to_char(date '1970-01-01' + pp.purchase_start_t/86400, 'YYYY-MM-DD HH24:MI:SS') purchase_start_utc,
              to_char(date '1970-01-01' + pp.cycle_start_t/86400, 'YYYY-MM-DD HH24:MI:SS') cycle_start_utc,
              to_char(date '1970-01-01' + pp.usage_start_t/86400, 'YYYY-MM-DD HH24:MI:SS') usage_start_utc,
              g.account_created_utc,
              nvl(u.usage_events,0) usage_events, nvl(u.prompts,0) prompts,
              nvl(u.input_tokens,0) input_tokens, nvl(u.output_tokens,0) output_tokens,
              nvl(u.input_tokens,0) + nvl(u.output_tokens,0) total_tokens,
              nvl(u.usage_revenue,0) usage_revenue, u.first_usage_utc, u.last_usage_utc, u.model_code,
              nvl(b.bill_count,0) bill_count, nvl(b.total_due,0) total_due,
              nvl(b.total_received,0) total_received, nvl(b.outstanding,0) outstanding,
              b.first_bill_start_utc, b.last_bill_start_utc, b.last_bill_end_utc
         from g6 g
         left join ni on ni.account_id = g.account_id
         left join purchased_product_t pp on pp.account_obj_id0 = g.account_id and pp.service_obj_id0 = g.service_id
         left join product_t p on p.poid_id0 = pp.product_obj_id0
         left join plan_t pl on pl.poid_id0 = pp.plan_obj_id0
         left join usage u on u.account_id = g.account_id
         left join bills b on b.account_id = g.account_id
        order by g.account_id, pp.purchase_start_t desc`,
      { svc: SERVICE_TYPE },
    );

    const usageByMonthRows = await query(
      `select e.account_obj_id0 account_id,
              to_char(date '1970-01-01' + e.start_t/86400, 'YYYY-MM') usage_month,
              u.model_code2_g6 model_code,
              count(*) usage_events,
              sum(case when e.rum_name = 'PromptG6' then 1 else 0 end) prompts,
              sum(u.input_tokens2_g6) input_tokens,
              sum(u.output_tokens2_g6) output_tokens,
              round(sum(nvl(bi.amount,0)),2) usage_revenue,
              to_char(date '1970-01-01' + min(e.start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') first_usage_utc,
              to_char(date '1970-01-01' + max(e.start_t)/86400, 'YYYY-MM-DD HH24:MI:SS') last_usage_utc
         from event_t e
         join EVENT_SESSION_USAGE2_G6 u on u.obj_id0 = e.poid_id0
         left join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840
        where e.poid_type = '/event/session/usagegr6'
        group by e.account_obj_id0, to_char(date '1970-01-01' + e.start_t/86400, 'YYYY-MM'), u.model_code2_g6
        order by account_id, usage_month, model_code`,
    );

    const catalogRows = await query(
      `select 'Product' catalog_type, poid_id0 id, name, descr, permitted scope,
              to_char(date '1970-01-01' + created_t/86400, 'YYYY-MM-DD HH24:MI:SS') created_utc,
              to_char(date '1970-01-01' + mod_t/86400, 'YYYY-MM-DD HH24:MI:SS') modified_utc,
              case when mod_t > created_t then 'Yes' else 'No' end modified_after_create
         from product_t
        where permitted = :svc or lower(name) like '%group 6%'
       union all
       select 'Plan', poid_id0, name, descr, null,
              to_char(date '1970-01-01' + created_t/86400, 'YYYY-MM-DD HH24:MI:SS'),
              to_char(date '1970-01-01' + mod_t/86400, 'YYYY-MM-DD HH24:MI:SS'),
              case when mod_t > created_t then 'Yes' else 'No' end
         from plan_t
        where lower(name) like '%group 6%' or lower(descr) like '%group 6%'
        order by catalog_type, name`,
      { svc: SERVICE_TYPE },
    );

    const summary = [
      ["Metric", "Value"],
      ...summaryRows.map((r) => [r.METRIC, r.VALUE]),
      ["dashboard_range_basis", "Usage event start time"],
      ["inverted_range_fix", "Custom ranges where from > to are normalized before querying and in the URL."],
      ["observed_empty_range_cause", "2026-01-26 to 2026-01-18 was empty because the previous code queried start_t >= Jan 26 and <= Jan 18."],
    ];

    const customers = [
      ["Account ID", "Customer", "State", "Account Status", "Service ID", "Service Status", "Purchased Product ID", "Purchased Status", "Quantity", "Product", "Plan", "Purchase Start UTC", "Cycle Start UTC", "Usage Start UTC", "Account Created UTC", "Usage Events", "Prompts", "Input Tokens", "Output Tokens", "Total Tokens", "Usage Revenue", "First Usage UTC", "Last Usage UTC", "Model", "Bill Count", "Total Due", "Total Received", "Outstanding", "First Bill Start UTC", "Last Bill Start UTC", "Last Bill End UTC"],
      ...customerRows.map((r) => [
        r.ACCOUNT_ID, r.CUSTOMER_NAME, r.STATE, statusLabel(r.ACCOUNT_STATUS), r.SERVICE_ID, statusLabel(r.SERVICE_STATUS),
        r.PURCHASED_PRODUCT_ID, purchasedStatusLabel(r.PURCHASED_STATUS), r.QUANTITY, r.PRODUCT_NAME, r.PLAN_NAME,
        r.PURCHASE_START_UTC, r.CYCLE_START_UTC, r.USAGE_START_UTC, r.ACCOUNT_CREATED_UTC,
        r.USAGE_EVENTS, r.PROMPTS, r.INPUT_TOKENS, r.OUTPUT_TOKENS, r.TOTAL_TOKENS, r.USAGE_REVENUE,
        r.FIRST_USAGE_UTC, r.LAST_USAGE_UTC, r.MODEL_CODE, r.BILL_COUNT, r.TOTAL_DUE, r.TOTAL_RECEIVED,
        r.OUTSTANDING, r.FIRST_BILL_START_UTC, r.LAST_BILL_START_UTC, r.LAST_BILL_END_UTC,
      ]),
    ];

    const usageByMonth = [
      ["Account ID", "Usage Month", "Model", "Usage Events", "Prompts", "Input Tokens", "Output Tokens", "Total Tokens", "Usage Revenue", "First Usage UTC", "Last Usage UTC"],
      ...usageByMonthRows.map((r) => [
        r.ACCOUNT_ID, r.USAGE_MONTH, r.MODEL_CODE, r.USAGE_EVENTS, r.PROMPTS, r.INPUT_TOKENS, r.OUTPUT_TOKENS,
        Number(r.INPUT_TOKENS || 0) + Number(r.OUTPUT_TOKENS || 0), r.USAGE_REVENUE, r.FIRST_USAGE_UTC, r.LAST_USAGE_UTC,
      ]),
    ];

    const catalog = [
      ["Catalog Type", "ID", "Name", "Description", "Scope", "Created UTC", "Modified UTC", "Modified After Create"],
      ...catalogRows.map((r) => [r.CATALOG_TYPE, r.ID, r.NAME, r.DESCR, r.SCOPE, r.CREATED_UTC, r.MODIFIED_UTC, r.MODIFIED_AFTER_CREATE]),
    ];

    writeWorkbook(outFile, [
      { name: "Summary", rows: summary },
      { name: "Customers", rows: customers },
      { name: "Usage by Month", rows: usageByMonth },
      { name: "Product Plan Catalog", rows: catalog },
    ]);

    console.log(`Wrote ${outFile}`);
    console.log(`Customers: ${customerRows.length}`);
    console.log(`Usage-month rows: ${usageByMonthRows.length}`);
    console.log(`Catalog rows: ${catalogRows.length}`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
