import { summarizePanel } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { panel?: string; context?: unknown };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const panel = (body.panel || "chart").slice(0, 80);
    const result = await summarizePanel(panel, body.context ?? {});
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { text: "", source: "computed", error: error instanceof Error ? error.message : "summarize failed" },
      { status: 200 },
    );
  }
}
