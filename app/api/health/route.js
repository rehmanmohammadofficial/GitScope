// GET /api/health
// The frontend calls this on page load to wake up a sleeping free-tier server.
export async function GET() {
  return Response.json({ status: "ok" });
}
