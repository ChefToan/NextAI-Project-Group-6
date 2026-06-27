import { getGroup6Dashboard } from "@/lib/brm-group6";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getGroup6Dashboard());
  } catch (error) {
    return Response.json(
      {
        connected: false,
        generatedAt: new Date().toISOString(),
        simulatedNowUtc: "",
        serviceType: "/service/nextaig6",
        metrics: {},
        users: [],
        productCatalog: [],
        planCatalog: [],
        productMix: [],
        notes: [],
        suggestedQuestion:
          "Summarize the six Group 6 customers, their active products, and the available Group 6 plans.",
        error:
          error instanceof Error
            ? error.message
            : "Unknown Group 6 dashboard error",
      },
      { status: 200 },
    );
  }
}

