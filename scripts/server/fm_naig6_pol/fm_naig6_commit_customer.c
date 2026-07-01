/*
 * fm_naig6_commit_customer.c - NAIG6_OP_COMMIT_CUSTOMER (600001)
 *
 * Takes a FLAT input flist (login + plan code + name/address) and expands it
 * into a full PCM_OP_CUST_COMMIT_CUSTOMER call against /service/nextaig6.
 *
 * Design note (differs from the G3 template): Group 6's plan and deal CODEs do
 * NOT follow a clean "-Plan"/"-Deal" naming pattern, so we do NOT string-munge a
 * deal code. We pass only the /plan POID at level 0; PCM_OP_CUST_COMMIT_CUSTOMER
 * purchases the plan (its deals/products) and builds the balance group natively.
 * This is the same approach the G4 flat template relies on, and it guarantees
 * every account gets a balance group (our historical #1 defect).
 *
 * Required input fields:  PIN_FLD_LOGIN, PIN_FLD_CODE (= plan code/name)
 * Optional (sensible defaults applied): PASSWD_CLEAR, FIRST/LAST_NAME, NAME,
 *   EMAIL_ADDR, COUNTRY, ZIP, STATE, CITY, ADDRESS, DELIVERY_DESCR,
 *   PIN_FLD_ACCOUNT_OBJ (only used to derive the DB number).
 */
#include <stdio.h>
#include <string.h>

#include <pcm.h>
#include <pinlog.h>

#define FILE_LOGNAME "fm_naig6_commit_customer.c(1)"

#include "ops/naig6_custom_ops.h"
#include "cm_fm.h"
#include "pin_errs.h"

EXPORT_OP void
op_naig6_commit_customer(
        cm_nap_connection_t     *connp,
        int32                   opcode,
        int32                   flags,
        pin_flist_t             *i_flistp,
        pin_flist_t             **r_flistpp,
        pin_errbuf_t            *ebufp);

static void search_plan(
        pcm_context_t           *ctxp,
        poid_t                  *a_pdp,
        char                    *code,
        poid_t                  **plan_poid,
        pin_errbuf_t            *ebufp);

static void read_plan(
        pcm_context_t           *ctxp,
        poid_t                  *plan_poid,
        pin_flist_t             **plan_flistp,
        pin_errbuf_t            *ebufp);

/* Return the field value if present, else the supplied default. */
static char *
get_str(pin_flist_t *fl, int32 fld, char *dflt, pin_errbuf_t *ebufp)
{
        char *v = (char *)PIN_FLIST_FLD_GET(fl, fld, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        return (v != NULL) ? v : dflt;
}

/*******************************************************************
 * Main routine.
 *******************************************************************/
void
op_naig6_commit_customer(
        cm_nap_connection_t     *connp,
        int32                   opcode,
        int32                   flags,
        pin_flist_t             *i_flistp,
        pin_flist_t             **r_flistpp,
        pin_errbuf_t            *ebufp)
{
        pcm_context_t   *ctxp = connp->dm_ctx;
        poid_t          *pdp = NULL;
        int64           neg_one = -1;

        if (PIN_ERR_IS_ERR(ebufp))
                return;
        PIN_ERR_CLEAR_ERR(ebufp);
        *r_flistpp = NULL;

        if (opcode != NAIG6_OP_COMMIT_CUSTOMER) {
                pin_set_err(ebufp, PIN_ERRLOC_FM, PIN_ERRCLASS_SYSTEM_DETERMINATE,
                        PIN_ERR_BAD_OPCODE, 0, 0, opcode);
                PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                        "op_naig6_commit_customer bad opcode", ebufp);
                return;
        }

        PIN_ERR_LOG_FLIST(PIN_ERR_LEVEL_DEBUG,
                "op_naig6_commit_customer input", i_flistp);

        /* If the caller provides a full PCM_OP_CUST_COMMIT_CUSTOMER flist
         * (plan object with SERVICES/DEALS/DEAL_INFO already present), pass it
         * through. This lets generated G6 catalog templates use custom opcode
         * 600001 while preserving BRM's exact validated commit shape. */
        pin_flist_t *full_svc = PIN_FLIST_ELEM_GET(i_flistp, PIN_FLD_SERVICES, 0, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        if (full_svc != NULL) {
                pin_flist_t *ret = NULL;
                PCM_OP(ctxp, PCM_OP_CUST_COMMIT_CUSTOMER, flags, i_flistp, &ret, ebufp);

                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                if (PIN_ERR_IS_ERR(ebufp)) {
                        PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                                "naig6 full PCM_OP_CUST_COMMIT_CUSTOMER error", ebufp);
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"1", ebufp);
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                                (void *)"Full PCM_OP_CUST_COMMIT_CUSTOMER failed", ebufp);
                } else {
                        poid_t *cp = PIN_FLIST_FLD_GET(ret, PIN_FLD_POID, 1, ebufp);
                        PIN_ERR_CLEAR_ERR(ebufp);
                        if (cp != NULL)
                                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID, (void *)cp, ebufp);
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"0", ebufp);
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                                (void *)"Group 6 full customer committed", ebufp);
                }
                PIN_FLIST_DESTROY_EX(&ret, NULL);
                return;
        }

        /* Required: login + plan code. */
        char *login = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_LOGIN, 1, ebufp);
        char *code  = (char *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_CODE,  1, ebufp);
        if (login == NULL || code == NULL) {
                PIN_ERR_CLEAR_ERR(ebufp);
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"2", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Missing required field: LOGIN and/or CODE", ebufp);
                return;
        }
        PIN_ERR_CLEAR_ERR(ebufp);

        /* Optional fields with G6 defaults. */
        char *passwd  = get_str(i_flistp, PIN_FLD_PASSWD_CLEAR,  "Welcome123!", ebufp);
        char *last    = get_str(i_flistp, PIN_FLD_LAST_NAME,     code,         ebufp);
        char *first   = get_str(i_flistp, PIN_FLD_FIRST_NAME,    "Group 6",    ebufp);
        char *email   = get_str(i_flistp, PIN_FLD_EMAIL_ADDR,    "",           ebufp);
        char *country = get_str(i_flistp, PIN_FLD_COUNTRY,       "US",         ebufp);
        char *zip     = get_str(i_flistp, PIN_FLD_ZIP,           "22032",      ebufp);
        char *state   = get_str(i_flistp, PIN_FLD_STATE,         "VA",         ebufp);
        char *city    = get_str(i_flistp, PIN_FLD_CITY,          "Test",       ebufp);
        char *address = get_str(i_flistp, PIN_FLD_ADDRESS,       "Test",       ebufp);

        /* DB number comes from PIN_FLD_ACCOUNT_OBJ if supplied, else default DB 1. */
        poid_t *a_pdp = (poid_t *)PIN_FLIST_FLD_GET(i_flistp, PIN_FLD_ACCOUNT_OBJ, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        int64 db = (a_pdp != NULL) ? PIN_POID_GET_DB(a_pdp) : (int64)1;

        /* 1) Resolve the plan POID from its CODE. */
        poid_t *plan_poid = NULL;
        search_plan(ctxp, (a_pdp ? a_pdp : PIN_POID_CREATE(db, "/account", neg_one, ebufp)),
                    code, &plan_poid, ebufp);
        if (plan_poid == NULL || PIN_ERR_IS_ERR(ebufp)) {
                PIN_ERR_CLEAR_ERR(ebufp);
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"3", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Plan not found for given CODE", ebufp);
                return;
        }

        /* 2) Start from the full /plan object. PCM_OP_CUST_COMMIT_CUSTOMER needs
         *    the plan's SERVICES/DEALS/DEAL_INFO product structures, not just the
         *    /plan POID, otherwise it creates the account without purchases. */
        pin_flist_t *cust = NULL;
        read_plan(ctxp, plan_poid, &cust, ebufp);
        if (cust == NULL || PIN_ERR_IS_ERR(ebufp)) {
                PIN_ERR_CLEAR_ERR(ebufp);
                *r_flistpp = PIN_FLIST_CREATE(ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID,
                        PIN_POID_CREATE(1, "/error", -1, ebufp), ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"4", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Unable to read full plan object", ebufp);
                return;
        }

        /* SERVICES[0] -> /service/nextaig6 with login/password. Preserve the
         * plan's DEALS/DEAL_INFO children and only overlay customer-specific data. */
        pin_flist_t *svc = PIN_FLIST_ELEM_GET(cust, PIN_FLD_SERVICES, 0, 1, ebufp);
        PIN_ERR_CLEAR_ERR(ebufp);
        if (svc == NULL)
                svc = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_SERVICES, 0, ebufp);
        pdp = PIN_POID_CREATE(db, "/service/nextaig6", neg_one, ebufp);
        PIN_FLIST_FLD_PUT(svc, PIN_FLD_SERVICE_OBJ, (void *)pdp, ebufp);
        PIN_FLIST_FLD_SET(svc, PIN_FLD_LOGIN,        (void *)login,  ebufp);
        PIN_FLIST_FLD_SET(svc, PIN_FLD_PASSWD_CLEAR, (void *)passwd, ebufp);
        PIN_FLIST_FLD_SET(svc, PIN_FLD_SERVICE_ID,   (void *)"", ebufp);
        int32 zero_i = 0;
        PIN_FLIST_FLD_SET(svc, PIN_FLD_SUBSCRIPTION_INDEX, &zero_i, ebufp);
        PIN_FLIST_FLD_SET(svc, PIN_FLD_BAL_INFO_INDEX, &zero_i, ebufp);
        PIN_FLIST_FLD_PUT(svc, PIN_FLD_SUBSCRIPTION_OBJ,
                (void *)PIN_POID_CREATE(0, "/", 0, ebufp), ebufp);
        pin_flist_t *svc_code = PIN_FLIST_ELEM_ADD(svc, PIN_FLD_SERVICE_CODES, 0, ebufp);
        PIN_FLIST_FLD_SET(svc_code, PIN_FLD_STATE_ID, &zero_i, ebufp);

        /* NAMEINFO[1] (Primary contact). */
        pin_flist_t *ni = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_NAMEINFO, 1, ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_FIRST_NAME,   (void *)first,   ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_LAST_NAME,    (void *)last,    ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_CONTACT_TYPE, (void *)"Primary", ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_COMPANY,      (void *)"Group 6", ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_EMAIL_ADDR,   (void *)email,   ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_COUNTRY,      (void *)country, ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_ZIP,          (void *)zip,     ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_STATE,        (void *)state,   ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_CITY,         (void *)city,    ebufp);
        PIN_FLIST_FLD_SET(ni, PIN_FLD_ADDRESS,      (void *)address, ebufp);

        /* PAYINFO[0] -> invoice (PAY_TYPE 10001) + bill-to address for tax. */
        pin_flist_t *pay = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_PAYINFO, 0, ebufp);
        pdp = PIN_POID_CREATE(db, "/payinfo/invoice", neg_one, ebufp);
        PIN_FLIST_FLD_PUT(pay, PIN_FLD_POID, (void *)pdp, ebufp);
        PIN_FLIST_FLD_SET(pay, PIN_FLD_NAME, (void *)"Invoice1", ebufp);
        int32 paytype = 10001;
        PIN_FLIST_FLD_SET(pay, PIN_FLD_PAY_TYPE, &paytype, ebufp);
        int32 inv_type = 257;
        int32 one_i = 1;
        PIN_FLIST_FLD_SET(pay, PIN_FLD_INV_TYPE, &inv_type, ebufp);
        PIN_FLIST_FLD_SET(pay, PIN_FLD_FLAGS, &one_i, ebufp);

        pin_flist_t *in_info = PIN_FLIST_SUBSTR_ADD(pay, PIN_FLD_INHERITED_INFO, ebufp);
        pin_flist_t *inv = PIN_FLIST_ELEM_ADD(in_info, PIN_FLD_INV_INFO, 0, ebufp);
        int32 inv_zero = 0;
        PIN_FLIST_FLD_SET(inv, PIN_FLD_DELIVERY_PREFER, &inv_zero, ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_NAME,    (void *)last,    ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_INV_TERMS, &inv_zero,     ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_COUNTRY, (void *)country, ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_ZIP,     (void *)zip,     ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_STATE,   (void *)state,   ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_CITY,    (void *)city,    ebufp);
        PIN_FLIST_FLD_SET(inv, PIN_FLD_ADDRESS, (void *)address, ebufp);

        /* ACCTINFO[0] -> USD, business type 1. Balance group built by the opcode. */
        pin_flist_t *ai = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_ACCTINFO, 0, ebufp);
        pdp = PIN_POID_CREATE(db, "/account", neg_one, ebufp);
        PIN_FLIST_FLD_PUT(ai, PIN_FLD_POID, (void *)pdp, ebufp);
        PIN_FLIST_FLD_SET(ai, PIN_FLD_BAL_INFO, NULL, ebufp);
        int32 currency = 840;
        PIN_FLIST_FLD_SET(ai, PIN_FLD_CURRENCY, &currency, ebufp);
        int32 btype = 1;
        PIN_FLIST_FLD_SET(ai, PIN_FLD_BUSINESS_TYPE, &btype, ebufp);

        /* Root BAL_INFO and BILLINFO arrays are expected by the standard commit
         * customer path to wire billinfo/payinfo/balance-group relationships. */
        pin_flist_t *bi = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_BAL_INFO, 0, ebufp);
        pdp = PIN_POID_CREATE(db, "/balance_group", neg_one, ebufp);
        PIN_FLIST_FLD_PUT(bi, PIN_FLD_POID, (void *)pdp, ebufp);
        PIN_FLIST_FLD_SET(bi, PIN_FLD_NAME, (void *)"Balance Group<Account>", ebufp);
        PIN_FLIST_ELEM_ADD(bi, PIN_FLD_BILLINFO, 0, ebufp);

        pin_flist_t *billinfo = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_BILLINFO, 0, ebufp);
        pdp = PIN_POID_CREATE(db, "/billinfo", neg_one, ebufp);
        PIN_FLIST_FLD_PUT(billinfo, PIN_FLD_POID, (void *)pdp, ebufp);
        PIN_FLIST_FLD_SET(billinfo, PIN_FLD_BILLINFO_ID, (void *)"Bill Unit(1)", ebufp);
        PIN_FLIST_FLD_SET(billinfo, PIN_FLD_PAY_TYPE, &paytype, ebufp);
        PIN_FLIST_ELEM_ADD(billinfo, PIN_FLD_PAYINFO, 0, ebufp);
        PIN_FLIST_ELEM_ADD(billinfo, PIN_FLD_BAL_INFO, 0, ebufp);

        pin_flist_t *locale = PIN_FLIST_ELEM_ADD(cust, PIN_FLD_LOCALES, 1, ebufp);
        PIN_FLIST_FLD_SET(locale, PIN_FLD_LOCALE, (void *)"en_US", ebufp);

        PIN_ERR_LOG_FLIST(PIN_ERR_LEVEL_DEBUG, "naig6 commit flist", cust);

        /* 3) Commit. */
        pin_flist_t *ret = PIN_FLIST_CREATE(ebufp);
        PCM_OP(ctxp, PCM_OP_CUST_COMMIT_CUSTOMER, flags, cust, &ret, ebufp);

        *r_flistpp = PIN_FLIST_CREATE(ebufp);
        if (PIN_ERR_IS_ERR(ebufp)) {
                PIN_ERR_LOG_EBUF(PIN_ERR_LEVEL_ERROR,
                        "naig6 PCM_OP_CUST_COMMIT_CUSTOMER error", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"1", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"PCM_OP_CUST_COMMIT_CUSTOMER failed", ebufp);
        } else {
                poid_t *cp = PIN_FLIST_FLD_GET(ret, PIN_FLD_POID, 1, ebufp);
                PIN_ERR_CLEAR_ERR(ebufp);
                if (cp != NULL)
                        PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_POID, (void *)cp, ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_CODE, (void *)"0", ebufp);
                PIN_FLIST_FLD_SET(*r_flistpp, PIN_FLD_ERROR_DESCR,
                        (void *)"Group 6 customer committed", ebufp);
        }

        PIN_FLIST_DESTROY_EX(&cust, NULL);
        PIN_FLIST_DESTROY_EX(&ret, NULL);
        return;
}

/*******************************************************************
 * read_plan: PCM_OP_READ_OBJ on the selected /plan so commit_customer sees the
 * full plan/deal/product structure.
 *******************************************************************/
static void
read_plan(
        pcm_context_t   *ctxp,
        poid_t          *plan_poid,
        pin_flist_t     **plan_flistp,
        pin_errbuf_t    *ebufp)
{
        pin_flist_t *in = NULL;

        if (PIN_ERR_IS_ERR(ebufp)) return;
        PIN_ERR_CLEAR_ERR(ebufp);

        in = PIN_FLIST_CREATE(ebufp);
        PIN_FLIST_FLD_SET(in, PIN_FLD_POID, (void *)plan_poid, ebufp);
        PCM_OP(ctxp, PCM_OP_READ_OBJ, 0, in, plan_flistp, ebufp);
        PIN_FLIST_DESTROY_EX(&in, NULL);
}

/*******************************************************************
 * search_plan: SELECT X FROM /plan WHERE code = V1
 *******************************************************************/
static void
search_plan(
        pcm_context_t   *ctxp,
        poid_t          *a_pdp,
        char            *code,
        poid_t          **plan_poid,
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
                (void *)"select X from /plan where F1 = V1 ", ebufp);
        vp = PIN_FLIST_ELEM_ADD(search, PIN_FLD_ARGS, 1, ebufp);
        PIN_FLIST_FLD_SET(vp, PIN_FLD_CODE, (void *)code, ebufp);
        vp = PIN_FLIST_ELEM_ADD(search, PIN_FLD_RESULTS, 0, ebufp);
        PIN_FLIST_FLD_SET(vp, PIN_FLD_POID, (void *)NULL, ebufp);

        PCM_OP(ctxp, PCM_OP_SEARCH, 0, search, &ret, ebufp);

        cookie = NULL;
        vp = PIN_FLIST_ELEM_GET_NEXT(ret, PIN_FLD_RESULTS, &element_id, 1, &cookie, ebufp);
        if (vp != NULL)
                *plan_poid = PIN_FLIST_FLD_TAKE(vp, PIN_FLD_POID, 0, ebufp);
        else
                PIN_ERR_LOG_MSG(PIN_ERR_LEVEL_ERROR, "search_plan: no plan found");

        PIN_FLIST_DESTROY_EX(&search, NULL);
        PIN_FLIST_DESTROY_EX(&ret, NULL);
}
