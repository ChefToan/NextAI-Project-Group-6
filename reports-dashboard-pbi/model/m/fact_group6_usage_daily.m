let
  Source = Csv.Document(
    File.Contents("C:\Users\toan\Desktop\NextAI\reports-dashboard-pbi\data\extracts\fact_group6_usage_daily.csv"),
    [Delimiter = ",", Columns = 15, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
  ),
  PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
  ChangedType = Table.TransformColumnTypes(
    PromotedHeaders,
    {
      {"EVENT_DAY", type date},
      {"EVENT_MONTH", type text},
      {"EVENT_HOUR", Int64.Type},
      {"MODEL", type text},
      {"RUM_NAME", type text},
      {"GL_ID", type text},
      {"REVENUE_TYPE", type text},
      {"EVENT_COUNT", Int64.Type},
      {"ACTIVE_ACCOUNTS", Int64.Type},
      {"PROMPTS", Int64.Type},
      {"INPUT_TOKENS", Int64.Type},
      {"OUTPUT_TOKENS", Int64.Type},
      {"TOTAL_TOKENS", Int64.Type},
      {"TOKEN_BLOCKS", type number},
      {"USAGE_REVENUE", Currency.Type}
    }
  )
in
  ChangedType
