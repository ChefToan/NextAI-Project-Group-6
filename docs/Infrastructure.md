# NextAI Infrastructure

This site is a read-only Next.js dashboard for the Group 6 NextAI billing demo in
Oracle BRM. The BRM server creates customers, usage, charges, tax, and bills; the
website reads those rows through Oracle and explains them with charts, reports,
and AI.

## System Map

```text
Browser
  -> Next.js app on localhost:3000
  -> server routes / server components
  -> lib/oracle.ts read-only SQL guard
  -> local SSH tunnel localhost:1521
  -> OCI BRM Oracle PDB orclpdb, schema pin
```

The web app never mutates BRM. Data creation and billing happen on the OCI server
with BRM tools such as `testnap`, custom Group 6 opcodes, `pin_virtual_time`, and
`pin_bill_accts`.

## Main Parts

- `app/page.tsx`: dashboard overview with KPIs, charts, insights, date range, and assistant drawer.
- `app/report/page.tsx`: deeper statistics page plus the report builder.
- `app/api/group6/usage`: returns the full Group 6 usage JSON.
- `app/api/group6/report`: builds preset or custom reports.
- `app/api/group6/report/ai`: turns natural-language report requests into safe custom report selections.
- `app/api/group6/summarize`: returns one short AI/computed chart summary.
- `app/api/chat`: dashboard chatbot with grounded BRM/usage context.
- `app/api/db/health`: Oracle connectivity check.
- `lib/oracle.ts`: connection pool and `SELECT`/`WITH` only SQL validation.
- `lib/group6-usage.ts`: core data loader; runs the aggregate Oracle queries.
- `lib/brm-group6.ts`: catalog/cohort facts for assistant answers.
- `lib/ai-providers.ts`: shared Gemini/OpenRouter fallback and retry plumbing.
- `lib/metrics-catalog.ts`: allow-listed custom report dimensions/measures.
- `lib/build-report-sql.ts`: safe SQL builder for custom reports.

## Data Flow

1. A page request arrives at `/` or `/report`.
2. The server parses `?from=` and `?to=` with `lib/range.ts`.
3. `getGroup6Usage(range)` runs read-only Oracle aggregate queries.
4. The page renders serializable chart/table props.
5. Client components hydrate charts, filters, theme, refresh controls, and modal UI.
6. AI features call server routes, never directly from the browser to provider APIs.

## Caching

- Group 6 usage query bundle: in-memory cache, about 60 seconds per date range.
- Narrative insights: cached after successful AI/computed generation.
- Next.js pages are dynamic, not static.
- Browser refresh control can refresh manually or on interval.

## Chatbot Workflow

The chatbot receives the user message plus lightweight page context. The server
then gathers dashboard facts, Group 6 catalog/cohort facts, and usage aggregates.

Fast factual questions, such as plan lists or account counts, can be answered
locally. Analytical questions go to the configured AI provider with strict JSON
output rules and no customer PII. If AI is unavailable, deterministic computed
answers keep the UI usable.

## Report Builder Workflow

Preset mode uses curated definitions in `lib/report-definitions.ts`.

Custom mode uses `lib/metrics-catalog.ts` as the only source of dimensions,
measures, operators, and SQL fragments. User values become Oracle bind
parameters; user text is never concatenated into SQL structure.

AI drafting works like this:

1. User clicks `Custom query`.
2. User enters a plain-English request.
3. `/api/group6/report/ai` asks Gemini/OpenRouter for strict JSON.
4. The result is revalidated against the catalog.
5. The UI fills the controls, previews the report, scrolls to the preview, and
   enables CSV/JSON download when rows exist.

## Configuration

Create `.env.local`:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
AI_PROVIDER_ORDER=gemini,openrouter

ORACLE_USER=pin
ORACLE_PASSWORD=pin
ORACLE_CONNECT_STRING=localhost:1521/orclpdb

OCI_SSH_USER=cloud-user
OCI_SSH_HOST=150.136.233.29
OCI_SSH_KEY=D:\Downloads\ssh-key-2026-05-21.key
OCI_LOCAL_PORT=1521
OCI_REMOTE_HOST=localhost
OCI_REMOTE_PORT=1521
```

No secret should ever use `NEXT_PUBLIC_`.

## Local Commands

```powershell
npm install
npm run db:tunnel
npm run db:health
npm run dev
npm test
npm run lint
npm run build
```

Open `http://localhost:3000`.

## Production Notes

- Add authentication before exposing the site outside a local/VPN environment.
- Keep Oracle and AI secrets server-side.
- Keep the SSH tunnel or another private Oracle path available.
- Treat `/api/group6/report` as read-only reporting only; all BRM writes belong
  on the OCI server.
