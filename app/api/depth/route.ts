import { KAMINO_PAIRS } from "@/app/lib/bidwall/kamino";
import { cachedExit, EXIT_SIZES, type ExitSize } from "@/app/lib/demo/depth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live exit depth: what selling a fixed USD size of collateral on Jupiter costs. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("pair") ?? "";
  const pair = Object.hasOwn(KAMINO_PAIRS, id)
    ? KAMINO_PAIRS[id as keyof typeof KAMINO_PAIRS]
    : undefined;
  const size = Number(url.searchParams.get("size")) as ExitSize;
  if (!pair || !EXIT_SIZES.includes(size))
    return Response.json(
      { error: "Unsupported pair or size" },
      { status: 400 }
    );
  try {
    return Response.json(await cachedExit(pair, size), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Quote unavailable" }, { status: 502 });
  }
}
