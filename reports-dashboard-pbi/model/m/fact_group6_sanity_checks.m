let
  Source = Csv.Document(
    File.Contents("C:\Users\toan\Desktop\NextAI\reports-dashboard-pbi\data\extracts\fact_group6_sanity_checks.csv"),
    [Delimiter = ",", Columns = 2, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
  ),
  PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
  ChangedType = Table.TransformColumnTypes(
    PromotedHeaders,
    {
      {"METRIC", type text},
      {"VALUE", type number}
    }
  )
in
  ChangedType
