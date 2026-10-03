import { describe, expect, test } from "bun:test";
import { classifySession, newYorkClock } from "../../scripts/quotes/session.ts";

const at = (iso: string) => classifySession(new Date(iso));

describe("classifySession", () => {
  test("regular hours open at 09:30 and close at 16:00 New York time", () => {
    expect(at("2026-10-05T13:29:59Z")).toBe("pre-market");
    expect(at("2026-10-05T13:30:00Z")).toBe("regular");
    expect(at("2026-10-05T19:59:59Z")).toBe("regular");
    expect(at("2026-10-05T20:00:00Z")).toBe("after-hours");
  });

  test("weeknight overnight runs from 20:00 to 04:00", () => {
    expect(at("2026-10-06T00:00:00Z")).toBe("overnight"); // Mon 20:00 EDT
    expect(at("2026-10-06T07:59:00Z")).toBe("overnight"); // Tue 03:59 EDT
    expect(at("2026-10-06T08:00:00Z")).toBe("pre-market"); // Tue 04:00 EDT
  });

  test("the weekend runs from Friday 20:00 to Monday 04:00", () => {
    expect(at("2026-10-09T23:59:00Z")).toBe("after-hours"); // Fri 19:59 EDT
    expect(at("2026-10-10T00:00:00Z")).toBe("weekend"); // Fri 20:00 EDT
    expect(at("2026-10-03T18:14:26Z")).toBe("weekend"); // Sat
    expect(at("2026-10-05T07:59:00Z")).toBe("weekend"); // Mon 03:59 EDT
    expect(at("2026-10-05T08:00:00Z")).toBe("pre-market"); // Mon 04:00 EDT
  });

  test("follows both 2026 daylight-saving changes", () => {
    expect(at("2026-03-09T13:30:00Z")).toBe("regular"); // 09:30 EDT
    expect(at("2026-11-02T14:29:00Z")).toBe("pre-market"); // 09:29 EST
    expect(at("2026-11-02T14:30:00Z")).toBe("regular"); // 09:30 EST
  });

  test("NYSE holidays are closed all day", () => {
    expect(at("2026-11-26T15:00:00Z")).toBe("holiday");
  });
});

describe("newYorkClock", () => {
  test("labels the local time and zone so a reader can check the session", () => {
    expect(newYorkClock(new Date("2026-10-03T18:14:26Z")).label).toBe(
      "2026-10-03 14:14 EDT"
    );
    expect(newYorkClock(new Date("2026-11-02T14:30:00Z")).label).toBe(
      "2026-11-02 09:30 EST"
    );
  });
});
