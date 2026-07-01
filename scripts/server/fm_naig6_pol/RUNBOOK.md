# Group 6 custom FM — build, register, test

Builds `fm_naig6_custom.so` with three custom opcodes and wires them into the CM.
**Every step here is a server write — run as `pin` on the box.** Claude only
authors these files and verifies results read-only.

| Opcode | # | Calls internally | Purpose |
|---|---|---|---|
| `NAIG6_OP_COMMIT_CUSTOMER` | 600001 | `PCM_OP_CUST_COMMIT_CUSTOMER` | create 1 G6 customer from a flat flist (login + plan code) |
| `NAIG6_OP_LOAD_AI_USAGE`   | 600002 | `PCM_OP_ACT_USAGE`            | submit 1 rated usage event (`PromptG6`/`TokensG6`) |
| `NAIG6_OP_ACT_RATE`        | 600003 | `PCM_OP_ACT_LOAD_SESSION`    | session/back-dated load (date string) |

Why 6xxxxx: every other group uses 1xxxxx / 28xxxx / 3xxxxx, so 600001-3 collide
with nothing. Verified: G1 `fm_nai_custom.so` + G5 `fm_g05_custom.so` are the only
custom FMs the live CM loads — we **add** ours, removing nothing.

---

## 1. Deploy source + header to the box (as `pin`)

```bash
PIN=/opt/app/brm/pin/BRM
mkdir -p $PIN/source/sys/fm_naig6_pol
# copy the 4 .c files + Makefile into $PIN/source/sys/fm_naig6_pol/
# copy ops/naig6_custom_ops.h into $PIN/include/ops/
cp /tmp/fm_naig6_pol/*.c     $PIN/source/sys/fm_naig6_pol/
cp /tmp/fm_naig6_pol/Makefile $PIN/source/sys/fm_naig6_pol/
cp /tmp/fm_naig6_pol/ops/naig6_custom_ops.h $PIN/include/ops/
# strip any CRLF that Windows added (sed \r doesn't work in git-bash; use perl):
perl -i -pe 's/\015//g' $PIN/source/sys/fm_naig6_pol/* $PIN/include/ops/naig6_custom_ops.h
```

`custom_flds.h` (already on the box) holds the G6 field IDs — no field changes needed.

## 2. Compile

```bash
cd $PIN/source/sys/fm_naig6_pol
make 2>&1 | tee build.log
# expect: fm_naig6_custom.so produced, no errors
cp fm_naig6_custom.so $PIN/lib/
```

If the linker complains about undefined `pbo_decimal_from_str` / `PCM_OP_*`, the
fix is the same `-lportal`/PIN libs the other group Makefiles use — copy the full
link line from `$PIN/source/sys/fm_nai3_pol/Makefile` (it built `fm_nai3_custom.so`).

## 3. Register in the CM (shared file — back up first)

```bash
cp $PIN/sys/cm/pin.conf $PIN/sys/cm/pin.conf.bak_before_g6fm_$(date +%Y%m%d_%H%M%S)
# add this line near the other custom FMs (~line 2554, after fm_g05_custom):
printf '%s\n' '- cm fm_module /opt/app/brm/pin/BRM/lib/fm_naig6_custom.so fm_naig6_config - pin' \
  >> /tmp/g6fm_line.txt   # then paste it into pin.conf in the fm_module block
```
Add (do NOT remove the G1/G5 lines):
```
- cm fm_module /opt/app/brm/pin/BRM/lib/fm_naig6_custom.so fm_naig6_config - pin
```

## 4. Restart the CM

```bash
pin_ctl stop cm  && pin_ctl start cm
pin_ctl status cm
tail -n 40 $PIN/var/cm/cm.pinlog   # confirm fm_naig6 loaded, no opcode-map errors
```
> The CM restart is box-wide. You confirmed nobody else is using it right now.

## 5. Smoke-test each opcode (from `$PIN/sys/test`, pin.conf present there)

```bash
cd $PIN/sys/test
testnap < /tmp/g6op_commit.nap   > /tmp/g6op_commit.out   2>&1
testnap < /tmp/g6op_usage.nap    > /tmp/g6op_usage.out    2>&1
testnap < /tmp/g6op_session.nap  > /tmp/g6op_session.out  2>&1
grep -iE 'ERROR_CODE|committed|rated|PIN_ERR' /tmp/g6op_*.out
```

Sample input flists are in `samples/` (commit / usage / session).

## 6. Verify (Claude, read-only)
After the commit test, Claude checks the new account has a **balance group**,
the service is `/service/nextaig6`, and the usage event rated to USD 840 — the
same checks used on the full rebuild. Only after one account passes do we scale.

## 7. Rollback
```bash
# comment out the fm_naig6 line in pin.conf, then:
pin_ctl stop cm && pin_ctl start cm
```
The opcodes simply stop resolving; no data is touched.
