export const GROUP6_SERVICE_TYPE = "/service/nextaig6";
export const GROUP6_EXCLUDED_SERVICE_LOGINS = ["web_acme_1"];

function quoteSql(value: string) {
  return `'${value.replace(/'/g, "''").toLowerCase()}'`;
}

export function group6ExcludedLoginSql() {
  return GROUP6_EXCLUDED_SERVICE_LOGINS.map(quoteSql).join(", ");
}

export function group6ServiceWhere(alias = "s") {
  const prefix = alias ? `${alias}.` : "";
  const excluded = group6ExcludedLoginSql();
  const exclusion = excluded ? ` and lower(${prefix}login) not in (${excluded})` : "";
  return `${prefix}poid_type = '${GROUP6_SERVICE_TYPE}'${exclusion}`;
}

export function group6AccountSubquery() {
  return `select distinct a.poid_id0 from account_t a join service_t s on s.account_obj_id0 = a.poid_id0 where ${group6ServiceWhere("s")}`;
}