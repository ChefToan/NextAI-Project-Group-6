# NextAI Configuration

## 1. App runtime

Install dependencies and start the app:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## 2. Google AI Studio / Gemini chat

Create `C:\Users\toan\Desktop\NextAI\.env.local` from `.env.example` and set:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-3.5-flash
```

The browser never receives this key. The dashboard posts chat requests to `/api/chat`, and the server route calls Gemini.

If `GEMINI_API_KEY` is blank, the assistant still works with a local deterministic fallback so you can test the UI.

## 3. Oracle through SSH tunnel

Your expected local connect string is:

```dotenv
ORACLE_CONNECT_STRING=localhost:1521/orclpdb
```

Start the tunnel in a separate terminal:

```powershell
$env:OCI_SSH_USER="your_ssh_user"
$env:OCI_SSH_HOST="your.company.oci.host"
$env:OCI_SSH_KEY="C:\path\to\private_key"
$env:OCI_LOCAL_PORT="1521"
$env:OCI_REMOTE_HOST="localhost"
$env:OCI_REMOTE_PORT="1521"
npm run db:tunnel
```

If Oracle is not running on the OCI host itself, set `OCI_REMOTE_HOST` to the private DB host reachable from the OCI server.

Then configure:

```dotenv
ORACLE_USER=your_schema
ORACLE_PASSWORD=your_password
ORACLE_CONNECT_STRING=localhost:1521/orclpdb
```

Check the connection:

```powershell
curl http://localhost:3000/api/db/health
```

## 4. Optional Oracle context for AI

Set one small read-only statement to include live DB rows in AI answers:

```dotenv
NEXTAI_ORACLE_CONTEXT_SQL=with latest as (select max(created_t) max_created_t from account_t), metrics as (select 'oracle_schema' metric_name, sys_context('USERENV','CURRENT_SCHEMA') metric_value from dual union all select 'oracle_service', sys_context('USERENV','SERVICE_NAME') from dual union all select 'account_total', to_char(count(*)) from account_t union all select 'account_active_10100', to_char(sum(case when status = 10100 then 1 else 0 end)) from account_t union all select 'account_inactive_10102', to_char(sum(case when status = 10102 then 1 else 0 end)) from account_t union all select 'account_closed_10103', to_char(sum(case when status = 10103 then 1 else 0 end)) from account_t union all select 'account_created_last_7d_from_latest', to_char(count(*)) from account_t cross join latest where created_t >= latest.max_created_t - 604800 union all select 'latest_account_created_at_utc', to_char(date '1970-01-01' + max_created_t / 86400, 'YYYY-MM-DD HH24:MI:SS') from latest union all select 'billinfo_total', to_char(count(*)) from billinfo_t union all select 'billinfo_open_status_0', to_char(sum(case when billing_status = 0 then 1 else 0 end)) from billinfo_t union all select 'service_total', to_char(count(*)) from service_t union all select 'item_total', to_char(count(*)) from item_t union all select 'event_total', to_char(count(*)) from event_t) select metric_name, metric_value from metrics
```

The server rejects non-read-only statements for this context hook.

Test the chatbot with:

```text
How many active, inactive, and closed BRM accounts are in Oracle, and what changed in the latest 7-day window?
```

## 5. Production checklist

- Keep all secrets in `.env.local` locally or in your deployment secret manager.
- Do not expose `GEMINI_API_KEY`, `ORACLE_USER`, or `ORACLE_PASSWORD` with `NEXT_PUBLIC_`.
- Use an SSH key with least-privilege access to the OCI server.
- Confirm whether the Oracle service name is `orclpdb`, `orclpdb1`, or another PDB service before production rollout.
- Add authentication before exposing this dashboard outside your machine or VPN.
- Replace demo payment metrics with real Oracle-backed dashboard queries once the schema/table names are confirmed.
