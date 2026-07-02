let
  Source = Csv.Document(
    File.Contents("C:\Users\toan\Desktop\NextAI\reports-dashboard-pbi\data\extracts\fact_group6_finance_monthly.csv"),
    [Delimiter = ",", Columns = 14, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
  ),
  PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
  ChangedType = Table.TransformColumnTypes(
    PromotedHeaders,
    {
      {"FINANCE_MONTH", type text},
      {"BILLED_BILL_COUNT", Int64.Type},
      {"UNBILLED_BILL_COUNT", Int64.Type},
      {"BILLED_USD", Currency.Type},
      {"UNBILLED_USD", Currency.Type},
      {"COLLECTED_USD", Currency.Type},
      {"OUTSTANDING_USD", Currency.Type},
      {"DISPUTED_USD", Currency.Type},
      {"WRITEOFF_USD", Currency.Type},
      {"ADJUSTED_USD", Currency.Type},
      {"AIT_TAXABLE_BASE_USD", Currency.Type},
      {"AIT_COLLECTED_USD", Currency.Type},
      {"EXPECTED_AIT_USD", Currency.Type},
      {"AIT_GAP_USD", Currency.Type}
    }
  )
in
  ChangedType
