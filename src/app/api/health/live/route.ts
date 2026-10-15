export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness: the process is up. Deliberately checks nothing external. */
export function GET(): Response {
  return Response.json({ status: "ok" });
}
