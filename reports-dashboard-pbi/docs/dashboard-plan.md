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
   - Revenue and usage KPIs plus GL/month charts.
   - Unmapped GL exception panel for `GL_ID = 0`.
   - Billing detail matrix by month, model, RUM, and GL ID.

## Design Rules

- Do not bind visuals to raw `REVENUE_TYPE`; use GL-based labels and exception measures instead.
- Avoid pie, donut, gauge, and map visuals for this workflow.
- Add detail only when it answers a billing or usage decision. Prefer replacing weak visuals over stacking more panels.
- Keep number formatting consistent: dollars for revenue, `K/M` for large counts, and clear token/event units.

## Validation Targets

- Usage events: `24,761`
- Usage revenue: `$3,099.95`
- Active accounts: `159`
- PBIR validation: `0` errors and `0` warnings.
