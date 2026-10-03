/** US equity market sessions, in the order reports display them. */
export const SESSIONS = [
  "weekend",
  "overnight",
  "pre-market",
  "regular",
  "after-hours",
  "holiday",
] as const;
export type Session = (typeof SESSIONS)[number];

/** NYSE full-day closures in 2026. */
const NYSE_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

/** Minutes after midnight, New York time. */
const PRE_MARKET = 4 * 60;
const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const AFTER_HOURS_END = 20 * 60;

const SUNDAY = 0;
const MONDAY = 1;
const FRIDAY = 5;
const SATURDAY = 6;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type NewYorkClock = {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 = Sunday
  minutes: number; // since local midnight
  label: string; // "2026-10-03 14:14 EDT"
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

export function newYorkClock(at: Date): NewYorkClock {
  const parts = formatter.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`New York time has no ${type}`);
    return value;
  };
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = part("hour");
  const minute = part("minute");
  return {
    date,
    weekday: WEEKDAYS.indexOf(part("weekday")),
    minutes: Number(hour) * 60 + Number(minute),
    label: `${date} ${hour}:${minute} ${part("timeZoneName")}`,
  };
}

export function classifySession(at: Date): Session {
  const { date, weekday, minutes } = newYorkClock(at);
  if (NYSE_HOLIDAYS_2026.has(date)) return "holiday";

  const isWeekend =
    weekday === SATURDAY ||
    weekday === SUNDAY ||
    (weekday === FRIDAY && minutes >= AFTER_HOURS_END) ||
    (weekday === MONDAY && minutes < PRE_MARKET);
  if (isWeekend) return "weekend";

  if (minutes < PRE_MARKET || minutes >= AFTER_HOURS_END) return "overnight";
  if (minutes < OPEN) return "pre-market";
  if (minutes < CLOSE) return "regular";
  return "after-hours";
}
