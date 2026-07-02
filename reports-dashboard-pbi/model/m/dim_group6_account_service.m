let
  Source = Csv.Document(
    File.Contents("C:\Users\toan\Desktop\NextAI\reports-dashboard-pbi\data\extracts\dim_group6_account_service.csv"),
    [Delimiter = ",", Columns = 6, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
  ),
  PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
  ChangedType = Table.TransformColumnTypes(
    PromotedHeaders,
    {
      {"ACCOUNT_ID", Int64.Type},
      {"ACCOUNT_STATUS", Int64.Type},
      {"ACCOUNT_CREATED_DAY", type date},
      {"SERVICE_ID", Int64.Type},
      {"SERVICE_LOGIN", type text},
      {"SERVICE_STATUS", Int64.Type}
    }
  )
in
  ChangedType
