import {
  getDemoResponse,
  localDemoEnabled,
  startDemo,
} from "@/app/lib/demo/server";
import { DEMO_TERMS } from "@/app/lib/bidwall/demo-terms";
import type { DemoPair } from "@/app/lib/demo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!localDemoEnabled(request))
    return Response.json(
      { enabled: false, running: false, output: [], receipt: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  return Response.json(await getDemoResponse(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!localDemoEnabled(request))
    return Response.json({ error: "Local demo is disabled" }, { status: 403 });
  // Only a supported pair id may reach the runner's environment.
  const body = await request.json().catch(() => ({}));
  const pair = (body?.pair ?? "onyc") as DemoPair["id"];
  if (!Object.hasOwn(DEMO_TERMS, pair))
    return Response.json({ error: "Unsupported demo pair" }, { status: 400 });
  if (!startDemo(pair))
    return Response.json(
      { error: "A local demo is already running" },
      { status: 409 }
    );
  return Response.json(await getDemoResponse(), {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}
