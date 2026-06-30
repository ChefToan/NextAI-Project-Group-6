/*
 * naig6_custom_ops.h - Group 6 (NextAI) custom opcode + field map.
 *
 * Custom opcodes live in the 6xxxxx band (free on this box; the other groups
 * use 1xxxxx/28xxxx/3xxxxx, so 6xxxxx avoids every collision). Each opcode is
 * dispatched by fm_naig6_config.c and handled by one fm_naig6_*.c file.
 *
 * The G6 custom FIELDS (PIN_FLD_*_G6) are already registered in the data
 * dictionary and defined in ops/custom_flds.h - we just include that header
 * rather than re-defining them (re-defining would risk an ID mismatch).
 */
#ifndef _NAIG6_CUSTOM_OPS_H
#define _NAIG6_CUSTOM_OPS_H

#ifndef _PIN_FLDS_H
  #include <pin_flds.h>
#endif

/* Existing, registered Group 6 fields:
 *   PIN_FLD_SESSION_USAGE_G6   SUBSTRUCT 10041
 *   PIN_FLD_TRANSACTION_ID_G6  STR       10042
 *   PIN_FLD_PROMPT_TXT_G6      STR       10043
 *   PIN_FLD_OUTPUT_TOKENS_G6   INT       10044
 *   PIN_FLD_MODEL_CODE_G6      STR       10046
 *   PIN_FLD_INPUT_TOKENS2_G6   INT       10047
 */
#include "ops/custom_flds.h"

/* ---- Group 6 custom opcodes (6xxxxx band) ---- */
#define NAIG6_OP_COMMIT_CUSTOMER   600001   /* flat input -> PCM_OP_CUST_COMMIT_CUSTOMER */
#define NAIG6_OP_LOAD_AI_USAGE     600002   /* flat input -> PCM_OP_ACT_USAGE (rated now)  */
#define NAIG6_OP_ACT_RATE          600003   /* flat input -> PCM_OP_ACT_LOAD_SESSION       */

#endif /* _NAIG6_CUSTOM_OPS_H */
