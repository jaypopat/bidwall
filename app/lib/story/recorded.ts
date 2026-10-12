import type { DemoReceipt } from "../demo/types";
import recorded from "./recorded-receipt.json";

/** A verified local run, exported from GET /api/demo. Shown when the page has no
 * local runtime (a hosted copy), and always labelled as a recording.
 */
export const RECORDED_RECEIPT = recorded as DemoReceipt;
