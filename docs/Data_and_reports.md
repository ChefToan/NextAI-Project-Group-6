# Data And Reports

This file explains the Group 6 BRM data model, dashboard metrics, and useful
report-builder test prompts.

## Group 6 Data Model

Everything is scoped to `/service/nextaig6`.

- `account_t`: customer account.
- `service_t`: the customer's NextAI service and login.
- `purchased_product_t`: the plan/product attached to the service.
- `event_t`: usage events; Group 6 usage uses `/event/session/usagegr6`.
- `event_session_usage2_g6`: Group 6 usage details such as model and tokens.
- `event_bal_impacts_t`: rated money/counter impacts.
- `event_billing_taxes_t`: tax evidence when BRM writes tax rows.
- `bill_t`: bill headers and outstanding AR.

Important fields:

- `MODEL_CODE2_G6`: model code, usually `3.0` or `3.5`.
- `INPUT_TOKENS2_G6` and `OUTPUT_TOKENS2_G6`: token counts.
- `TRANSACTION_ID2_G6`: usage marker, often carrying an L01-L10 tier.
- `RUM_NAME`: `PromptG6` or `TokensG6`.
- `START_T`: the event time used for charts and date filters.
- `resource_id = 840`: USD money impact.
- `resource_id = 1000107`: prompt allowance counter.
- `resource_id = 1000108`: token allowance counter.

## Billing Concepts

BRM uses a simulated clock called `pin_virtual_time`. Demo scripts must save the
virtual-time file before changing it and restore it when done.

Customers are created through BRM customer commit logic, not direct SQL row
cloning, because BRM must create account, service, billinfo, balance group, and
purchased products consistently.

Usage is submitted as a BRM usage event. BRM rates it immediately and writes
balance impacts. Billing closes cycles with `pin_bill_accts`.

## Dashboard Metrics

`lib/group6-usage.ts` turns Oracle rows into the dashboard object used by pages,
charts, reports, and AI. It calculates:

- revenue, events, prompts, token totals, and active accounts
- model split for 3.0 vs 3.5
- daily, weekly, hourly, and day-of-week usage
- plan/product mix
- usage intensity tiers
- tax, AR, pricing, and exception checks
- derived facts such as peak hour and current data range

## Report Builder

Preset reports are curated in `lib/report-definitions.ts`.

Custom reports are built from a safe catalog:

- dimensions: account, model, RUM, day/month/hour, GL ID, revenue type
- measures: event count, active accounts, prompts, input/output/total tokens,
  token blocks, and usage revenue
- filters: only the operators allowed by the catalog
- sorting and limits: validated before SQL generation

AI report drafting only returns a proposed catalog selection. The server
validates it again before SQL runs.

## Useful Test Questions

Try these in the report builder's `Custom query -> Ask AI` box:

1. `usage revenue by model, top 5 rows`
2. `daily usage events and usage revenue by day, sorted newest first, limit 10`
3. `compare prompts and total tokens for Odyssey 3.0 versus Odyssey 3.5`
4. `show usage revenue by revenue type and GL ID`
5. `top hours of day by usage events and token blocks, limit 5`
6. `show total prompts and output tokens by model`
7. `usage revenue by month, sorted by revenue descending`
8. `top 10 accounts by total tokens`

Expected behavior:

- The AI selection should use only catalog field IDs.
- Preview should return rows or a clear unavailable/error state.
- CSV/JSON download should enable only after rows exist.
- Empty AI prompts should show `Describe the report you want.`

Latest live validation on 2026-07-02 matched AI-generated rows/totals against
baseline custom selections for five prompts. Four matched exactly on first run;
after provider retry and model-alias normalization, all five passed.
