/**
 * Google Sheets storage (server only). Port of core/sheets.py - same workbook layout, so the existing Sheet keeps working.
 *
 *   Summary            one row per loan, live totals, month-by-month progress
 *   <Mon YYYY>         one tab per month: EMIs due (tick Paid), extra payments, income per person, KPIs
 *   <Loan name>        one tab per loan: details block + repayment schedule
 *   Recurring Income, Expenses, Goals, Savings Log, Holdings, Settings   flat tables
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { google, sheets_v4 } from "googleapis";
import { SHEET_ID } from "./config";
import {
  ISODate, firstOfMonth, fmtDate, keyToDate, monthKey, monthTitle, nextMonth, parseDate, parseMonthTitle, today, monthLong,
} from "./dates";
import * as L from "./loans";
import { Row, State, Tabs, num, truthy } from "./state";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export const FLAT: Record<string, string[]> = {
  "Recurring Income": ["person", "source", "amount"],
  Expenses: ["name", "owner", "category", "amount", "note", "month", "id", "day"], // month "" = every month; day = due day
  Goals: ["name", "target", "saved", "percent", "target_date", "note", "id"],
  "Savings Log": ["month", "goal_id", "amount", "by", "note", "id"],
  Holdings: ["symbol", "name", "qty", "avg_price", "buy_date", "target_price", "stop_loss", "note", "id"],
  Settings: ["key", "value"],
};
const DEFAULT_SETTINGS = [["emergency_buffer", 0], ["persons", "Shivam,Rajesh,Hetal"], ["prepay_mode", "keep"], ["risk_profile", "moderate"], ["invest_horizon", "3-5 years"]];
const LEGACY_TABS = new Set(["Sheet1", "Loans", "Schedule", "Payments", "Income"]);
const RESERVED = new Set(["Summary", ...Object.keys(FLAT)]);

const META: [string, string][] = [["Loan ID", "id"], ["Lender", "lender"], ["Owner", "owner"], ["Type", "type"], ["Original amount", "principal"],
  ["Interest % p.a.", "rate_pa"], ["EMI / monthly amount", "emi"], ["Tenure (months)", "tenure_months"], ["First due date", "first_due_date"],
  ["Rate type", "rate_type"], ["Prepayment charge %", "prepay_charge_pct"], ["Deadline", "deadline"], ["Status", "status"],
  ["Owed at start", "outstanding"], ["Notes", "notes"]];
const META_ROW0 = 3, LOAN_HDR = 20;
const SCHED_COLS = ["Inst #", "Due date", "Opening", "Principal", "Interest", "EMI", "Closing", "Status", "Paid on"];

const M_HDR = 9, M_ROW0 = 10, M_MAX = 300;
const EMI_COLS = ["Loan", "Owner", "Due date", "Instalment", "Amount", "Principal part", "Paid", "Paid on", "Ref", "Paid by"];
const EXTRA_COLS = ["Loan", "Amount", "Date", "Note", "Applied", "Result", "Paid by"];
const INC_COLS = ["Person", "Source", "Amount", "Received", "Type"];
const RUPEE = "[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0";

type RGB = [number, number, number];
const INDIGO: RGB = [0.19, 0.18, 0.51], INDIGO_BG: RGB = [0.88, 0.91, 0.99];
const GREEN_BG: RGB = [0.86, 0.96, 0.89], AMBER_BG: RGB = [1.0, 0.95, 0.8];
const RED_BG: RGB = [0.99, 0.84, 0.84], RED_FG: RGB = [0.6, 0.1, 0.1];
const rgb = (c: RGB) => ({ red: c[0], green: c[1], blue: c[2] });

// ---------------------------------------------------------------- small helpers
export function colLetter(i: number): string {
  let s = "";
  i += 1;
  while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
const q = (title: string) => "'" + title.replace(/'/g, "''") + "'";
const bool = (v: unknown) => ["TRUE", "1"].includes(String(v ?? "").trim().toUpperCase());
const baseRef = (ref: unknown) => { const r = String(ref); return r.startsWith("carry:") ? r.slice(6) : r; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r2 = (x: number) => L.round(x, 2);
const uid = () => randomUUID().replace(/-/g, "").slice(0, 8);

const expenseFormula = (mk: string) =>
  `=SUMPRODUCT(Expenses!D2:D500*(LEN(Expenses!F2:F500)=0))+SUMPRODUCT(Expenses!D2:D500*ISNUMBER(SEARCH("${mk}",Expenses!F2:F500)))`;
const emiDueFormula = () => `=SUMIFS(E${M_ROW0}:E${M_MAX},I${M_ROW0}:I${M_MAX},"<>exp:*",I${M_ROW0}:I${M_MAX},"<>carry:exp:*")`;
const emiPaidFormula = () => `=SUMIFS(E${M_ROW0}:E${M_MAX},G${M_ROW0}:G${M_MAX},TRUE,I${M_ROW0}:I${M_MAX},"<>exp:*",I${M_ROW0}:I${M_MAX},"<>carry:exp:*")`;

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Google credentials missing: set GOOGLE_SERVICE_ACCOUNT_JSON (the service-account key JSON).");
  let text = raw;
  if (!text.trim().startsWith("{")) text = Buffer.from(text, "base64").toString("utf8"); // allow a base64-encoded key
  const c = JSON.parse(text);
  c.private_key = String(c.private_key).replace(/\\n/g, "\n");
  return c;
}

export interface Kpi { tab: string; row4: unknown[]; row6: unknown[] }
export interface Snapshot { tabs: Tabs; kpis: Record<string, Kpi> }
interface Ws { id: number; title: string }

// ---------------------------------------------------------------- Store
export class Store {
  private api: sheets_v4.Sheets;
  private wss = new Map<string, Ws>();
  kpis: Record<string, Kpi> = {};

  constructor() {
    const auth = new google.auth.GoogleAuth({ credentials: credentials(), scopes: SCOPES });
    this.api = google.sheets({ version: "v4", auth });
  }

  // ------------------------------------------------------------ plumbing
  /** Ride out Sheets' per-minute quota instead of failing the user's action. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e: unknown) {
        const status = (e as { code?: number; status?: number }).code ?? (e as { status?: number }).status;
        if (status !== 429 || i >= 4) throw e;
        await sleep(8000 + 6000 * i);
      }
    }
  }

  async refreshWss(): Promise<Map<string, Ws>> {
    const res = await this.call(() => this.api.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets(properties(sheetId,title))" }));
    this.wss = new Map((res.data.sheets || []).map((s) => [s.properties!.title!, { id: s.properties!.sheetId!, title: s.properties!.title! }]));
    return this.wss;
  }

  private async ws(title: string): Promise<Ws> {
    const w = this.wss.get(title) || (await this.refreshWss()).get(title);
    if (!w) throw new Error(`Tab not found: ${title}`);
    return w;
  }

  private async batch(requests: sheets_v4.Schema$Request[]): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
    if (!requests.length) return {};
    return (await this.call(() => this.api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } }))).data;
  }

  private async values(data: [string, unknown[][]][], raw = true): Promise<void> {
    if (!data.length) return;
    await this.call(() => this.api.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: raw ? "RAW" : "USER_ENTERED", data: data.map(([range, v]) => ({ range, values: v as never })) },
    }));
  }

  private async clear(ranges: string[]): Promise<void> {
    await this.call(() => this.api.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, requestBody: { ranges } }));
  }

  private async getRange(range: string, formatted = true): Promise<unknown[][]> {
    const r = await this.call(() => this.api.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range, valueRenderOption: formatted ? "FORMATTED_VALUE" : "UNFORMATTED_VALUE" }));
    return (r.data.values as unknown[][]) || [];
  }

  private async addSheet(title: string, rows: number, cols: number): Promise<Ws> {
    try {
      const res = await this.batch([{ addSheet: { properties: { title, gridProperties: { rowCount: rows, columnCount: cols } } } }]);
      const p = res.replies![0].addSheet!.properties!;
      const w = { id: p.sheetId!, title };
      this.wss.set(title, w);
      return w;
    } catch (e) {
      if (/already exists/i.test(String((e as Error).message))) return this.ws((await this.refreshWss(), title)); // another request created it first
      throw e;
    }
  }

  // ---- format requests
  private rng(sid: number, r0: number, r1: number, c0: number, c1: number) {
    return { sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 };
  }
  private headerReq(sid: number, r0: number, r1: number, c0: number, c1: number, bg: RGB = INDIGO_BG): sheets_v4.Schema$Request {
    return { repeatCell: { range: this.rng(sid, r0, r1, c0, c1),
      cell: { userEnteredFormat: { backgroundColor: rgb(bg), textFormat: { bold: true, foregroundColor: rgb(INDIGO) } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } };
  }
  private numfmtReq(sid: number, r0: number, r1: number, c0: number, c1: number, pattern = RUPEE): sheets_v4.Schema$Request {
    return { repeatCell: { range: this.rng(sid, r0, r1, c0, c1), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern } } },
      fields: "userEnteredFormat.numberFormat" } };
  }
  private boldReq(sid: number, r0: number, r1: number, c0: number, c1: number, o: { size?: number; color?: RGB; bg?: RGB } = {}): sheets_v4.Schema$Request {
    const text: sheets_v4.Schema$TextFormat = { bold: true };
    const fmt: sheets_v4.Schema$CellFormat = { textFormat: text };
    const fields = ["textFormat"];
    if (o.size) text.fontSize = o.size;
    if (o.color) text.foregroundColor = rgb(o.color);
    if (o.bg) { fmt.backgroundColor = rgb(o.bg); fields.push("backgroundColor"); }
    return { repeatCell: { range: this.rng(sid, r0, r1, c0, c1), cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${fields.join(",")})` } };
  }
  private widthReq(sid: number, c0: number, c1: number, px: number): sheets_v4.Schema$Request {
    return { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: c0, endIndex: c1 }, properties: { pixelSize: px }, fields: "pixelSize" } };
  }
  private validationReq(sid: number, r0: number, r1: number, c: number, rule?: sheets_v4.Schema$DataValidationRule | null): sheets_v4.Schema$Request {
    const req: sheets_v4.Schema$SetDataValidationRequest = { range: this.rng(sid, r0, r1, c, c + 1) };
    if (rule) req.rule = rule;
    return { setDataValidation: req };
  }
  private checkboxReq(sid: number, r0: number, r1: number, c: number) {
    return this.validationReq(sid, r0, r1, c, { condition: { type: "BOOLEAN" }, strict: true });
  }
  private carryFormatReq(sid: number): sheets_v4.Schema$Request {
    return { addConditionalFormatRule: { index: 0, rule: {
      ranges: [this.rng(sid, M_ROW0 - 1, M_MAX, 0, 8)],
      booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=LEFT($I${M_ROW0},6)="carry:"` }] },
        format: { backgroundColor: rgb(RED_BG), textFormat: { foregroundColor: rgb(RED_FG) } } } } } };
  }
  private loanListRule(names: string[]): sheets_v4.Schema$DataValidationRule | null {
    if (!names.length) return null;
    return { condition: { type: "ONE_OF_LIST", values: names.map((n) => ({ userEnteredValue: n })) }, showCustomUi: true, strict: false };
  }

  private async orderTabs(): Promise<void> {
    const t = [...this.wss.keys()];
    const months = t.filter((x) => parseMonthTitle(x)).sort((a, b) => (parseMonthTitle(b)! < parseMonthTitle(a)! ? -1 : 1));
    const loans = t.filter((x) => !RESERVED.has(x) && !parseMonthTitle(x)).sort();
    const order = ["Summary", ...months, ...loans, ...Object.keys(FLAT)];
    await this.batch(order.filter((x) => this.wss.has(x)).map((x, i) => ({
      updateSheetProperties: { properties: { sheetId: this.wss.get(x)!.id, index: i }, fields: "index" } })));
  }

  // ------------------------------------------------------------ settings flags (hidden keys start with "_")
  private async flag(tabs: Tabs, key: string): Promise<string> {
    return String(tabs.Settings.find((r) => r.key === key)?.value ?? "");
  }
  private async setFlag(key: string, value: string): Promise<void> {
    if (!(await this.updateRow("Settings", { key }, { value }))) await this.append("Settings", [{ key, value }]);
  }

  // ------------------------------------------------------------ setup
  /** Make sure every flat tab exists with the right header. Cheap when nothing is missing. */
  async bootstrap(): Promise<void> {
    await this.refreshWss();
    const names = Object.keys(FLAT);
    const created: string[] = [];
    for (const t of names) if (!this.wss.has(t)) { await this.addSheet(t, 300, Math.max(FLAT[t].length, 6)); created.push(t); }
    if (!this.wss.has("Summary")) { await this.addSheet("Summary", 200, 14); created.push("Summary"); }
    const heads = await this.call(() => this.api.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: names.map((t) => `${q(t)}!1:1`) }));
    const reqs: sheets_v4.Schema$Request[] = [];
    for (let i = 0; i < names.length; i++) {
      const cols = FLAT[names[i]];
      const have = ((heads.data.valueRanges![i].values || [[]])[0] || []).map(String);
      if (have.length !== cols.length || have.some((h, j) => h !== cols[j])) {
        const w = await this.ws(names[i]);
        await this.values([[`${q(names[i])}!A1`, [cols]]]);
        reqs.push(this.headerReq(w.id, 0, 1, 0, cols.length),
          { updateSheetProperties: { properties: { sheetId: w.id, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
      }
    }
    await this.batch(reqs);
    const settings = await this.getRange(`${q("Settings")}!A:B`);
    if (settings.length <= 1) await this.call(() => this.api.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${q("Settings")}!A1`, valueInputOption: "RAW", requestBody: { values: DEFAULT_SETTINGS as never } }));
    let deleted = false;
    for (const t of LEGACY_TABS) {
      if (!this.wss.has(t) || this.wss.size <= 1) continue; // old single-table layout, only removed when empty
      const vals = await this.getRange(q(t));
      if (!vals.slice(1).some((r) => r.some((c) => String(c).trim()))) {
        await this.batch([{ deleteSheet: { sheetId: this.wss.get(t)!.id } }]);
        this.wss.delete(t); deleted = true;
      }
    }
    if (created.length || deleted) { await this.refreshWss(); await this.orderTabs(); }
  }

  // ------------------------------------------------------------ reading
  async readAll(): Promise<Snapshot> {
    const wss = await this.refreshWss();
    const loanTabs = [...wss.keys()].filter((t) => !RESERVED.has(t) && !parseMonthTitle(t));
    const monthTabs = [...wss.keys()].filter((t) => parseMonthTitle(t));
    const titles = [...Object.keys(FLAT), ...loanTabs, ...monthTabs];
    const res = await this.call(() => this.api.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID, valueRenderOption: "UNFORMATTED_VALUE",
      ranges: titles.map((t) => `${q(t)}!A1:V${monthTabs.includes(t) ? M_MAX + 20 : 1100}`) }));
    const data: Record<string, unknown[][]> = {};
    titles.forEach((t, i) => { data[t] = (res.data.valueRanges![i].values as unknown[][]) || []; });

    const flat: Record<string, Row[]> = {};
    for (const [tab, cols] of Object.entries(FLAT)) {
      flat[tab] = data[tab].slice(1).map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => r.some((c) => String(c ?? "").trim()))
        .map(({ r, row }) => ({ ...Object.fromEntries(cols.map((c, j) => [c, r[j] ?? ""])), row }));
    }

    const loans: Row[] = [], sched: Row[] = [];
    for (const t of loanTabs) {
      const rows = data[t];
      if (rows.length < META_ROW0 || !rows[META_ROW0 - 1] || String(rows[META_ROW0 - 1][0]) !== "Loan ID") continue; // not one of ours
      const meta: Row = {};
      META.forEach(([, key], i) => { const r = rows[META_ROW0 - 1 + i] || []; meta[key] = r.length > 1 ? r[1] : ""; });
      const hasSched = rows.length >= LOAN_HDR && String((rows[LOAN_HDR - 1] || [])[0] ?? "") === "Inst #";
      let paidN = 0;
      if (hasSched) {
        for (let off = 0; LOAN_HDR + off < rows.length; off++) {
          const r = rows[LOAN_HDR + off];
          if (!r || r.length === 0 || r[0] === "" || r[0] == null) break;
          const p = r.concat(Array(9).fill("")).slice(0, 9);
          const paid = String(p[7]) === "Paid";
          if (paid) paidN++;
          sched.push({ loan_id: meta.id, inst_no: Math.trunc(num(p[0])), due_date: p[1], opening: p[2], principal: p[3], interest: p[4], emi: p[5],
            closing: p[6], paid, paid_date: p[8], tab_paid: paid, tab: t, row: LOAN_HDR + 1 + off });
        }
      }
      loans.push({ ...meta, name: t, tab: t, gid: wss.get(t)!.id, paid_installments: paidN, has_schedule: hasSched });
    }
    const byName = Object.fromEntries(loans.map((l) => [l.name, l.id]));

    const items: Row[] = [], extras: Row[] = [], income: Row[] = [], kpis: Record<string, Kpi> = {};
    for (const t of monthTabs) {
      const mk = monthKey(parseMonthTitle(t)!);
      const rows = data[t];
      kpis[mk] = { tab: t, row4: rows[3] || [], row6: rows[5] || [] };
      for (let off = 0; M_ROW0 - 1 + off < rows.length; off++) {
        const r = (rows[M_ROW0 - 1 + off] || []).concat(Array(22).fill("")).slice(0, 22);
        const row = M_ROW0 + off;
        if (r[8] !== "") items.push({ month: mk, tab: t, row, loan: r[0], owner: r[1], due: r[2], label: r[3], amount: num(r[4]), principal: num(r[5]),
          paid: bool(r[6]), paid_on: r[7], ref: String(r[8]), paid_by: String(r[9]).trim() });
        if (r[10] !== "" && num(r[11]) > 0) extras.push({ month: mk, tab: t, row, loan: r[10], loan_id: byName[String(r[10])] ?? "", amount: num(r[11]), date: r[12],
          note: r[13], applied: bool(r[14]), result: r[15], paid_by: String(r[16]).trim() });
        if (r[17] !== "" && r[19] !== "") income.push({ person: r[17], source: r[18], type: r[21] || "fixed", amount: num(r[19]), month: mk, received: bool(r[20]),
          note: "", tab: t, row });
      }
    }
    for (const it of items) it.kind = baseRef(it.ref).startsWith("exp:") ? "expense" : "loan";

    // a tick in a month tab wins over the loan tab (sync() writes it back to the loan tab)
    const m: Record<string, boolean> = {};
    for (const r of items) { const b = baseRef(r.ref); m[b] = m[b] || !!r.paid; }
    for (const s of sched) {
      const mp = m[`${s.loan_id}|${s.inst_no}`];
      s.month_paid = mp === undefined ? null : mp;
      s.paid = s.month_paid === null ? s.tab_paid : s.month_paid;
    }

    const pay: Row[] = [];
    const types = Object.fromEntries(loans.map((l) => [l.id, l.type]));
    for (const it of items) {
      const lid = baseRef(it.ref).split("|")[0];
      if (it.paid && ["fixed_monthly", "interest_only", "interest_free_deadline", "bullet"].includes(types[lid])) {
        if (types[lid] === "bullet") pay.push({ date: it.due, loan_id: lid, amount: it.principal || it.amount, kind: it.principal ? "principal" : "interest", note: it.month });
        else pay.push({ date: it.due, loan_id: lid, amount: it.amount, kind: types[lid] === "interest_only" ? "interest" : "principal", note: it.month });
      }
    }
    for (const e of extras) if (e.applied && e.loan_id) pay.push({ date: e.date, loan_id: e.loan_id, amount: e.amount, kind: "extra", note: e.note });

    this.kpis = kpis;
    const tabs: Tabs = { Loans: loans, Schedule: sched, Payments: pay, Extras: extras, Income: income, MonthItems: items,
      Recurring: flat["Recurring Income"], Expenses: flat.Expenses, Goals: flat.Goals, Holdings: flat.Holdings, SavingsLog: flat["Savings Log"], Settings: flat.Settings };
    return { tabs, kpis };
  }

  // ------------------------------------------------------------ flat tabs
  async append(tab: string, rows: Row[]): Promise<void> {
    const cols = FLAT[tab];
    const data = rows.map((r) => cols.map((c) => r[c] ?? ""));
    if (data.length) await this.call(() => this.api.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${q(tab)}!A1`, valueInputOption: "RAW", requestBody: { values: data as never } }));
  }
  async updateFlat(tab: string, row: number, vals: Row): Promise<void> {
    const cols = FLAT[tab];
    await this.values([[`${q(tab)}!A${row}:${colLetter(cols.length - 1)}${row}`, [cols.map((c) => vals[c] ?? "")]]]);
  }
  updateExpense(row: number, vals: Row) { return this.updateFlat("Expenses", row, vals); }
  deleteExpense(row: number) { return this.deleteFlat("Expenses", row); }
  async deleteFlat(tab: string, row: number): Promise<void> {
    const w = await this.ws(tab);
    await this.batch([{ deleteDimension: { range: { sheetId: w.id, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }]);
  }
  async updateRow(tab: string, match: Row, values: Row): Promise<boolean> {
    const cols = FLAT[tab];
    const rows = (await this.getRange(`${q(tab)}!A:${colLetter(cols.length - 1)}`)).slice(1);
    for (let i = 0; i < rows.length; i++) {
      const rec = Object.fromEntries(cols.map((c, j) => [c, rows[i][j] ?? ""]));
      if (Object.entries(match).every(([k, v]) => String(rec[k] ?? "") === String(v))) {
        await this.values(Object.entries(values).map(([k, v]) => [`${q(tab)}!${colLetter(cols.indexOf(k))}${i + 2}`, [[v]]] as [string, unknown[][]]));
        return true;
      }
    }
    return false;
  }
  async setSetting(key: string, value: unknown): Promise<void> {
    if (!(await this.updateRow("Settings", { key }, { value }))) await this.append("Settings", [{ key, value }]);
  }

  // ------------------------------------------------------------ loan tabs
  async uniqueTitle(name: string): Promise<string> {
    let base = name.replace(/[[\]*?:/\\]/g, "-").trim().slice(0, 80) || "Loan";
    if (parseMonthTitle(base) || RESERVED.has(base)) base += " loan";
    const wss = await this.refreshWss();
    let title = base, n = 2;
    while (wss.has(title)) title = `${base} (${n++})`;
    return title;
  }

  /** Create the loan's own tab. `meta` uses the keys of META plus `name`. Returns the loan id. */
  async createLoanTab(meta: Row, schedule: L.ScheduleRow[] | null, paid = 0): Promise<string> {
    meta = { ...meta, id: meta.id || uid() };
    const title = await this.uniqueTitle(meta.name);
    const n = schedule ? schedule.length : 0;
    const w = await this.addSheet(title, Math.max(60, LOAN_HDR + n + 10), 10);
    const sid = w.id;
    const grid: unknown[][] = [[title], [], ...META.map(([label, key]) => [label, meta[key] ?? ""])];
    const data: [string, unknown[][]][] = [[`${q(title)}!A1`, grid]];
    const reqs: sheets_v4.Schema$Request[] = [this.widthReq(sid, 0, 1, 190), this.widthReq(sid, 1, 9, 120), this.widthReq(sid, 3, 4, 170),
      this.boldReq(sid, 0, 1, 0, 1, { size: 16, color: INDIGO }), this.boldReq(sid, META_ROW0 - 1, META_ROW0 - 1 + META.length, 0, 1),
      this.boldReq(sid, 2, 8, 3, 4), this.headerReq(sid, 1, 2, 3, 5)];
    data.push([`${q(title)}!D2`, [["Live status (updated by the app)", ""]]]);
    if (schedule) {
      const rows = schedule.map((r) => [r.inst_no, fmtDate(r.due_date), r.opening, r.principal, r.interest, r.emi, r.closing,
        r.inst_no <= paid ? "Paid" : "Due", r.inst_no <= paid ? fmtDate(r.due_date) : ""]);
      data.push([`${q(title)}!A${LOAN_HDR}`, [SCHED_COLS, ...rows]]);
      reqs.push(this.headerReq(sid, LOAN_HDR - 1, LOAN_HDR, 0, 9), this.numfmtReq(sid, LOAN_HDR, LOAN_HDR + n, 2, 7),
        { addConditionalFormatRule: { index: 0, rule: { ranges: [this.rng(sid, LOAN_HDR, LOAN_HDR + n + 5, 0, 9)],
          booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=$H${LOAN_HDR + 1}="Paid"` }] }, format: { backgroundColor: rgb(GREEN_BG) } } } } });
    }
    META.forEach(([, key], i) => { if (["principal", "emi", "outstanding"].includes(key)) reqs.push(this.numfmtReq(sid, META_ROW0 - 1 + i, META_ROW0 + i, 1, 2)); });
    await this.values(data);
    await this.batch(reqs);
    await this.refreshWss();
    await this.orderTabs();
    return meta.id;
  }

  /** Replace the schedule block. statuses: inst_no -> [status, paidOn]. */
  async writeSchedule(loanTab: string, schedule: L.ScheduleRow[], statuses: Record<number, [string, string]>): Promise<void> {
    const w = await this.ws(loanTab);
    await this.clear([`${q(loanTab)}!A${LOAN_HDR + 1}:I1100`]);
    const rows = schedule.map((r) => { const [st, on] = statuses[r.inst_no] || ["Due", ""];
      return [r.inst_no, fmtDate(r.due_date), r.opening, r.principal, r.interest, r.emi, r.closing, st, on]; });
    if (rows.length) {
      await this.values([[`${q(loanTab)}!A${LOAN_HDR + 1}`, rows]]);
      await this.batch([this.numfmtReq(w.id, LOAN_HDR, LOAN_HDR + rows.length, 2, 7)]);
    }
  }

  async renameLoan(loanTab: string, newName: string): Promise<string> {
    if (newName.trim() === loanTab) return loanTab;
    const title = await this.uniqueTitle(newName);
    const w = await this.ws(loanTab);
    await this.batch([{ updateSheetProperties: { properties: { sheetId: w.id, title }, fields: "title" } }]);
    await this.refreshWss();
    await this.values([[`${q(title)}!A1`, [[title]]]]);
    await this.orderTabs();
    return title;
  }

  async updateMeta(loanTab: string, values: Row): Promise<void> {
    const keys = META.map(([, k]) => k);
    await this.values(Object.entries(values).map(([k, v]) => [`${q(loanTab)}!B${META_ROW0 + keys.indexOf(k)}`, [[v]]] as [string, unknown[][]]));
  }

  async deleteLoan(loanId: string): Promise<void> {
    const { tabs } = await this.readAll();
    const row = tabs.Loans.find((l) => l.id === loanId);
    if (row) { const w = await this.ws(row.tab); await this.batch([{ deleteSheet: { sheetId: w.id } }]); await this.refreshWss(); }
    await this.sync();
  }

  /** Mark instalments 1..n paid, the rest unpaid (loan tab first, months follow in sync). */
  async setPaidThrough(loanId: string, n: number): Promise<void> {
    const { tabs } = await this.readAll();
    const s = tabs.Schedule.filter((x) => x.loan_id === loanId);
    if (!s.length) return;
    const tab = s[0].tab, t = fmtDate(today());
    const vals: [string, unknown[][]][] = [];
    for (const r of s) {
      const now = r.inst_no <= n;
      if (!!r.paid !== now) vals.push([`${q(tab)}!H${r.row}`, [[now ? "Paid" : "Due", now ? t : ""]]]);
    }
    await this.values(vals);
    await this.sync(undefined, new Set([loanId]));
  }

  // ------------------------------------------------------------ month tabs
  persons(tabs: Tabs): string[] {
    const s = Object.fromEntries(tabs.Settings.map((r) => [r.key, r.value]));
    return String(s.persons ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  }

  private async createMonth(md: ISODate, tabs: Tabs, persons: string[], loanNames: string[]): Promise<void> {
    const title = monthTitle(md);
    const w = await this.addSheet(title, M_MAX + 20, 22);
    const sid = w.id, r0 = M_ROW0, r1 = M_MAX;
    const incRows = tabs.Recurring.map((r) => [r.person, r.source, num(r.amount), false, "fixed"]);
    const labels1 = ["Income expected", "Income received", "Expenses", "EMIs due", "EMIs paid", "Extra payments", "Left now (received)", "Left if all income arrives"];
    const f1 = [`=SUM(T${r0}:T${r1})`, `=SUMIF(U${r0}:U${r1},TRUE,T${r0}:T${r1})`, expenseFormula(monthKey(md)), emiDueFormula(), emiPaidFormula(),
      `=SUM(L${r0}:L${r1})`, "=B4-C4-E4-F4", "=A4-C4-D4-F4"];
    const labels2 = ["Debt closed this month", "Still to pay this month", "Outstanding (all loans)", "Next month's EMIs", "Next month target: extra you can add", "Loans cleared"];
    const f2 = [`=SUMIF(G${r0}:G${r1},TRUE,F${r0}:F${r1})+SUM(L${r0}:L${r1})`, "=D4-E4"];
    const per = persons.slice(0, 4).map((p, i) => [p, `=SUMIF($R$${r0}:$R$${r1},R${4 + i},$T$${r0}:$T$${r1})`,
      `=SUMIFS($T$${r0}:$T$${r1},$R$${r0}:$R$${r1},R${4 + i},$U$${r0}:$U$${r1},TRUE)`]);
    const raw: [string, unknown[][]][] = [
      [`${q(title)}!A1`, [[monthLong(md)], ["Tick Paid when an EMI is paid. Add extra payments in the middle block and income on the right. Open the app to apply extra payments."]]],
      [`${q(title)}!A3`, [labels1]], [`${q(title)}!A5`, [labels2]],
      [`${q(title)}!A${M_HDR}`, [EMI_COLS]], [`${q(title)}!K${M_HDR}`, [EXTRA_COLS]], [`${q(title)}!R${M_HDR}`, [INC_COLS]],
      [`${q(title)}!R3`, [["Person", "Income expected", "Income received"]]]];
    if (incRows.length) raw.push([`${q(title)}!R${M_ROW0}`, incRows]);
    await this.values(raw);
    const forms: [string, unknown[][]][] = [[`${q(title)}!A4`, [f1]], [`${q(title)}!A6`, [f2]]];
    if (per.length) forms.push([`${q(title)}!R4`, per]);
    await this.values(forms, false);
    const widths = [170, 90, 100, 130, 100, 110, 70, 100, 20, 90, 170, 100, 100, 190, 70, 200, 90, 110, 150, 100, 80, 80];
    const reqs: sheets_v4.Schema$Request[] = widths.map((px, c) => this.widthReq(sid, c, c + 1, px));
    reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
      this.boldReq(sid, 0, 1, 0, 1, { size: 18, color: INDIGO }),
      this.headerReq(sid, 2, 3, 0, 8), this.headerReq(sid, 4, 5, 0, 6), this.headerReq(sid, 2, 3, 17, 20),
      this.headerReq(sid, M_HDR - 1, M_HDR, 0, 8), this.headerReq(sid, M_HDR - 1, M_HDR, 9, 10), this.headerReq(sid, M_HDR - 1, M_HDR, 10, 17), this.headerReq(sid, M_HDR - 1, M_HDR, 17, 22),
      this.numfmtReq(sid, 3, 4, 0, 8), this.numfmtReq(sid, 5, 6, 0, 5), this.numfmtReq(sid, 3, 7, 18, 20),
      this.numfmtReq(sid, M_ROW0 - 1, M_MAX, 4, 6), this.numfmtReq(sid, M_ROW0 - 1, M_MAX, 11, 12), this.numfmtReq(sid, M_ROW0 - 1, M_MAX, 19, 20),
      this.checkboxReq(sid, M_ROW0 - 1, M_MAX, 6), this.checkboxReq(sid, M_ROW0 - 1, M_MAX, 14), this.checkboxReq(sid, M_ROW0 - 1, M_MAX, 20),
      this.boldReq(sid, 3, 4, 0, 8, { size: 12 }), this.boldReq(sid, 5, 6, 0, 6, { size: 12 }),
      { addConditionalFormatRule: { index: 0, rule: { ranges: [this.rng(sid, M_ROW0 - 1, M_MAX, 0, 8)],
        booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=$G${M_ROW0}=TRUE` }] }, format: { backgroundColor: rgb(GREEN_BG) } } } } },
      this.carryFormatReq(sid), this.validationReq(sid, M_ROW0 - 1, M_MAX, 10, this.loanListRule(loanNames)));
    await this.batch(reqs);
  }

  // ------------------------------------------------------------ sync
  /**
   * Bring the workbook in line: create month tabs, reconcile paid ticks, rebuild each month's EMI list,
   * refresh live stats and the Summary. Returns the (re-read) snapshot and whether loan/month data was rewritten.
   */
  async sync(snap?: Snapshot, force: Set<string> = new Set()): Promise<{ snap: Snapshot; wrote: boolean }> {
    snap = snap || (await this.readAll());
    let tabs = snap.tabs;
    let wrote = false;
    const reread = async () => { snap = await this.readAll(); tabs = snap.tabs; return new State(tabs); };
    let st = new State(tabs);
    const persons = this.persons(tabs), loanNames = tabs.Loans.map((l) => String(l.name)).sort();
    const t0 = today(), cur = firstOfMonth(t0);

    // 1. month tabs for this and next month
    let created = false;
    for (const md of [cur, nextMonth(cur)]) {
      if (!(monthKey(md) in this.kpis)) { await this.createMonth(md, tabs, persons, loanNames); created = wrote = true; }
    }
    if (created) { await this.refreshWss(); await this.orderTabs(); st = await reread(); }

    // 2. reconcile paid ticks between loan tabs and month tabs
    const loanFix: [string, unknown[][]][] = [], monthFix: [string, unknown[][]][] = [];
    for (const r of tabs.Schedule) {
      if (r.month_paid === null || r.month_paid === undefined || !!r.month_paid === !!r.tab_paid) continue;
      if (force.has(r.loan_id)) { // an explicit action in the app/loan tab: push to the month tab
        const item = tabs.MonthItems.find((i) => i.ref === `${r.loan_id}|${r.inst_no}`)!;
        monthFix.push([`${q(item.tab)}!G${item.row}`, [[!!r.tab_paid]]], [`${q(item.tab)}!H${item.row}`, [[r.tab_paid ? fmtDate(t0) : ""]]]);
      } else { // the user ticked in the month tab: pull into the loan tab
        loanFix.push([`${q(r.tab)}!H${r.row}`, [[r.month_paid ? "Paid" : "Due", r.month_paid ? fmtDate(t0) : ""]]]);
      }
    }
    if (monthFix.length || loanFix.length) { await this.values([...monthFix, ...loanFix]); wrote = true; st = await reread(); }

    // 2b. every expense needs a stable id so its monthly Paid tick can be tracked
    const blank = tabs.Expenses.filter((e) => !String(e.id).trim());
    if (blank.length) { await this.values(blank.map((r) => [`Expenses!G${r.row}`, [[uid()]]] as [string, unknown[][]])); wrote = true; st = await reread(); }

    // 3. rebuild the EMI list of this and future months when what is due changed
    for (const mk of Object.keys(this.kpis).sort()) {
      if (keyToDate(mk) < cur) continue;
      const want = this.expectedItems(st, mk);
      if (mk === monthKey(cur)) want.push(...this.carryItems(st, tabs, mk));
      const have = tabs.MonthItems.filter((i) => i.month === mk);
      const haveMap = new Map(have.map((r) => [String(r.ref), r]));
      for (const w of want) { // a payment you ticked keeps what was paid, even if the balance has moved on since
        const h = haveMap.get(w.ref);
        if (h && h.paid) Object.assign(w, { amount: h.amount, principal: h.principal, label: h.label, due: h.due });
      }
      // a ticked payment must not vanish just because it cleared the loan (that would undo the tick)
      const valid = new Set([...tabs.Loans.map((l) => l.id), ...tabs.Expenses.map((e) => `exp:${e.id}`)]);
      const wantRefs = new Set(want.map((w) => w.ref));
      for (const h of have) {
        if (h.paid && !wantRefs.has(h.ref) && valid.has(baseRef(h.ref).split("|")[0])) {
          want.push({ ref: h.ref, loan: h.loan, owner: h.owner, due: h.due, label: h.label, amount: h.amount, principal: h.principal,
            when: parseDate(h.due) || keyToDate(mk), paid: true, paid_on: h.paid_on });
        }
      }
      want.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.loan < b.loan ? -1 : a.loan > b.loan ? 1 : 0));
      const sig = (xs: Row[]) => JSON.stringify(xs.map((x) => [x.ref, r2(num(x.amount)), x.loan, x.owner]));
      if (sig(want) !== sig(have)) {
        await this.writeItems(this.kpis[mk].tab, want, new Map(have.map((r) => [String(r.ref), [r.paid, r.paid_on, r.paid_by] as unknown[]])), loanNames);
        wrote = true;
      }
    }
    if (wrote) st = await reread();

    // 4. live stats, current-month planning cells and Summary (skipped when nothing changed)
    await this.ensureCarryFormat(tabs);
    await this.ensurePaidByColumns(tabs);
    await this.refreshViews(st, tabs);
    return { snap: snap!, wrote };
  }

  private expectedItems(st: State, mk: string): Row[] {
    const out: Row[] = [], md = keyToDate(mk);
    for (const l of st.loans) {
      if (l.status === "closed") continue;
      const lid = l.id, kind = l.type, sch = st.schedule(lid);
      if (sch.length) {
        for (const r of sch) {
          const d = parseDate(r.due_date);
          if (d && monthKey(d) === mk) out.push({ ref: `${lid}|${Math.trunc(r.inst_no)}`, loan: l.name, owner: l.owner, due: fmtDate(d), label: `EMI #${Math.trunc(r.inst_no)}`,
            amount: num(r.emi), principal: num(r.principal), when: d, paid: bool(r.paid), paid_on: r.paid_date });
        }
        continue;
      }
      const bal = st.outstanding(l);
      if (bal <= 0.005) continue;
      const first = parseDate(l.first_due_date);
      if ((kind === "fixed_monthly" || kind === "interest_only") && first && md < firstOfMonth(first)) continue; // payments start from the chosen month
      const day = Math.min(first ? Number(first.slice(8)) : 1, 28);
      const due = `${mk}-${String(day).padStart(2, "0")}`;
      if (kind === "fixed_monthly") {
        const amt = Math.min(num(l.emi), bal);
        out.push({ ref: `${lid}|${mk}`, loan: l.name, owner: l.owner, due: fmtDate(due), label: "Monthly payment", amount: amt, principal: amt, when: due });
      } else if (kind === "interest_only") {
        out.push({ ref: `${lid}|${mk}`, loan: l.name, owner: l.owner, due: fmtDate(due), label: "Interest only", amount: r2((bal * num(l.rate_pa)) / 1200), principal: 0, when: due });
      } else if (kind === "bullet") {
        const dl = parseDate(l.deadline);
        if (dl) for (const [label, d, amt, prin] of L.bulletMonthItems(bal, num(l.rate_pa), md, dl)) {
          out.push({ ref: `${lid}|${mk}` + (prin ? "|P" : ""), loan: l.name, owner: l.owner, due: fmtDate(d), label, amount: amt, principal: prin, when: d });
        }
      } else if (kind === "interest_free_deadline") {
        const dl = parseDate(l.deadline);
        if (dl && monthKey(dl) === mk) out.push({ ref: `${lid}|${mk}`, loan: l.name, owner: l.owner, due: fmtDate(dl), label: "Deadline: pay in full", amount: bal, principal: bal, when: dl });
      }
    }
    for (const r of st.expensesFor(mk)) {
      const eid = String(r.id).trim();
      if (!eid) continue; // gets an id on the next sync pass
      const d = `${mk}-${String(Math.min(Math.max(Math.trunc(num(r.day)) || 1, 1), 28)).padStart(2, "0")}`;
      out.push({ ref: `exp:${eid}|${mk}`, loan: r.name, owner: r.owner, due: fmtDate(d), label: r.category || "Expense", amount: num(r.amount), principal: 0, when: d });
    }
    return out.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.loan < b.loan ? -1 : a.loan > b.loan ? 1 : 0));
  }

  /** Unpaid items from earlier months, shown in the current month (red) until they are paid. */
  private carryItems(st: State, tabs: Tabs, mk: string): Row[] {
    const first = keyToDate(mk), items = tabs.MonthItems;
    const settled = new Set(items.filter((r) => r.paid).map((r) => baseRef(r.ref)));
    const out: Row[] = [], scheduled = new Set<string>();
    for (const l of st.loans) {
      if (l.status === "closed") continue;
      const sch = st.schedule(l.id);
      if (!sch.length) continue;
      scheduled.add(l.id);
      for (const r of sch) {
        const d = parseDate(r.due_date);
        if (bool(r.paid) || !d || d >= first) continue;
        const n = Math.trunc(r.inst_no);
        out.push({ ref: `carry:${l.id}|${n}`, loan: l.name, owner: l.owner, due: fmtDate(d), label: `EMI #${n} - carried from ${monthTitle(d)}`,
          amount: num(r.emi), principal: num(r.principal), when: d });
      }
    }
    const live = new Set(st.loans.filter((l) => l.status !== "closed" && !scheduled.has(l.id) && st.outstanding(l) > 0.005).map((l) => l.id));
    const expIds = new Set(tabs.Expenses.filter((x) => String(x.id).trim()).map((x) => `exp:${x.id}`));
    for (const r of items) {
      const ref = String(r.ref);
      if (r.month >= mk || r.paid || ref.startsWith("carry:") || settled.has(ref)) continue;
      const head = ref.split("|")[0];
      if (!live.has(head) && !expIds.has(head)) continue;
      out.push({ ref: `carry:${ref}`, loan: r.loan, owner: r.owner, due: r.due, label: `${r.label} - carried from ${monthTitle(keyToDate(r.month))}`,
        amount: r.amount, principal: r.principal, when: parseDate(r.due) || first });
    }
    return out;
  }

  private async writeItems(tab: string, items: Row[], prior: Map<string, unknown[]>, loanNames: string[]): Promise<void> {
    const w = await this.ws(tab);
    await this.clear([`${q(tab)}!A${M_ROW0}:J${M_MAX}`]);
    const rows = items.map((i) => { // a tick already in the month tab wins; otherwise start from the loan tab's status
      const p = prior.get(i.ref) ?? [i.paid ?? false, i.paid_on ?? "", i.paid_by ?? ""];
      return [i.loan, i.owner, i.due, i.label, i.amount, i.principal, p[0], p[1], i.ref, p[2] ?? ""];
    });
    if (rows.length) await this.values([[`${q(tab)}!A${M_ROW0}`, rows]]);
    await this.batch([this.validationReq(w.id, M_ROW0 - 1, M_MAX, 10, this.loanListRule(loanNames))]);
  }

  private async ensureCarryFormat(tabs: Tabs): Promise<void> {
    if ((await this.flag(tabs, "_carryfmt")) === "1") return;
    const meta = await this.call(() => this.api.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets(properties(sheetId,title),conditionalFormats)" }));
    const reqs: sheets_v4.Schema$Request[] = [];
    for (const sh of meta.data.sheets || []) {
      if (!parseMonthTitle(sh.properties!.title!)) continue;
      const has = (sh.conditionalFormats || []).some((c) => JSON.stringify(c.booleanRule?.condition?.values || []).includes("LEFT($I"));
      if (!has) reqs.push(this.carryFormatReq(sh.properties!.sheetId!));
    }
    await this.batch(reqs);
    await this.setFlag("_carryfmt", "1");
  }

  /** Older month tabs get the 'Paid by' columns (J for payments, Q for extra payments). */
  private async ensurePaidByColumns(tabs: Tabs): Promise<void> {
    if ((await this.flag(tabs, "_paidby")) === "1") return;
    const data: [string, unknown[][]][] = [], reqs: sheets_v4.Schema$Request[] = [];
    for (const k of Object.values(this.kpis)) {
      const w = await this.ws(k.tab);
      data.push([`${q(k.tab)}!J${M_HDR}`, [["Paid by"]]], [`${q(k.tab)}!Q${M_HDR}`, [["Paid by"]]]);
      reqs.push(this.widthReq(w.id, 9, 10, 90), this.widthReq(w.id, 16, 17, 90),
        this.headerReq(w.id, M_HDR - 1, M_HDR, 9, 10), this.headerReq(w.id, M_HDR - 1, M_HDR, 16, 17));
    }
    await this.values(data);
    await this.batch(reqs);
    await this.setFlag("_paidby", "1");
  }

  private async refreshViews(st: State, tabs: Tabs): Promise<void> {
    const t0 = today(), cur = firstOfMonth(t0), mk = monthKey(t0);
    const loans = st.loans;
    const summary: unknown[][] = [], loanWrites: [string, unknown[][]][] = [];
    for (const l of [...loans].sort((a, b) => st.outstanding(b) - st.outstanding(a))) {
      const out = st.outstanding(l);
      const [nd, namt] = st.nextDue(l);
      const total = num(l.tenure_months), paidN = st.paidCount(l.id);
      const pr = num(l.principal) || out;
      const pct = pr ? Math.max(0, Math.min(1, 1 - out / pr)) : 0;
      const sch = st.schedule(l.id);
      const end = sch.length ? fmtDate(parseDate(sch[sch.length - 1].due_date)) : fmtDate(parseDate(l.deadline));
      const ptxt = total ? `${paidN} / ${Math.trunc(total)}` : "-";
      loanWrites.push([`${q(l.tab)}!D3`, [["Paid instalments", ptxt], ["Outstanding", out], ["Next due", fmtDate(nd)], ["Next amount", namt],
        ["% repaid", L.round(pct, 4)], ["Last instalment / deadline", end]]]);
      summary.push([`=HYPERLINK("#gid=${l.gid}","${String(l.name).replace(/"/g, '""')}")`, l.lender, l.owner, l.type, num(l.principal), num(l.rate_pa), st.monthlyDue(l),
        ptxt, out, L.round(pct, 4), fmtDate(nd), namt, out <= 0.005 ? "closed" : "active"]);
    }
    const monthWrites: [string, unknown[][]][] = [];
    const totalOut = loans.reduce((s, l) => s + st.outstanding(l), 0);
    if (mk in this.kpis) {
      const nxt = this.expectedItems(st, monthKey(nextMonth(cur))).filter((i) => !String(i.ref).startsWith("exp:")).reduce((s, i) => s + i.amount, 0);
      const income = tabs.Recurring.reduce((s, r) => s + num(r.amount), 0);
      const target = Math.max(income - st.expensesTotal() - nxt - num(st.settings.emergency_buffer), 0);
      const cleared = loans.filter((l) => st.outstanding(l) <= 0.005).length;
      monthWrites.push([`${q(this.kpis[mk].tab)}!C6`, [[Math.round(totalOut), Math.round(nxt), Math.round(target), cleared]]]);
    }
    const sig = createHash("sha1").update(JSON.stringify([loanWrites, monthWrites, summary, Object.keys(this.kpis).sort(),
      Object.values(this.kpis).map((k) => k.row4), tabs.Expenses])).digest("hex");
    if ((await this.flag(tabs, "_views_sig")) === sig) return;
    await this.values([...loanWrites, ...monthWrites]);
    await this.values(Object.entries(this.kpis).map(([m, k]) => [`${q(k.tab)}!C4:E4`, [[expenseFormula(m), emiDueFormula(), emiPaidFormula()]]] as [string, unknown[][]]), false);
    await this.writeSummary(summary, totalOut);
    await this.setFlag("_views_sig", sig);
  }

  private async writeSummary(rows: unknown[][], totalOut: number): Promise<void> {
    const w = await this.ws("Summary");
    await this.clear(["Summary!A1:N200"]);
    const hdr = ["Loan", "Lender", "Owner", "Type", "Original", "Rate %", "Monthly due", "Paid / total", "Outstanding", "% repaid", "Next due", "Next amount", "Status"];
    const totalDue = rows.filter((r) => r[12] === "active").reduce((s, r) => s + Number(r[6]), 0);
    const n = rows.length;
    const grid: unknown[][] = [["EL Smart Tracker - Summary"], [`Updated ${fmtDate(today())} (open the app to refresh)`], [], hdr, ...rows,
      ["TOTAL", "", "", "", "", "", totalDue, "", totalOut]];
    const monthHdr = ["Month", "Income expected", "Income received", "Expenses", "EMIs due", "EMIs paid", "Extra payments", "Left (received)", "Left (if all income)", "Debt closed", "Outstanding at update"];
    const mrows: unknown[][] = [];
    for (const mk of Object.keys(this.kpis).sort().reverse()) {
      const k = this.kpis[mk];
      const r4 = [...k.row4, ...Array(8).fill("")].slice(0, 8), r6 = [...k.row6, ...Array(6).fill("")].slice(0, 6);
      mrows.push([`=HYPERLINK("#gid=${(await this.ws(k.tab)).id}","${k.tab}")`, ...r4.slice(0, 8), r6[0], r6[2]]);
    }
    const titleRow = grid.length + 2;
    grid.push([], [], ["Month by month"], monthHdr, ...mrows);
    const mhdrRow = titleRow + 1;
    await this.values([["Summary!A1", grid]], false);
    const sid = w.id;
    await this.batch([
      this.boldReq(sid, 0, 1, 0, 1, { size: 18, color: INDIGO }),
      this.headerReq(sid, 3, 4, 0, 13), this.headerReq(sid, mhdrRow, mhdrRow + 1, 0, 11),
      this.numfmtReq(sid, 4, 5 + n, 4, 5), this.numfmtReq(sid, 4, 5 + n, 6, 7), this.numfmtReq(sid, 4, 5 + n, 8, 9), this.numfmtReq(sid, 4, 5 + n, 11, 12),
      this.numfmtReq(sid, 4, 4 + n, 9, 10, "0%"), this.numfmtReq(sid, 4, 4 + n, 5, 6, "0.00"), this.numfmtReq(sid, mhdrRow + 1, mhdrRow + 1 + mrows.length, 1, 11),
      this.boldReq(sid, 4 + n, 5 + n, 0, 13, { bg: AMBER_BG }), this.boldReq(sid, titleRow, titleRow + 1, 0, 1, { size: 13 }),
      this.widthReq(sid, 0, 1, 190), this.widthReq(sid, 1, 13, 115)]);
  }

  // ------------------------------------------------------------ extras & income writes
  /** Create the month's tab (with its EMI list, recurring income and formulas) if it doesn't exist. */
  async ensureMonth(md: ISODate): Promise<string> {
    const title = monthTitle(md), key = monthKey(md);
    const { tabs } = await this.readAll();
    if (key in this.kpis) return title;
    const names = tabs.Loans.map((l) => String(l.name)).sort();
    await this.createMonth(md, tabs, this.persons(tabs), names);
    await this.refreshWss();
    await this.orderTabs();
    this.kpis[key] = { tab: title, row4: [], row6: [] };
    const st = new State(tabs);
    let items = this.expectedItems(st, key);
    if (md < firstOfMonth(today())) {
      // A past month you open has no tracked history for monthly/interest/expense items: only EMI schedule rows
      // are generated, otherwise they'd show as unpaid and wrongly carry forward as overdue.
      items = items.filter((i) => { const p = String(i.ref).split("|"); return p.length > 1 && /^\d+$/.test(p[1]); });
    }
    await this.writeItems(title, items, new Map(), names);
    return title;
  }

  private async nextFreeRow(tab: string, col: string): Promise<number> {
    const vals = await this.getRange(`${q(tab)}!${col}${M_ROW0}:${col}${M_MAX}`);
    let last = 0;
    vals.forEach((r, i) => { if (r && r.length && String(r[0]).trim() !== "") last = i + 1; });
    return M_ROW0 + last;
  }

  async appendExtra(md: ISODate, loanName: string, amount: number, note = "", applied = true, result = "", paidBy = ""): Promise<void> {
    const tab = await this.ensureMonth(md);
    const row = await this.nextFreeRow(tab, "K");
    await this.values([[`${q(tab)}!K${row}`, [[loanName, amount, fmtDate(today()), note]]], [`${q(tab)}!O${row}`, [[applied, result, paidBy]]]]);
  }

  async markExtraApplied(tab: string, row: number, result: string): Promise<void> {
    await this.values([[`${q(tab)}!M${row}`, [[fmtDate(today())]]], [`${q(tab)}!O${row}`, [[true, result]]]]);
  }

  async addIncome(md: ISODate, person: string, source: string, amount: number, typ: string, received: boolean): Promise<void> {
    const tab = await this.ensureMonth(md);
    const row = await this.nextFreeRow(tab, "R");
    await this.values([[`${q(tab)}!R${row}`, [[person, source, amount, received, typ]]]]);
  }

  async addRecurring(person: string, source: string, amount: number, also?: ISODate): Promise<void> {
    await this.append("Recurring Income", [{ person, source, amount }]);
    const cur = firstOfMonth(today());
    for (const md of new Set([cur, nextMonth(cur), ...(also ? [firstOfMonth(also)] : [])])) await this.addIncome(md, person, source, amount, "fixed", false);
  }

  /** Tick/untick a row in a month tab (and optionally record the amount actually paid), then sync(). */
  async setItemPaid(tab: string, row: number, paid: boolean, amount?: number | null, paidBy?: string | null): Promise<void> {
    const vals: [string, unknown[][]][] = [[`${q(tab)}!G${row}`, [[paid]]], [`${q(tab)}!H${row}`, [[paid ? fmtDate(today()) : ""]]]];
    if (amount != null) vals.push([`${q(tab)}!E${row}`, [[amount]]]);
    if (paidBy != null || !paid) vals.push([`${q(tab)}!J${row}`, [[paid ? paidBy || "" : ""]]]);
    await this.values(vals);
    await this.sync();
  }

  /** Tick several EMI rows (tab, row) at once, then sync once. */
  async setItemsPaid(rows: [string, number][], paid = true, paidBy = ""): Promise<void> {
    const on = paid ? fmtDate(today()) : "";
    await this.values(rows.flatMap(([tab, row]) => [[`${q(tab)}!G${row}`, [[paid]]], [`${q(tab)}!H${row}`, [[on]]], [`${q(tab)}!J${row}`, [[paid ? paidBy : ""]]]] as [string, unknown[][]][]));
    await this.sync();
  }

  async setIncomeReceived(tab: string, row: number, value: boolean): Promise<void> {
    await this.values([[`${q(tab)}!U${row}`, [[value]]]]);
  }
}

export { truthy };
