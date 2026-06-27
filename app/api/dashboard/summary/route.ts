import { getOracleDashboardSummary } from "@/lib/oracle-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getOracleDashboardSummary());
  } catch (error) {
    return Response.json(
      {
        connected: false,
        generatedAt: new Date().toISOString(),
        metrics: {},
        highlights: [],
        suggestedQuestion:
          "How many active, inactive, and closed BRM accounts are in Oracle, and what changed in the latest 7-day window?",
        error: error instanceof Error ? error.message : "Unknown Oracle summary error",
      },
      { status: 200 },
    );
  }
}
