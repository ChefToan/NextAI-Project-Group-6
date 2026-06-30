/*
 * fm_naig6_act_rate.c - NAIG6_OP_ACT_RATE (600003)
 *
 * Session-load flavor of G6 usage (mirrors the G3 ACT_RATE template). Takes a
 * FLAT input with a human date string and submits a session via
 * PCM_OP_ACT_LOAD_SESSION against /service/nextaig6. Use NAIG6_OP_LOAD_AI_USAGE
 * (600002) for the normal real-time-rated path; this opcode exists for the
 * session/back-dated load workflow.
 *
 * Required input:  PIN_FLD_LOGIN, PIN_FLD_NAME (date as "MM-DD-YYYY")
 * Optional input:  MODEL_CODE_G6, TRANSACTION_ID_G6, PROMPT_TXT_G6,
 *                  INPUT_TOKENS2_G6, OUTPUT_TOKENS_G6, PIN_FLD_DESCR
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>

#include <pcm.h>
#include "ops/act.h"
#include <pinlog.h>

#define FILE_LOGNAME "fm_naig6_act_rate.c(1)"

#include "ops/naig6_custom_ops.h"
#include "cm_fm.h"
#include "pin_errs.h"

EXPORT_OP void
op_naig6_act_rate(
        cm_nap_connection_t     *connp,
        int32                   opcode,
        int32                   flags,
        pin_flist_t             *i_flistp,
        pin_flist_t             **r_flistpp,
        pin_errbuf_t            *ebufp);

static int64 to_epoch(const char *s);

static void search_login_g6(
        pcm_context_t   *ctxp,
        poid_t          *a_pdp,
        char            *login,
        poid_t          **service_poid,
        poid_t          **account_obj,
        pin_errbuf_t    *ebufp);

void
op_naig6_act_rate(
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

        if (opcode != NAIG6_OP_ACT_RATE) {
                pin_set_err(ebufp, PIN_ERRLOC_FM, PIN_ERRCLASS_SYSTEM_DETERMINATE,
                        PIN_ERR_BAD_OPCODE, 0, 0, opcode);
                PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                        "op_naig6_act_rate bad opcode", ebufp);
                return;
        }

        char *login = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_LOGIN, 1, ebufp);
        char *date  = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_NAME,  1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        if (login == NULL || date == NULL) {
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"2", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Missing required field: LOGIN and/or NAME(date)", ebufp);
                return;
        }

        int64 ts = to_epoch(date);
        if (ts == -1) {
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"1", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Invalid date (expected MM-DD-YYYY in PIN_FLD_NAME)", ebufp);
                return;
        }

        poid_t *a_pdp = (poid_t *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_ACCOUNT_OBJ, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        if (a_pdp == NULL)
                a_pdp = PIN_POID_CREATE(1, "/account", -1, ebufp);

        poid_t *service_poid = NULL, *account_obj = NULL;
        search_login_g6(ctxp, a_pdp, login, &service_poid, &account_obj, ebufp);
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

        char  *descr   = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_DESCR, 1, ebufp);
        char  *model   = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_MODEL_CODE_G6, 1, ebufp);
        char  *transid = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_TRANSACTION_ID_G6, 1, ebufp);
        char  *prompt  = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_PROMPT_TXT_G6, 1, ebufp);
        int32 *in_tok  = (int32 *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_INPUT_TOKENS2_G6, 1, ebufp);
        int32 *out_tok = (int32 *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_OUTPUT_TOKENS_G6, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        int32 zero_tok = 0;
        if (descr   == NULL) descr   = "G6 session load";
        if (model   == NULL) model   = "3.0";
        if (transid == NULL) transid = "g6_session";
        if (prompt  == NULL) prompt  = "G6 session simulated usage";
        if (in_tok  == NULL) in_tok  = &zero_tok;
        if (out_tok == NULL) out_tok = &zero_tok;

        int64 db = PIN_POID_GET_DB(a_pdp);
        int64 zero = 0;

        /* QUANTITY = token blocks = (in+out)/1000, min 1. */
        int32 blocks = (*in_tok + *out_tok) / 1000;
        if (blocks < 1) blocks = 1;
        char qbuf[32];
        snprintf(qbuf, sizeof(qbuf), "%d", blocks);

        pin_flist_t *s = PIN_FLIST_CREATE(ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_POID,         (void *)account_obj, ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_SERVICE_OBJ,  (void *)service_poid, ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_OBJ_TYPE,     (void *)"/usagegr6", ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_PROGRAM_NAME, (void *)"naig6_act_rate", ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_FLAGS, &zero, ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_START_T, &ts, ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_END_T,   &ts, ebufp);
        PIN_FLIST_FLD_SET(s, PIN_FLD_DESCR, (void *)descr, ebufp);
        PIN_FLIST_FLD_PUT(s, PIN_FLD_QUANTITY, pbo_decimal_from_str(qbuf, ebufp), ebufp);

        pin_flist_t *ii = PIN_FLIST_SUBSTR_ADD(s, PIN_FLD_INHERITED_INFO, ebufp);
        pin_flist_t *su = PIN_FLIST_SUBSTR_ADD(ii, PIN_FLD_SESSION_USAGE_G6, ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_TRANSACTION_ID_G6, (void *)transid, ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_MODEL_CODE_G6,     (void *)model,   ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_PROMPT_TXT_G6,     (void *)prompt,  ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_INPUT_TOKENS2_G6,  (void *)in_tok,  ebufp);
        PIN_FLIST_FLD_SET(su, PIN_FLD_OUTPUT_TOKENS_G6,  (void *)out_tok, ebufp);

        PIN_ERR_LOG_FLIST(PIN_ERR_LEVEL_DEBUG, "naig6 session flist", s);

        pin_flist_t *ret = PIN_FLIST_CREATE(ebufp);
        PCM_OP(ctxp, PCM_OP_ACT_LOAD_SESSION, flags, s, &ret, ebufp);

        *r_flistpp = PIN_FLIST_CREATE(ebufp);
        if (PIN_ERR_IS_ERR(ebufp)) {
                PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                        "naig6 PCM_OP_ACT_LOAD_SESSION error", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"1", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"PCM_OP_ACT_LOAD_SESSION failed", ebufp);
        } else {
                poid_t *ep = PIN_FLIST_FLD_GET(ret, PIN_FLD_POID, 1, ebufp);
                PIN_ERR_CLEAR_ERR(ebufp);
                if (ep != NULL)
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID, (void *)ep, ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"0", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Group 6 session rated", ebufp);
        }

        PIN_FLIST_DESTROY_EX(&s, NULL);
        PIN_FLIST_DESTROY_EX(&ret, NULL);
        return;
}

/* "MM-DD-YYYY" -> epoch, or -1 on bad input. */
static int64
to_epoch(const char *s)
{
        int mo, d, y;
        if (sscanf(s, "%d-%d-%d", &mo, &d, &y) != 3) return -1;
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return -1;
        struct tm tm = {0};
        tm.tm_year = y - 1900; tm.tm_mon = mo - 1; tm.tm_mday = d;
        tm.tm_isdst = -1;
        time_t e = mktime(&tm);
        return (e == -1) ? -1 : (int64)e;
}

/*******************************************************************
 * search_login_g6: SELECT X FROM /service WHERE login = V1
 *******************************************************************/
static void
search_login_g6(
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
                PIN_ERR_LOG_MSG(PIN_ERR_LEVEL_ERROR, "search_login_g6: no service found");
        }

        PIN_FLIST_DESTROY_EX(&search, NULL);
        PIN_FLIST_DESTROY_EX(&ret, NULL);
}
