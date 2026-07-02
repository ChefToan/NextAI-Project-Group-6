let
  Source = Csv.Document(
    File.Contents("C:\Users\toan\Desktop\NextAI\reports-dashboard-pbi\data\extracts\fact_group6_customer_bills.csv"),
    [Delimiter = ",", Columns = 16, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
  ),
  PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
  ChangedType = Table.TransformColumnTypes(
    PromotedHeaders,
    {
      {"BILL_ID", Int64.Type},
      {"BILL_REFERENCE", type text},
      {"BILL_STATUS", type text},
      {"ACCOUNT_ID", Int64.Type},
      {"CUSTOMER_NAME", type text},
      {"SERVICE_LOGIN", type text},
      {"BILL_MONTH", type text},
      {"BILL_START_DAY", type date},
      {"BILL_END_DAY", type date},
      {"DUE_DAY", type date},
      {"BILLED_USD", Currency.Type},
      {"RECEIVED_USD", Currency.Type},
      {"OUTSTANDING_USD", Currency.Type},
      {"DISPUTED_USD", Currency.Type},
      {"WRITEOFF_USD", Currency.Type},
      {"ADJUSTED_USD", Currency.Type}
    }
  )
in
  ChangedType
