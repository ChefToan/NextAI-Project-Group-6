# Dashboard Plan

## Direction

Use a quiet SaaS/finance operations dashboard style. Keep the report practical, readable, and audit-friendly rather than adding decorative chart types.

## Data Flow

OCI Oracle BRM is the source of truth. `npm run pbi:export-refresh` exports Group 6 CSVs, refreshes the open PBIP model, verifies totals, validates PBIR, and reloads Power BI Desktop.

## Pages

1. Executive Overview
   - Header, source note, refresh reminder, and compact slicers for month, model, RUM, and GL ID.
   - KPIs for revenue, usage events, active accounts, and revenue per 1K tokens.
   - Daily revenue/events trends, revenue by model, revenue by GL ID, and monthly revenue summary.

2. Usage Quality
   - Same header and slicer bar for consistent filtering.
   - KPIs for tokens, prompts, average tokens per event, and token blocks.
   - Token trend, prompt/model split, hourly usage, and token volume by model.

3. Finance Detail
   - Same header and slicer bar.
   - Finance KPIs for billed, unbilled, AIT collected, and outstanding USD.
   - Billed vs unbilled dollars by month.
   - AIT expected vs collected by month.
   - Unbilled bill count by month, revenue by GL ID, and monthly tax/AR detail.

4. Customer Bills
   - Bill status, bill month, and customer-login slicers.
   - KPI cards for paid bills, unpaid bills, unbilled rows, and outstanding USD.
   - Bill count by status and outstanding USD by bill month.
   - Customer bill list showing status, customer login, bill reference, month, due date, billed, received, and outstanding amounts.

## Design Rules

- Do not bind visuals to raw `REVENUE_TYPE`; use GL-based labels and exception measures instead.
- Avoid pie, donut, gauge, and map visuals for this workflow.
- Add detail only when it answers a billing or usage decision. Prefer replacing weak visuals over stacking more panels.
- Keep number formatting consistent: dollars for revenue, `K/M` for large counts, and clear token/event units.
- Keep tax and AR metrics in `fact_group6_finance_monthly`; do not mix bill-level semantics into the daily usage fact.
- Keep customer-level paid/unpaid bill detail in `fact_group6_customer_bills`; do not aggregate away the bill reference needed for collection follow-up.

## Validation Targets

- Usage events: `24,761`
- Usage revenue: `$3,099.95`
- Active accounts: `160`
- Customer bill rows: latest export-dependent, currently `971`.
- PBIR validation: `0` errors and `0` warnings.
