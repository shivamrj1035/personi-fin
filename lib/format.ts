import { ISODate, fmtDate } from "./dates";
export { inr } from "./report";

export function monthsLabel(n: number | null | undefined): string {
  if (n == null) return "never (EMI too low)";
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y}y` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}
export const dateLabel = (d: ISODate | null | undefined): string => (d ? fmtDate(d) : "-");

/** Compact rupees for chart axes: 1.2L, 3.4Cr, 45k. */
export function inrShort(x: number): string {
  const a = Math.abs(x), s = x < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${+(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}₹${+(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${s}₹${+(a / 1e3).toFixed(1)}k`;
  return `${s}₹${Math.round(a)}`;
}
