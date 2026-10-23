export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      version: process.env.APP_VERSION ?? "dev",
      revision: process.env.APP_REVISION ?? "unknown",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
