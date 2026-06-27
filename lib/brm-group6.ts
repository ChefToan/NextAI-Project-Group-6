import "server-only";
import { runReadOnlyQuery } from "@/lib/oracle";

type Row = Record<string, unknown>;

export type Group6User = {
  label: string;
  accountId: number;
  accountStatus: number;
  accountStatusLabel: string;
  accountType: number;
  accountCreatedAtUtc: string;
  serviceId: number;
  serviceType: string;
  serviceStatus: number;
  serviceStatusLabel: string;
  serviceCreatedAtUtc: string;
  productId: number | null;
  productName: string;
  productDescription: string;
  purchasedStatus: number | null;
  purchasedStatusLabel: string;
  purchaseStartUtc: string;
};

export type CatalogItem = {
  id: number;
  name: string;
  description: string;
  permitted?: string;
};

export type Group6Dashboard = {
  connected: boolean;
  generatedAt: string;
  simulatedNowUtc: string;
  serviceType: string;
  metrics: Record<string, string>;
  users: Group6User[];
  productCatalog: CatalogItem[];
  planCatalog: CatalogItem[];
  productMix: Array<{ productName: string; users: number }>;
  notes: string[];
  suggestedQuestion: string;
};

const SERVICE_TYPE = "/service/nextaig6";

function asString(value: unknown, fallback = "") {
  return value == null ? fallback : String(value);
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function statusLabel(status: number | null | undefined) {
  if (status === 10100) return "Active";
  if (status === 10102) return "Inactive";
  if (status === 10103) return "Closed";
  if (status == null) return "Unknown";
  return `Status ${status}`;
}

function purchasedStatusLabel(status: number | null | undefined) {
  if (status === 1) return "Active purchase";
  if (status == null) return "No purchase";
  return `Purchase status ${status}`;
}

function metricMap(rows: Row[] = []) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const name = asString(row.METRIC_NAME ?? row.metric_name);
    const value = asString(row.METRIC_VALUE ?? row.metric_value);
    if (name) acc[name] = value;
    return acc;
  }, {});
}

export async function getGroup6Dashboard(): Promise<Group6Dashboard> {
  const metricsResult = await runReadOnlyQuery(
    `with group6_accounts as (
       select distinct a.poid_id0 account_obj_id0,
              a.status,
              a.created_t
         from account_t a
         join service_t s on s.account_obj_id0 = a.poid_id0
        where s.poid_type = '${SERVICE_TYPE}'
     ),
     latest as (
       select max(created_t) max_created_t from group6_accounts
     ),
     metrics as (
       select 'oracle_schema' metric_name, sys_context('USERENV','CURRENT_SCHEMA') metric_value from dual
       union all select 'oracle_service', sys_context('USERENV','SERVICE_NAME') from dual
       union all select 'group6_user_total', to_char(count(*)) from group6_accounts
       union all select 'group6_active_users', to_char(sum(case when status = 10100 then 1 else 0 end)) from group6_accounts
       union all select 'group6_inactive_users', to_char(sum(case when status = 10102 then 1 else 0 end)) from group6_accounts
       union all select 'group6_closed_users', to_char(sum(case when status = 10103 then 1 else 0 end)) from group6_accounts
       union all select 'group6_created_last_7d_from_latest', to_char(count(*)) from group6_accounts cross join latest where created_t >= latest.max_created_t - 604800
       union all select 'latest_group6_account_created_at_utc', to_char(date '1970-01-01' + max_created_t / 86400, 'YYYY-MM-DD HH24:MI:SS') from latest
       union all select 'group6_service_total', to_char(count(*)) from service_t where poid_type = '${SERVICE_TYPE}'
       union all select 'group6_purchased_product_total', to_char(count(*)) from purchased_product_t pp join service_t s on s.poid_id0 = pp.service_obj_id0 where s.poid_type = '${SERVICE_TYPE}'
       union all select 'group6_product_catalog_total', to_char(count(*)) from product_t where permitted = '${SERVICE_TYPE}' or lower(name) like '%group 6%'
       union all select 'group6_plan_catalog_total', to_char(count(*)) from plan_t where lower(name) like '%group 6%' or lower(descr) like '%group 6%'
     )
     select metric_name, metric_value from metrics`,
    25,
  );

  const usersResult = await runReadOnlyQuery(
    `with cohort as (
       select *
         from (
           select a.poid_id0 account_obj_id0,
                  a.status account_status,
                  a.account_type,
                  a.created_t,
                  to_char(date '1970-01-01' + a.created_t / 86400, 'YYYY-MM-DD HH24:MI:SS') account_created_at_utc,
                  s.poid_id0 service_obj_id0,
                  s.poid_type service_type,
                  s.status service_status,
                  to_char(date '1970-01-01' + s.created_t / 86400, 'YYYY-MM-DD HH24:MI:SS') service_created_at_utc
             from account_t a
             join service_t s on s.account_obj_id0 = a.poid_id0
            where s.poid_type = '${SERVICE_TYPE}'
            order by a.created_t desc, a.poid_id0 desc
         )
        where rownum <= 6
     )
     select c.account_obj_id0,
            c.account_status,
            c.account_type,
            c.account_created_at_utc,
            c.service_obj_id0,
            c.service_type,
            c.service_status,
            c.service_created_at_utc,
            pp.product_obj_id0,
            pp.status purchased_status,
            pp.quantity,
            to_char(date '1970-01-01' + pp.purchase_start_t / 86400, 'YYYY-MM-DD HH24:MI:SS') purchase_start_utc,
            p.name product_name,
            p.descr product_description
       from cohort c
       left join purchased_product_t pp
         on pp.account_obj_id0 = c.account_obj_id0
        and pp.service_obj_id0 = c.service_obj_id0
       left join product_t p on p.poid_id0 = pp.product_obj_id0
      order by c.account_created_at_utc desc, c.account_obj_id0, pp.purchase_start_t desc`,
    30,
  );

  const productCatalogResult = await runReadOnlyQuery(
    `select poid_id0 product_obj_id0,
            name product_name,
            descr product_description,
            permitted
       from product_t
      where permitted = '${SERVICE_TYPE}'
         or lower(name) like '%group 6%'
      order by name
      fetch first 20 rows only`,
    20,
  );

  const planCatalogResult = await runReadOnlyQuery(
    `select poid_id0 plan_obj_id0,
            name plan_name,
            descr plan_description
       from plan_t
      where lower(name) like '%group 6%'
         or lower(descr) like '%group 6%'
      order by name
      fetch first 20 rows only`,
    20,
  );

  const productMixResult = await runReadOnlyQuery(
    `select nvl(p.name, 'No purchased product') product_name,
            count(distinct a.poid_id0) users
       from account_t a
       join service_t s on s.account_obj_id0 = a.poid_id0
       left join purchased_product_t pp
         on pp.account_obj_id0 = a.poid_id0
        and pp.service_obj_id0 = s.poid_id0
       left join product_t p on p.poid_id0 = pp.product_obj_id0
      where s.poid_type = '${SERVICE_TYPE}'
      group by nvl(p.name, 'No purchased product')
      order by users desc, product_name
      fetch first 8 rows only`,
    8,
  );

  const metrics = metricMap((metricsResult?.rows ?? []) as Row[]);
  const rawUsers = (usersResult?.rows ?? []) as Row[];
  const users = rawUsers.slice(0, 6).map((row, index) => {
    const accountStatus = asNumber(row.ACCOUNT_STATUS);
    const serviceStatus = asNumber(row.SERVICE_STATUS);
    const purchasedStatus =
      row.PURCHASED_STATUS == null ? null : asNumber(row.PURCHASED_STATUS);

    return {
      label: `Group 6 User ${index + 1}`,
      accountId: asNumber(row.ACCOUNT_OBJ_ID0),
      accountStatus,
      accountStatusLabel: statusLabel(accountStatus),
      accountType: asNumber(row.ACCOUNT_TYPE),
      accountCreatedAtUtc: asString(row.ACCOUNT_CREATED_AT_UTC),
      serviceId: asNumber(row.SERVICE_OBJ_ID0),
      serviceType: asString(row.SERVICE_TYPE, SERVICE_TYPE),
      serviceStatus,
      serviceStatusLabel: statusLabel(serviceStatus),
      serviceCreatedAtUtc: asString(row.SERVICE_CREATED_AT_UTC),
      productId:
        row.PRODUCT_OBJ_ID0 == null ? null : asNumber(row.PRODUCT_OBJ_ID0),
      productName: asString(row.PRODUCT_NAME, "No purchased product"),
      productDescription: asString(row.PRODUCT_DESCRIPTION, "No description"),
      purchasedStatus,
      purchasedStatusLabel: purchasedStatusLabel(purchasedStatus),
      purchaseStartUtc: asString(row.PURCHASE_START_UTC, "Not purchased"),
    };
  });

  const productCatalog = ((productCatalogResult?.rows ?? []) as Row[]).map(
    (row) => ({
      id: asNumber(row.PRODUCT_OBJ_ID0),
      name: asString(row.PRODUCT_NAME),
      description: asString(row.PRODUCT_DESCRIPTION, "No description"),
      permitted: asString(row.PERMITTED),
    }),
  );

  const planCatalog = ((planCatalogResult?.rows ?? []) as Row[]).map((row) => ({
    id: asNumber(row.PLAN_OBJ_ID0),
    name: asString(row.PLAN_NAME),
    description: asString(row.PLAN_DESCRIPTION, "No description"),
  }));

  const productMix = ((productMixResult?.rows ?? []) as Row[]).map((row) => ({
    productName: asString(row.PRODUCT_NAME),
    users: asNumber(row.USERS),
  }));

  const simulatedNowUtc =
    metrics.latest_group6_account_created_at_utc ||
    new Date().toISOString().replace("T", " ").slice(0, 19);

  return {
    connected: Boolean(metricsResult),
    generatedAt: new Date().toISOString(),
    simulatedNowUtc,
    serviceType: SERVICE_TYPE,
    metrics,
    users,
    productCatalog,
    planCatalog,
    productMix,
    notes: [
      "Scope is limited to the latest six accounts with /service/nextaig6.",
      "Dashboard timestamps use the latest Group 6 account timestamp as simulated current time because Oracle data is future-dated relative to 2026-06-26.",
      "Customer rows intentionally omit names, account numbers, emails, phone numbers, and addresses.",
    ],
    suggestedQuestion:
      "Summarize the six Group 6 customers, their active products, and the available Group 6 plans.",
  };
}

