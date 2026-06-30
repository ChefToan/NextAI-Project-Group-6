/*
 * fm_naig6_config.c - opcode -> handler dispatch table for the Group 6 FM.
 *
 * The CM loads this via:
 *   - cm fm_module ${PIN_HOME}/lib/fm_naig6_custom.so fm_naig6_config - pin
 * On load the CM calls fm_naig6_config() to learn which opcodes this module
 * services and the C function that handles each.
 */
#include <stdio.h>
#include <string.h>
#include <pinlog.h>

#include "ops/naig6_custom_ops.h"
#include "pcm.h"
#include "cm_fm.h"

#define FILE_LOGNAME "fm_naig6_config.c"

PIN_EXPORT struct cm_fm_config fm_naig6_config[] = {
        { NAIG6_OP_COMMIT_CUSTOMER, "op_naig6_commit_customer" },
        { NAIG6_OP_LOAD_AI_USAGE,   "op_naig6_load_ai_usage"   },
        { NAIG6_OP_ACT_RATE,        "op_naig6_act_rate"        },
        { 0, (char *)0 }
};
