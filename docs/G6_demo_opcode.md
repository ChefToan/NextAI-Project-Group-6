# G6 Demo Opcode

This is the short runbook for the live Group 6 BRM opcode demo on the OCI server.
Run these commands as the `pin` user. The web app does not run these commands.

## What The Demo Proves

The custom Group 6 Function Module exposes three opcodes:

| Opcode | Name | Purpose |
| --- | --- | --- |
| `600001` | `NAIG6_OP_COMMIT_CUSTOMER` | Create one Group 6 customer from a small flist. |
| `600002` | `NAIG6_OP_LOAD_AI_USAGE` | Submit and rate one AI usage event. |
| `600003` | `NAIG6_OP_ACT_RATE` | Helper for session/back-dated rating. |

The normal demo path uses:

1. set BRM virtual time
2. create a customer
3. render usage NAP files
4. submit usage
5. verify event/rating rows
6. close a bill cycle
7. restore original virtual time

## Server Paths

```bash
PIN=/opt/app/brm/pin/BRM
DEMO=$PIN/sys/test/nextaig6/demo
VTFILE=$PIN/lib/pin_virtual_time_file
```

## Safe Virtual-Time Wrapper

Always wrap demo work so the original virtual-time file is restored:

```bash
PIN=/opt/app/brm/pin/BRM
DEMO=$PIN/sys/test/nextaig6/demo
VTFILE=$PIN/lib/pin_virtual_time_file
WORK=/tmp/g6_demo_$(date +%Y%m%d%H%M%S)
mkdir -p "$WORK"
cp "$VTFILE" "$WORK/pin_virtual_time_file.orig"

restore_pvt() {
  cp "$WORK/pin_virtual_time_file.orig" "$VTFILE"
  cmp -s "$WORK/pin_virtual_time_file.orig" "$VTFILE" && echo "PVT restored"
}
trap restore_pvt EXIT
```

## Create One Demo Customer

Use an exact plan name from `plan_t`. For token PAYG, the live value is:
`NextAI Oddisey 3.5 PAYG Token Group 6`.

```bash
cd "$DEMO"
./virtual_time.sh fixed 010100002026.00

cp customer_inputs.env "$WORK/customer_inputs.env"
LOGIN="DocCheck_$(date +%Y%m%d%H%M%S)"

sed -i \
  -e "s/^ACCOUNT_ID=.*/ACCOUNT_ID=-1/" \
  -e "s/^SERVICE_ID=.*/SERVICE_ID=-1/" \
  -e "s/^LOGIN=.*/LOGIN=${LOGIN}/" \
  -e 's/^PLAN_CODE=.*/PLAN_CODE="NextAI Oddisey 3.5 PAYG Token Group 6"/' \
  -e "s/^EMAIL_ADDR=.*/EMAIL_ADDR=${LOGIN}@example.com/" \
  -e "s/^LAST_NAME=.*/LAST_NAME=${LOGIN}/" \
  -e "s/^USAGE_EPOCH=.*/USAGE_EPOCH=$(date -d '2026-01-01 00:30:00' +%s)/" \
  -e "s/^TRANSACTION_ID=.*/TRANSACTION_ID=G6-DOC-$(date +%s)/" \
  "$WORK/customer_inputs.env"

./render_templates.sh "$WORK/customer_inputs.env" "$WORK/rendered"
testnap < "$WORK/rendered/create_customer_optional.nap" > "$WORK/create.out" 2>&1
```

The create opcode reports success as `PIN_FLD_ERROR_CODE "0"` plus
`Group 6 customer committed`. Treat non-zero error codes or `PIN_ERR` as failure.

## Find IDs

```bash
sqlplus -s pin/pin@localhost:1521/orclpdb <<SQL
set pages 100 lines 200
select a.poid_id0 account_id,
       s.poid_id0 service_id,
       bi.poid_id0 billinfo_id,
       s.login
from account_t a
join service_t s on s.account_obj_id0 = a.poid_id0
join billinfo_t bi on bi.account_obj_id0 = a.poid_id0
where s.login = '$LOGIN'
  and s.poid_type = '/service/nextaig6';
exit
SQL
```

Put the returned `ACCOUNT_ID` and `SERVICE_ID` into the temp env file and render
again:

```bash
sed -i \
  -e "s/^ACCOUNT_ID=.*/ACCOUNT_ID=<ACCOUNT_ID>/" \
  -e "s/^SERVICE_ID=.*/SERVICE_ID=<SERVICE_ID>/" \
  "$WORK/customer_inputs.env"

./render_templates.sh "$WORK/customer_inputs.env" "$WORK/rendered"
```

## Add Usage And Verify

For the token PAYG plan:

```bash
testnap < "$WORK/rendered/usage_token_single.nap" > "$WORK/usage_token.out" 2>&1
sqlplus -s pin/pin@localhost:1521/orclpdb @"$WORK/rendered/verify_customer.sql"
```

Useful epoch helpers:

```bash
date -d '2026-01-01 00:30:00' +%s
date -d '2026-02-01 00:30:00' +%s
```

## Close The First Bill Cycle

Move BRM time past the Feb 1 boundary and run account-scoped billing:

```bash
./close_bill_cycle.sh <ACCOUNT_ID> <BILLINFO_ID> 02/02/2026 020200302026.00
sqlplus -s pin/pin@localhost:1521/orclpdb @"$WORK/rendered/verify_customer.sql"
```

## Batch Generator

This only generates NAP files. Review before executing generated `run_all.sh`
files:

```bash
./generate_batch_usage.sh customers.csv.example periods.csv.example /tmp/g6_batch_preview
```

## Latest Validation

Validated on the OCI server on 2026-07-02:

- `virtual_time.sh fixed 010100002026.00`: passed.
- `render_templates.sh`: passed.
- `testnap` create through opcode `600001`: passed with `ERROR_CODE "0"`.
- SQL ID lookup: passed.
- `date -d` epoch helpers: passed.
- `testnap` token usage through rendered NAP: passed.
- `verify_customer.sql`: passed.
- `close_bill_cycle.sh`: passed.
- `generate_batch_usage.sh` with example CSVs: passed and wrote 9 preview NAPs.
- Original `pin_virtual_time_file`: restored byte-for-byte after tests.

The validation customer produced 1 usage event, USD impact `0.07`, 3 bill rows,
and total bill due `0.07`. Tax rows were `0` for that PAYG token smoke path, so
do not claim tax rows are guaranteed unless the chosen plan/path actually writes
them.
