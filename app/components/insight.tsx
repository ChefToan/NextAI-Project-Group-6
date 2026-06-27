// Renders an insight line with a small provenance badge (AI = Gemini Flash,
// AUTO = deterministic fallback computed from the data).
export function InsightNote({
  text,
  source,
  style,
}: {
  text: string;
  source: "ai" | "computed";
  style?: React.CSSProperties;
}) {
  return (
    <div className="insight" style={style}>
      <span className={`insight-badge ${source === "ai" ? "is-ai" : "is-auto"}`}>
        <span className="ms" style={{ fontSize: 12 }}>{source === "ai" ? "auto_awesome" : "functions"}</span>
        {source === "ai" ? "AI" : "AUTO"}
      </span>
      <span>{text}</span>
    </div>
  );
}
