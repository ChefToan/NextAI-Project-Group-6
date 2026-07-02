import { NextResponse } from "next/server";
import { draftReportSelection } from "@/lib/ai-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRequest = { prompt?: string };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as DraftRequest;
  const draft = await draftReportSelection(String(body.prompt ?? ""));
  // A missing selection means the request could not be turned into a report.
  const status = draft.selection ? 200 : 400;
  return NextResponse.json(draft, { status });
}
