# NextAI Power BI Reporting Workspace

This folder is the Power BI home for NextAI Group 6 dashboards. It is designed to keep source-controlled dashboard assets separate from generated data extracts.

## Folder Map

- `data/sql/` - read-only Oracle SQL used to validate and export reporting facts.
- `data/extracts/` - generated CSV files from OCI Oracle. This folder is intentionally ignored by git.
- `model/dax/` - starter DAX measures and semantic-model notes.
- `model/tmdl/` - exported Power BI model snapshots when `pbi database export-tmdl` is used.
- `report/` - PBIR report project files generated or edited by `pbi report` and `pbi visual`.
- `themes/` - Power BI JSON themes.
- `scripts/` - local export/build helpers.
- `mcp/` - notes for connecting Codex, pbi-cli, and any Power BI MCP bridge.

## Workflow

1. Start the NextAI database tunnel if needed:

   ```powershell
   npm run db:tunnel
   ```

2. Confirm the app can reach Oracle:

   ```powershell
   npm run db:health
   ```

3. Export Power BI-ready CSV files from OCI Oracle:

   ```powershell
   node .\reports-dashboard-pbi\scripts\export-group6-powerbi.mjs
   ```

4. Open the PBIP file in Power BI Desktop, then refresh and verify the imported model:

   ```powershell
   npm run pbi:refresh
   ```

   To pull fresh OCI data first and then refresh the open Desktop model:

   ```powershell
   npm run pbi:export-refresh
   ```

   PBIP source files store report/model metadata. Imported table data can reopen as `NoData`, so this command is the repeatable check that prevents blank visuals.

5. Validate generated report files:

   ```powershell
   pbi report --path ".\reports-dashboard-pbi\report\NextAIGroup6.Report\NextAI Group 6 Billing.Report" validate --full
   ```

## Dashboard Design

The PBIP report uses four pages: Executive Overview, Usage Quality, Finance Detail, and Customer Bills. Finance Detail includes tax and AR visuals backed by `fact_group6_finance_monthly`: billed vs unbilled by month, AIT expected vs collected, unbilled bill count, GL revenue, and monthly tax/AR detail. Customer Bills is backed by `fact_group6_customer_bills` and shows which customer bills are paid, unpaid, or not finalized yet.

Keep the dashboard business-focused. Do not add pie, donut, gauge, map, or decorative visuals unless a real billing workflow needs them. Prefer replacing weak visuals over adding more panels. Raw `REVENUE_TYPE` should stay out of visuals; use GL-based labels and the unmapped GL exception measures instead.

## MCP Note

An MCP server is not required to extract data from OCI or generate CSV, DAX, SQL, theme, and PBIR source files. It is useful when Codex needs to directly operate on a running Power BI semantic model without manual Desktop steps.

In this Codex session, no Power BI-specific MCP tools are currently exposed. The installed `pbi` CLI is available and can do most local Power BI work once Power BI Desktop is open and `pbi connect` succeeds.
