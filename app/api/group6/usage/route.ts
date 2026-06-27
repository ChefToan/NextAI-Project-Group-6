import { getGroup6Usage } from "@/lib/group6-usage";
import { parseRange } from "@/lib/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
    const usage = await getGroup6Usage(range);
    return Response.json(usage);
  } catch (error) {
    return Response.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : "Unknown usage error",
      },
      { status: 200 },
    );
  }
}
