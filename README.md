# NextAI — Group 6 Billing Console

A Next.js 15 dashboard over an Oracle BRM billing database, scoped to Group 6
(`/service/nextaig6`, Odyssey 3.0 / 3.5). Two pages: **Overview** (`/`) and
**Statistics & Report** (`/report`), plus a Gemini/OpenRouter-powered assistant.

## Prerequisites
- Node.js 18+ and npm
- Read access to the Oracle BRM DB via an SSH tunnel to `localhost:1521/orclpdb`
- (Optional) a Google AI Studio / Gemini API key for the assistant

## Get it running
```bash
# 1. install dependencies
npm install

# 2. configure environment
cp .env.example .env.local
#    then edit .env.local: set GEMINI_API_KEY and the OCI_SSH_* values

# 3. open the SSH tunnel to Oracle (keep this terminal running)
npm run db:tunnel

# 4. start the dev server
npm run dev
```
Open **http://localhost:3000**.

## Useful scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (hot reload) |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` | Run Vitest unit and route tests |
| `npm run lint` | Run ESLint without the deprecated interactive Next lint flow |
| `npm run db:tunnel` | Open the SSH tunnel to the Oracle host |
| `npm run db:health` | Check the DB connection |

## Report builder
- `/report` includes preset reports and a custom catalog-driven report builder.
- Custom report SQL is built only from allow-listed dimensions/measures in
  `lib/metrics-catalog.ts`; user values are bound parameters.
- AI report drafting uses `POST /api/group6/report/ai` and validates model output
  against the same catalog before a query can run.
- See [docs/Data_and_reports.md](./docs/Data_and_reports.md) for API examples,
  report prompts, provider behavior, and smoke checks.

## Notes
- Without the tunnel, DB-backed dashboard routes return a "not connected" state;
  report previews return a graceful unavailable message when Oracle cannot be
  reached.
- If no AI provider key is set, assistant/report-draft endpoints return clear
  configuration errors while the non-AI UI still works.
- Secrets live in `.env.local` (gitignored). See
  [docs/Infrastructure.md](./docs/Infrastructure.md) for environment and tunnel
  details.
