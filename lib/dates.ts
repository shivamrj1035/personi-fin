/** Calendar-date helpers. Dates are plain ISO strings ("2026-11-02") so they survive JSON and time zones. */
export type ISODate = string;

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;
const utc = (s: ISODate) => new Date(`${s}T00:00:00Z`);
const fromUtc = (d: Date): ISODate => iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

/** Today in the household's time zone (the server runs in UTC, the family lives in India). */
export function today(): ISODate {
  const tz = process.env.APP_TZ || "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function parts(s: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** Accepts ISO, "02 Nov 2026", "02/11/2026", "02-11-2026"; returns ISO or null. */
export function parseDate(v: unknown): ISODate | null {
  if (v instanceof Date) return fromUtc(v);
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS_SHORT.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    return mi >= 0 ? valid(+m[3], mi + 1, +m[1]) : null;
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y: number, m: number, d: number): ISODate | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? iso(y, m, d) : null;
}

/** "02 Nov 2026" (what the Sheet shows). Non-dates pass through. */
export function fmtDate(v: unknown): string {
  const d = parseDate(v);
  if (!d) return v == null ? "" : String(v);
  const { y, m, d: dd } = parts(d);
  return `${pad(dd)} ${MONTHS_SHORT[m - 1]} ${y}`;
}

export function addMonths(s: ISODate, n: number): ISODate {
  const { y, m, d } = parts(s);
  const t = m - 1 + n;
  const ny = y + Math.floor(t / 12);
  const nm = ((t % 12) + 12) % 12 + 1;
  for (const day of [d, 30, 29, 28]) {
    const r = valid(ny, nm, day);
    if (r) return r;
  }
  throw new Error("bad date");
}

export const firstOfMonth = (s: ISODate): ISODate => { const p = parts(s); return iso(p.y, p.m, 1); };
export const nextMonth = (s: ISODate): ISODate => addMonths(firstOfMonth(s), 1);
export const monthKey = (s: ISODate): string => s.slice(0, 7);
export const monthTitle = (s: ISODate): string => { const p = parts(s); return `${MONTHS_SHORT[p.m - 1]} ${p.y}`; };
export const monthLong = (s: ISODate): string => { const p = parts(s); return `${MONTHS_LONG[p.m - 1]} ${p.y}`; };
export const keyToDate = (k: string): ISODate => `${k}-01`;

/** "Nov 2026" -> "2026-11-01", otherwise null. */
export function parseMonthTitle(t: string): ISODate | null {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(t.trim());
  if (!m) return null;
  const mi = MONTHS_SHORT.findIndex((x) => x === m[1]);
  return mi >= 0 ? iso(+m[2], mi + 1, 1) : null;
}

export const daysInMonth = (s: ISODate): number => { const p = parts(s); return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate(); };
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((utc(a).getTime() - utc(b).getTime()) / 86400000);
export const weekday = (s: ISODate): number => (utc(s).getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
export const withDay = (s: ISODate, day: number): ISODate => { const p = parts(s); return iso(p.y, p.m, day); };
export const monthsBetween = (from: ISODate, to: ISODate): number => { const a = parts(from), b = parts(to); return (b.y - a.y) * 12 + b.m - a.m; };

export function lastWorkingDay(s: ISODate): ISODate {
  const nxt = nextMonth(s);
  let x = fromUtc(new Date(utc(nxt).getTime() - 86400000));
  while (weekday(x) > 4) x = fromUtc(new Date(utc(x).getTime() - 86400000));
  return x;
}

export const cmp = (a: ISODate, b: ISODate): number => (a < b ? -1 : a > b ? 1 : 0);
