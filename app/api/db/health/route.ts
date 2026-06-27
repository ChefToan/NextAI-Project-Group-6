import { getOraclePool, oracleConfigured } from "@/lib/oracle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!oracleConfigured()) {
    return Response.json(
      {
        ok: false,
        configured: false,
        message: "Oracle environment variables are not configured.",
      },
      { status: 200 },
    );
  }

  try {
    const pool = await getOraclePool();
    const connection = await pool.getConnection();

    try {
      const result = await connection.execute(
        "select systimestamp as SERVER_TIME from dual",
      );

      return Response.json({
        ok: true,
        configured: true,
        connectString: process.env.ORACLE_CONNECT_STRING,
        result: result.rows?.[0] ?? null,
      });
    } finally {
      await connection.close();
    }
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        message: error instanceof Error ? error.message : "Unknown Oracle error",
      },
      { status: 500 },
    );
  }
}
