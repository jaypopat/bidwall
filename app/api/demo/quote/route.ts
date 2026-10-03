import { getDemoResponse, localDemoEnabled } from "@/app/lib/demo/server";
import { refreshDeliveryQuote } from "@/app/lib/demo/quote";
import type { DemoQuote } from "@/app/lib/demo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let inFlight: Promise<DemoQuote> | undefined;

export async function POST(request: Request) {
  if (!localDemoEnabled(request))
    return Response.json({ error: "Local demo is disabled" }, { status: 403 });
  const { receipt, running } = await getDemoResponse();
  if (running || receipt?.status !== "passed")
    return Response.json(
      { error: "Complete the local scenario before requesting a quote" },
      { status: 409 }
    );
  try {
    inFlight ??= refreshDeliveryQuote(receipt).finally(() => {
      inFlight = undefined;
    });
    return Response.json(await inFlight, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Could not record the comparison quote" },
      { status: 502 }
    );
  }
}
