/*
 * fm_naig6_load_ai_usage.c - NAIG6_OP_LOAD_AI_USAGE (600002)
 *
 * Takes a FLAT input flist describing one AI usage event and submits it via
 * PCM_OP_ACT_USAGE against /service/nextaig6 (rated in real time). This is the
 * opcode-based equivalent of our proven g6lib `_emit_event` testnap block.
 *
 * Required input:  PIN_FLD_LOGIN, PIN_FLD_RUM_NAME ("PromptG6" | "TokensG6")
 * Optional input:  PIN_FLD_QUANTITY (DECIMAL; default 1 -> set to block count for
 *                  TokensG6), PIN_FLD_START_T (default = now), and the flat G6
 *                  fields MODEL_CODE_G6, INPUT_TOKENS2_G6, OUTPUT_TOKENS_G6,
 *                  TRANSACTION_ID_G6, PROMPT_TXT_G6.
 *
 * For TokensG6 the QUANTITY must carry the block count (the box's TokensG6 RUM
 * measures PIN_FLD_QUANTITY directly) - callers pass blocks = (in+out)/1000.
 */
#include <stdio.h>
#include <string.h>
#include <time.h>

#include <pcm.h>
#include <pinlog.h>

#define FILE_LOGNAME "fm_naig6_load_ai_usage.c(1)"

#include "ops/naig6_custom_ops.h"
#include "cm_fm.h"
#include "pin_errs.h"

EXPORT_OP void
op_naig6_load_ai_usage(
        cm_nap_connection_t     *connp,
        int32                   opcode,
        int32                   flags,
        pin_flist_t             *i_flistp,
        pin_flist_t             **r_flistpp,
        pin_errbuf_t            *ebufp);

static void search_login(
        pcm_context_t   *ctxp,
        poid_t          *a_pdp,
        char            *login,
        poid_t          **service_poid,
        poid_t          **account_obj,
        pin_errbuf_t    *ebufp);

void
op_naig6_load_ai_usage(
        cm_nap_connection_t     *connp,
        int32                   opcode,
        int32                   flags,
        pin_flist_t             *i_flistp,
        pin_flist_t             **r_flistpp,
        pin_errbuf_t            *ebufp)
{
        pcm_context_t   *ctxp = connp->dm_ctx;

        if (PIN_ERR_IS_ERR(ebufp)) return;
        PIN_ERR_CLEAR_ERR(ebufp);
        *r_flistpp = NULL;

        if (opcode != NAIG6_OP_LOAD_AI_USAGE) {
                pin_set_err(ebufp, PIN_ERRLOC_FM, PIN_ERRCLASS_SYSTEM_DETERMINATE,
                        PIN_ERR_BAD_OPCODE, 0, 0, opcode);
                PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                        "op_naig6_load_ai_usage bad opcode", ebufp);
                return;
        }

        char *login = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_LOGIN, 1, ebufp);
        char *rum   = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_RUM_NAME, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        if (login == NULL || rum == NULL) {
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"2", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Missing required field: LOGIN and/or RUM_NAME", ebufp);
                return;
        }

        poid_t *a_pdp = (poid_t *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_ACCOUNT_OBJ, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        if (a_pdp == NULL)
                a_pdp = PIN_POID_CREATE(1, "/account", -1, ebufp);
        int64 db = PIN_POID_GET_DB(a_pdp);

        /* Resolve the service + account from the login. */
        poid_t *service_poid = NULL, *account_obj = NULL;
        search_login(ctxp, a_pdp, login, &service_poid, &account_obj, ebufp);
        if (service_poid == NULL || account_obj == NULL) {
                PIN_ERR_CLEAR_ERR(ebufp);
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"3", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Login not found for /service/nextaig6", ebufp);
                return;
        }

        /* Timestamp: use provided START_T, else now. */
        int64 *in_ts = (int64 *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_START_T, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        int64 ts = (in_ts != NULL) ? *in_ts : (int64)time(NULL);

        /* QUANTITY: use provided, else 1. */
        pin_decimal_t *in_qty = (pin_decimal_t *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_QUANTITY, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);

        /* Flat G6 fields (default 0 / empty). */
        char  *model   = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_MODEL_CODE_G6, 1, ebufp);
        char  *transid = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_TRANSACTION_ID_G6, 1, ebufp);
        char  *prompt  = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_PROMPT_TXT_G6, 1, ebufp);
        int32 *in_tok  = (int32 *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_INPUT_TOKENS2_G6, 1, ebufp);
        int32 *out_tok = (int32 *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_OUTPUT_TOKENS_G6, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        int32 zero_tok = 0;
        if (model   == NULL) model   = "3.0";
        if (transid == NULL) transid = "g6_opcode_usage";
        if (prompt  == NULL) prompt  = "G6 opcode simulated usage";
        if (in_tok  == NULL) in_tok  = &zero_tok;
        if (out_tok == NULL) out_tok = &zero_tok;

        /* Build the PCM_OP_ACT_USAGE input flist (mirrors g6lib _emit_event). */
        pin_flist_t *u = PIN_FLIST_CREATE(ebufp);
        PIN_FLIST_FLD_SET(u, PIN_FLD_POID,         (void *)account_obj, ebufp);
        PIN_FLIST_FLD_SET(u, PIN_FLD_ACCOUNT_OBJ,  (void *)account_obj, ebufp);
        PIN_FLIST_FLD_SET(u, PIN_FLD_SERVICE_OBJ,  (void *)service_poid, ebufp);
        PIN_FLIST_FLD_SET(u, PIN_FLD_PROGRAM_NAME, (void *)"G6 OPCODE USAGE", ebufp);
        PIN_FLIST_FLD_SET(u, PIN_FLD_START_T, &ts, ebufp);
        PIN_FLIST_FLD_SET(u, PIN_FLD_END_T,   &ts, ebufp);

        pin_flist_t *ev = PIN_FLIST_SUBSTR_ADD(u, PIN_FLD_EVENT, ebufp);
        PIN_FLIST_FLD_PUT(ev, PIN_FLD_POID,
                (void *)PIN_POID_CREATE(db, "/event/session/usagegr6", (int64)-1, ebufp), ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_ACCOUNT_OBJ,  (void *)account_obj, ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_SERVICE_OBJ,  (void *)service_poid, ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_PROGRAM_NAME, (void *)"G6 OPCODE USAGE", ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_NAME,  (void *)transid, ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_DESCR, (void *)transid, ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_START_T, &ts, ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_END_T,   &ts, ebufp);
        PIN_FLIST_FLD_SET(ev, PIN_FLD_RUM_NAME, (void *)rum, ebufp);

        /* QUANTITY: caller-provided (block count for TokensG6) or default 1. */
        if (in_qty != NULL) {
                PIN_FLIST_FLD_SET(ev, PIN_FLD_QUANTITY, (void *)in_qty, ebufp);
        } else {
                pin_decimal_t *one = pbo_decimal_from_str("1", ebufp);
                PIN_FLIST_FLD_PUT(ev, PIN_FLD_QUANTITY, one, ebufp);
        }

        pin_flist_t *su = PIN_FLIST_SUBSTR_ADD(ev, PIN_FLD_SESSION_USAGE_G6, ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_TRANSACTION_ID_G6, (void *)transid, ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_MODEL_CODE_G6,     (void *)model,   ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_PROMPT_TXT_G6,     (void *)prompt,  ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_INPUT_TOKENS2_G6,  (void *)in_tok,  ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_OUTPUT_TOKENS_G6,  (void *)out_tok, ebufp);

        PIN_ERR_LOG_FLIST(PIN_ERR_LEVEL_DEBUG, "naig6 usage flist", u);

        pin_flist_t *ret = PIN_FLIST_CREATE(ebufp);
        PCM_OP(ctxp, PCM_OP_ACT_USAGE, flags, u, &ret, ebufp);

        *r_flistpp = PIN_FLIST_CREATE(ebufp);
        if (PIN_ERR_IS_ERR(ebufp)) {
                PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                        "naig6 PCM_OP_ACT_USAGE error", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"1", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"PCM_OP_ACT_USAGE failed", ebufp);
        } else {
                poid_t *ep = PIN_FLIST_FLD_GET(ret, PIN_FLD_POID, 1, ebufp);
                PIN_ERR_CLEAR_ERR(ebufp);
                if (ep != NULL)
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID, (void *)ep, ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"0", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Group 6 usage rated", ebufp);
        }

        PIN_FLIST_DESTROY_EX(&u, NULL);
        PIN_FLIST_DESTROY_EX(&ret, NULL);
        return;
}

/*******************************************************************
 * search_login: SELECT X FROM /service WHERE login = V1
 *******************************************************************/
static void
search_login(
        pcm_context_t   *ctxp,
        poid_t          *a_pdp,
        char            *login,
        poid_t          **service_poid,
        poid_t          **account_obj,
        pin_errbuf_t    *ebufp)
{
        pin_flist_t *search = NULL, *ret = NULL, *vp = NULL;
        pin_cookie_t cookie = NULL;
        int32 element_id;

        if (PIN_ERR_IS_ERR(ebufp)) return;
        PIN_ERR_CLEAR_ERR(ebufp);

        int64 db = PIN_POID_GET_DB(a_pdp);
        search = PIN_FLIST_CREATE(ebufp);
        PIN_FLIST_FLD_PUT(search, PIN_FLD_POID,
                (void *)PIN_POID_CREATE(db, "/search", (int64)-1, ebufp), ebufp);
        u_int sf = SRCH_DISTINCT;
        PIN_FLIST_FLD_SET(search, PIN_FLD_FLAGS, (void *)&sf, ebufp);
        PIN_FLIST_FLD_SET(search, PIN_FLD_TEMPLATE,
                (void *)"select X from /service where F1 = V1 ", ebufp);
        vp = PIN_FLIST_ELEM_ADD(search, PIN_FLD_ARGS, 1, ebufp);
        PIN_FLIST_FLD_SET(vp, PIN_FLD_LOGIN, (void *)login, ebufp);
        vp = PIN_FLIST_ELEM_ADD(search, PIN_FLD_RESULTS, 0, ebufp);
        PIN_FLIST_FLD_SET(vp, PIN_FLD_POID, (void *)NULL, ebufp);
        PIN_FLIST_FLD_SET(vp, PIN_FLD_ACCOUNT_OBJ, (void *)NULL, ebufp);

        PCM_OP(ctxp, PCM_OP_SEARCH, 0, search, &ret, ebufp);

        cookie = NULL;
        vp = PIN_FLIST_ELEM_GET_NEXT(ret, PIN_FLD_RESULTS, &element_id, 1, &cookie, ebufp);
        if (vp != NULL) {
                *service_poid = PIN_FLIST_FLD_TAKE(vp, PIN_FLD_POID, 0, ebufp);
                *account_obj  = PIN_FLIST_FLD_TAKE(vp, PIN_FLD_ACCOUNT_OBJ, 0, ebufp);
        } else {
                PIN_ERR_LOG_MSG(PIN_ERR_LEVEL_ERROR, "search_login: no service found");
        }

        PIN_FLIST_DESTROY_EX(&search, NULL);
        PIN_FLIST_DESTROY_EX(&ret, NULL);
}
