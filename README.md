# NextAI — Group 6 Billing Console

A Next.js 15 dashboard over an Oracle BRM billing database, scoped to Group 6
(`/service/nextaig6`, Odyssey 3.0 / 3.5). Two pages: **Overview** (`/`) and
**Statistics & Report** (`/report`), plus a Gemini-powered assistant.

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
| `npm run db:tunnel` | Open the SSH tunnel to the Oracle host |
| `npm run db:health` | Check the DB connection |

## Notes
- Without the tunnel, DB-backed routes return a "not connected" state; `/report`
  returns 500 (`NJS-503`) — run `npm run db:tunnel`.
- If `GEMINI_API_KEY` is blank, the assistant falls back to deterministic local
  answers so the UI still works.
- Secrets live in `.env.local` (gitignored). See [CONFIGURATION.md](./CONFIGURATION.md)
  for full environment and tunnel details.
