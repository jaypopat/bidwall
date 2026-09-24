import {
  getDemoResponse,
  localDemoEnabled,
  startDemo,
} from "@/app/lib/demo/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!localDemoEnabled(request))
    return Response.json(
      { enabled: false, running: false, output: [], receipt: null },
      { status: 403 }
    );
  return Response.json(await getDemoResponse(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!localDemoEnabled(request))
    return Response.json({ error: "Local demo is disabled" }, { status: 403 });
  if (!startDemo())
    return Response.json(
      { error: "A local demo is already running" },
      { status: 409 }
    );
  return Response.json(await getDemoResponse(), {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}
