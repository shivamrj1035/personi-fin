/** Parse repayment-schedule PDFs and loan screenshots into a normalised loan + schedule (port of pdf_import.py / image_import.py). */
import "server-only";
import { MODEL, anthropic, parseJsonObject } from "./ai";
import { ISODate, addMonths, parseDate, today } from "./dates";
import * as L from "./loans";
import { ScheduleRow } from "./loans";

export interface Parsed {
  name: string; lender: string; owner: string; principal: number; rate_pa: number; emi: number; tenure_months: number;
  first_due_date: ISODate | null; schedule: ScheduleRow[] | null; confidence: string; notes: string;
  needs_dates?: boolean; rebuild?: boolean; paid?: number | null;
}

const NUM = "[\\d,]+(?:\\.\\d+)?";
const n = (s: string) => parseFloat(s.replace(/,/g, ""));
const mostCommon = <T,>(xs: T[]): T => { const c = new Map<T, number>(); xs.forEach((x) => c.set(x, (c.get(x) || 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; };

export class PasswordRequired extends Error { constructor(public wrong: boolean) { super(wrong ? "Wrong PDF password" : "This PDF is password protected"); } }

/** Text of every page, one line per visual row (items grouped by y position). */
export async function pdfText(data: Uint8Array, password?: string): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  try { pdf = await getDocumentProxy(data, { password } as never); } catch (e) {
    if ((e as { name?: string }).name === "PasswordException") throw new PasswordRequired(!!password);
    throw e;
  }
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3); // tolerate small baseline jitter
      (rows.get(y) || rows.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(" "));
  }
  return lines.join("\n");
}

const toIso = (s: string): ISODate => {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{2,4})$/.exec(s);
  if (!m) throw new Error(s);
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${m[2]}-${m[1]}`;
};

function rowsOf(text: string): (number | string)[][] {
  const out: (number | string)[][] = [];
  const re = new RegExp(`^(\\d+)\\s+(\\d{2}[/-]\\d{2}[/-]\\d{4})((?:\\s+${NUM})+)\\s*$`);
  for (const line of text.split("\n")) {
    const m = re.exec(line.trim());
    if (m) out.push([+m[1], toIso(m[2]), ...m[3].trim().split(/\s+/).map(n)]);
  }
  return out;
}

export function parseScheduleText(text: string): Parsed {
  const low = text.toLowerCase();
  let lender = low.includes("central bank") ? "Central Bank of India" : low.includes("idfc") ? "IDFC FIRST Bank" : low.includes("bajaj") ? "Bajaj Finance" : low.includes("axis") ? "Axis Bank" : "Unknown";
  let owner = "";
  for (const pat of [/Customer Name:?\s*([A-Za-z ]+)/, /Customer\s+([A-Za-z ]+?)\s+Product/, /NAME-+\s*(.+)/]) {
    const m = pat.exec(text);
    if (m) { owner = m[1].trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); break; }
  }
  if (text.includes("Loan Amortisation Schedule") && text.includes("Credit Card")) return parseCardEmi(text);
  const rows = rowsOf(text);
  if (lender === "Unknown" && /A\/C NO/.test(text)) lender = "Central Bank of India"; // layout of the home-loan schedule; confirm in preview
  if (lender === "Bajaj Finance" || (!rows.length && text.includes("Agreement"))) return parseSummaryStyle(text, lender, owner);
  if (!rows.length) throw new Error("No instalment table recognised in this PDF");

  const sched: ScheduleRow[] = [];
  for (const r of rows) {
    const v = r.slice(2) as number[];
    if (v.length === 5) sched.push({ inst_no: r[0] as number, due_date: r[1] as string, opening: v[0], emi: v[1], principal: v[2], interest: v[3], closing: v[4] }); // IDFC
    else if (v.length === 3) sched.push({ inst_no: r[0] as number, due_date: r[1] as string, principal: v[0], interest: v[1], emi: v[2], opening: NaN, closing: NaN }); // Central Bank
  }
  if (!sched.length) throw new Error("Instalment rows had an unexpected layout");
  if (Number.isNaN(sched[0].opening)) { // Central Bank layout carries no balances: rebuild them from the principal column
    let bal = sched.reduce((s, x) => s + x.principal, 0);
    for (const s of sched) { s.opening = L.round(bal, 2); s.closing = L.round(bal - s.principal, 2); bal -= s.principal; }
  }
  const principal = sched[0].opening, payment = mostCommon(sched.map((s) => s.emi));
  const m = new RegExp(`Rate of Interest\\s+(${NUM})`).exec(text);
  const rate = m ? n(m[1]) : L.solveRate(principal, payment, sched.length);
  return { name: `${lender} loan`, lender, owner, principal: L.round(principal, 2), rate_pa: rate, emi: payment, tenure_months: sched.length,
    first_due_date: sched[0].due_date, schedule: sched, confidence: "high", notes: "Parsed from lender repayment schedule" + (m ? "" : "; rate derived from EMI") };
}

/** Bajaj-style schedules wrap dates/numbers badly; trust the summary block instead. */
function parseSummaryStyle(text: string, lender: string, owner: string): Parsed {
  const amt = new RegExp(`Loan Amount\\s+(${NUM})`).exec(text), ten = /Tenure\(In Months\)\s+(\d+)/.exec(text), start = /Interest Start Date\s+(\d{2}\/\d{2}\/\d{4})/.exec(text);
  if (!(amt && ten && start)) throw new Error("Could not read loan summary");
  const pays = [...text.matchAll(new RegExp(`(\\d+)\\s+\\d{2}/\\d{2}/\\d{2}\\s+${NUM}\\s+(${NUM})`, "g"))];
  const principal = n(amt[1]), months = +ten[1];
  let emiAmt = Math.round(principal / months);
  if (pays.length) emiAmt = n(mostCommon(pays.map((p) => p[2])));
  const first = addMonths(toIso(start[1]), 1);
  const sched: ScheduleRow[] = [];
  let bal = principal;
  for (let i = 1; i <= months; i++) {
    const pay = i === months || bal - emiAmt < 2 ? bal : emiAmt;
    sched.push({ inst_no: i, due_date: addMonths(first, i - 1), opening: L.round(bal, 2), principal: L.round(pay, 2), interest: 0, emi: L.round(pay, 2), closing: L.round(bal - pay, 2) });
    bal -= pay;
  }
  return { name: `${lender} EMI`, lender, owner, principal, rate_pa: 0, emi: emiAmt, tenure_months: months, first_due_date: first, schedule: sched, confidence: "medium",
    notes: "Interest is built into the EMI (0% effective); schedule rebuilt from summary" };
}

/** Axis credit-card EMI conversion: no dates in the PDF, so first_due_date is null (ask the user). */
function parseCardEmi(text: string): Parsed {
  const amt = new RegExp(`Loan Amount:\\s*₹\\s*(${NUM})`).exec(text), ref = /Loan Reference Number:\s*(\d+)/.exec(text);
  const rows: ScheduleRow[] = [];
  const re = new RegExp(`^(\\d+)\\s+₹\\s*(${NUM})\\s+₹\\s*(${NUM})\\s+₹\\s*(${NUM})\\s+₹\\s*(${NUM})\\s*$`);
  for (const line of text.split("\n")) {
    const m = re.exec(line.trim());
    if (m) rows.push({ inst_no: +m[1], due_date: null, opening: n(m[2]), principal: n(m[3]), interest: n(m[4]), emi: n(m[5]), closing: L.round(n(m[2]) - n(m[3]), 2) });
  }
  if (!(amt && rows.length)) throw new Error("Could not read card EMI schedule");
  const principal = n(amt[1]), payment = rows[0].emi;
  rows[rows.length - 1].closing = 0;
  return { name: `Axis card EMI ${ref ? ref[1] : ""}`.trim(), lender: "Axis Bank (Credit Card)", owner: "", principal, rate_pa: L.solveRate(principal, payment, rows.length), emi: payment,
    tenure_months: rows.length, first_due_date: null, schedule: rows, confidence: "high", needs_dates: true,
    notes: "Card EMI conversion; rate derived from EMI (flat-style interest). PDF has no dates." };
}

export async function parsePdf(data: Uint8Array, password?: string): Promise<Parsed> {
  return parseScheduleText(await pdfText(data, password));
}

/** Fill due dates for PDFs that don't carry any. */
export function applyDates(p: Parsed, firstDue: ISODate): Parsed {
  return { ...p, first_due_date: firstDue, needs_dates: false,
    schedule: (p.schedule || []).map((r) => ({ ...r, due_date: addMonths(firstDue, r.inst_no - 1) })) };
}

const IMAGE_PROMPT =
  "This is a screenshot of a loan / EMI summary. Reply with ONLY a JSON object, no prose: " +
  '{"lender":str|null,"account_no":str|null,"principal":number|null,"rate_pa":number|null,"tenure_months":int|null,"first_due_date":"YYYY-MM-DD"|null,' +
  '"emi":number|null,"installments_paid":int|null,"outstanding":number|null,"next_due_date":"YYYY-MM-DD"|null}. ' +
  "Amounts are plain numbers in rupees. Use null for anything not visible; never guess.";

export async function parseImage(data: Buffer, mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"): Promise<Parsed> {
  const msg = await anthropic().messages.create({ model: MODEL, max_tokens: 800, messages: [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: mediaType, data: data.toString("base64") } }, { type: "text", text: IMAGE_PROMPT }] }] });
  const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const d = parseJsonObject<Record<string, number | string | null>>(raw, () => true);
  if (!d) throw new Error("Could not read details from this image");
  const principal = Number(d.principal), months = Number(d.tenure_months);
  if (!principal || !months) throw new Error("Couldn't find the loan amount and tenure in this screenshot - try the questions option");
  const first = d.first_due_date ? parseDate(d.first_due_date) : null;
  const notes = ["Read from a screenshot - please check the numbers"];
  let emi = Number(d.emi) || 0;
  let rate = d.rate_pa == null ? null : Number(d.rate_pa);
  if (!emi) { emi = L.emi(principal, rate || 0, months); notes.push("EMI calculated"); }
  if (rate == null) { rate = L.solveRate(principal, emi, months); notes.push("rate derived from EMI"); }
  const e = Math.round(emi);
  return { name: String(d.lender || "Loan"), lender: String(d.lender || "Unknown"), owner: "", principal, rate_pa: rate, emi: e, tenure_months: months,
    first_due_date: first || today(), schedule: first ? L.schedule(principal, rate, e, months, first) : null, confidence: "medium", needs_dates: !first,
    rebuild: true, notes: notes.join("; "), paid: d.installments_paid == null ? null : Number(d.installments_paid) };
}
