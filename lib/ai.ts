/** the AI as the advisor (server only). Code computes the numbers; the AI explains and prioritises. */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { today, fmtDate, monthLong } from "./dates";
import { compareStrategies, monthlyBandwidth } from "./planner";
import { State, num } from "./state";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Add it in your Vercel project's environment variables.");
  return (client ||= new Anthropic());
}

export const SYSTEM =
  "You are a calm, practical personal-finance coach for an Indian household (amounts in INR, ₹). " +
  "Use ONLY the JSON facts provided; never invent numbers. Be concise, use short bullet points, " +
  "name specific loans and rupee amounts, and prefer plans that clear debt sooner without " +
  "leaving the household short on cash. Home-loan part-prepayments reduce principal; " +
  "prefer keeping the EMI and shortening tenure unless told otherwise.";

export const MONTHLY_PLAN_Q =
  "Give me this month's plan: (1) can I afford extra toward debt, and how much, (2) exactly which loan should get it and why, " +
  "(3) anything due soon or risky, (4) how the debt-free date changes. Keep it under 200 words.";

export const VISUAL_SYSTEM = SYSTEM +
  " Answer VISUALLY and briefly. Reply with ONLY one JSON object, no prose, in this shape: " +
  '{"headline": str (max 12 words), "bullets": [str, ...] (2-5 items, max 15 words each), ' +
  '"charts": [{"type": "bar"|"line"|"pie", "title": str, "labels": [str, ...], "series": [{"name": str, "values": [number, ...]}]}] (0-2 charts), ' +
  '"actions": [str, ...] (0-3 short next steps)}. ' +
  "Charts must use only numbers from FACTS (or simple sums/differences of them), plain rupees, same length for labels and values. " +
  "Prefer a pie/bar for 'where does money go / which loan' and a line for 'over time'. No markdown inside strings.";

export function buildContext(state: State) {
  const debts = state.debts();
  const dues = debts.reduce((s, d) => s + d.min_payment, 0);
  const bw = monthlyBandwidth(state.incomeThisMonth(), state.expensesTotal(), dues, num(state.settings.emergency_buffer));
  const loans = state.activeLoans().map((r) => {
    const [due] = state.nextDue(r);
    return { name: r.name, lender: r.lender, owner: r.owner, type: r.type, outstanding: Math.round(state.outstanding(r)), rate_pa: num(r.rate_pa),
      monthly_due: Math.round(state.monthlyDue(r)), next_due: due, deadline: r.deadline || null, rate_type: r.rate_type,
      prepay_charge_pct: num(r.prepay_charge_pct), instalments_paid: state.paidCount(r.id), instalments_total: num(r.tenure_months) || null };
  });
  const comp = debts.length ? compareStrategies(debts, bw.spare).map((c) => ({ strategy: c.strategy, months: c.months, total_interest: Math.round(c.total_interest),
    total_balance_every_6_months: c.timeline.filter((_, i) => i % 6 === 0), debt_free: c.debt_free_date })) : [];
  return { today: fmtDate(today()), month: monthLong(today()), bandwidth: bw, loans, extra_per_month_used: Math.round(bw.spare), strategy_comparison: comp };
}

export async function ask(facts: unknown, question: string, system = SYSTEM, maxTokens = 2000): Promise<string> {
  const msg = await anthropic().messages.create({
    model: MODEL, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: `FACTS (JSON):\n${JSON.stringify(facts)}\n\nQUESTION:\n${question}` }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

export interface VisualAnswer {
  headline?: string; bullets?: string[]; actions?: string[]; text?: string;
  charts?: { type: "bar" | "line" | "pie"; title?: string; labels: string[]; series: { name?: string; values: number[] }[] }[];
}

/** Ask for a structured, chart-friendly answer. Falls back to {text} if it isn't valid JSON. */
export async function askVisual(state: State, question: string): Promise<VisualAnswer> {
  const raw = await ask(buildContext(state), question || MONTHLY_PLAN_Q, VISUAL_SYSTEM);
  return parseJsonObject<VisualAnswer>(raw, (d) => !!(d.bullets || d.charts || d.headline)) ?? { text: raw };
}

export function parseJsonObject<T>(raw: string, ok: (d: T) => boolean): T | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try { const d = JSON.parse(m[0]); return d && typeof d === "object" && ok(d) ? d : null; } catch { return null; }
}
