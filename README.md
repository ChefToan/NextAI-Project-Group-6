# NextAI Revenue Operations Hub

NextAI is Group 6's AI services business and revenue operations hub. The
project models a company that sells Odyssey 3.0 / 3.5 AI usage plans, rates that
usage through Oracle BRM, and gives operators a modern AI-assisted dashboard for
understanding customers, revenue, usage, bills, and report workflows.

The web app is a Next.js 15 alternative to a traditional Power BI-only workflow:
it reads live Group 6 BRM data from Oracle, turns it into operational charts and
safe report-builder queries, and layers Gemini/OpenRouter-powered assistance on
top so users can ask questions, draft reports, and move faster without writing
SQL by hand.

## What this project includes

- A customer and usage analytics dashboard for `/service/nextaig6`.
- A statistics and report workspace with preset reports, custom reports, and
  natural-language report drafting.
- Read-only Oracle access with guarded `SELECT` / `WITH` query execution.
- BRM-focused documentation, demo scripts, custom Group 6 opcode source, and
  validation runbooks for the OCI server.
- A Power BI companion project under `reports-dashboard-pbi` for comparing the
  same Group 6 dataset in Power BI.

## Product scope

NextAI acts as the AI provider. Oracle BRM is the system of record for customer
creation, purchased products, usage events, rating, tax evidence, and billing.
This application sits above BRM as a workflow layer: it does not mutate billing
data, but it makes the live data easier to inspect, explain, and turn into
decision-ready reports.

Current dashboard scope:

- Group 6 service type: `/service/nextaig6`
- AI service plans: Odyssey 3.0 and Odyssey 3.5
- Usage event type: `/event/session/usagegr6`
- Main app pages: **Overview** (`/`) and **Statistics & Report** (`/report`)
- AI features: chart summaries, dashboard chatbot, and report-selection drafting

## Prerequisites

- Node.js 18+ and npm
- Read access to the Oracle BRM DB through an SSH tunnel to
  `localhost:1521/orclpdb`
- Optional: Google AI Studio / Gemini or OpenRouter API key for AI assistance

## Get it running

```bash
# 1. install dependencies
npm install

# 2. configure environment
cp .env.example .env.local
#    then edit .env.local: set AI provider keys and the OCI_SSH_* values

# 3. open the SSH tunnel to Oracle (keep this terminal running)
npm run db:tunnel

# 4. start the dev server
npm run dev
```

Open **http://localhost:3000**.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` | Run Vitest unit and route tests |
| `npm run lint` | Run ESLint |
| `npm run db:tunnel` | Open the SSH tunnel to the Oracle host |
| `npm run db:health` | Check the DB connection |
| `npm run export:g6` | Export Group 6 customer/product/usage data |
| `npm run export:pbi` | Export the dataset used by the Power BI companion |

## Report builder

- `/report` includes preset reports and a catalog-driven custom report builder.
- Custom SQL is built only from allow-listed dimensions/measures in
  `lib/metrics-catalog.ts`; user values are always bound parameters.
- AI report drafting uses `POST /api/group6/report/ai`, then validates model
  output against the same catalog before any query can run.
- See [docs/Data_and_reports.md](./docs/Data_and_reports.md) for the data model,
  report prompts, provider behavior, and smoke checks.

## BRM and server context

The web app is read-only. Data creation and billing demos happen on the OCI BRM
server with tools such as `testnap`, custom Group 6 opcodes, `pin_virtual_time`,
and `pin_bill_accts`.

Useful references:

- [docs/Infrastructure.md](./docs/Infrastructure.md): system map, environment,
  tunnel, and production notes.
- [docs/G6_demo_opcode.md](./docs/G6_demo_opcode.md): custom opcode demo flow on
  the OCI server.
- [scripts/server/fm_naig6_pol](./scripts/server/fm_naig6_pol): Group 6 custom
  Function Module source and opcode mappings.

## Notes

- Without the tunnel, DB-backed dashboard routes return a not-connected state;
  report previews return a graceful unavailable message.
- If no AI provider key is set, assistant/report-draft endpoints return clear
  configuration errors while the non-AI UI still works.
- Secrets live in `.env.local` and must stay server-side. Do not expose Oracle
  or AI credentials through `NEXT_PUBLIC_` variables.
