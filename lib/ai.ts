/** the AI as the advisor (server only). Code computes the numbers; the AI explains and prioritises. */
import "server-only";
import { complete } from "./llm";
import { today, fmtDate, monthLong } from "./dates";
import { lumpSumAnalysis, parseAmount, structure } from "./advice";
import { compareStrategies, monthlyBandwidth } from "./planner";
import { State, num } from "./state";

export const SYSTEM =
  "You are a sharp, practical personal-finance advisor for an Indian household (amounts in INR, ₹). " +
  "Use ONLY the numbers in the JSON facts (and simple sums/differences of them); never invent figures, rates or dates. " +
  "When asked where to put money (prepay, save, clear), do NOT just rank by interest rate. Think it through like an advisor and use lump_sum_analysis when present: " +
  "(1) compare the options by net_saving, months_saved and debt-free date, and say plainly which wins and by how much; " +
  "(2) explain WHY, in terms of each loan's structure, and keep the two lenses separate and clearly labelled: " +
  "standalone_if_all_goes_here.interest_saved_over_loan_life is a nominal total spread over the loan's remaining life, so a 29-year home loan always shows a big number, but it is the SAME yearly return as its rate " +
  "(interest_saved_next_12_months and effective_return_pa make loans comparable), whereas household_net_saving_if_all_here is the whole-household result with freed EMIs rolled on. " +
  "Explain the paradox plainly when it appears (big total on the long loan, higher yearly return on the short expensive loan), say which effect decides it here, and say whether the household result depends on the assumed monthly spare. " +
  "Never present a standalone life-of-loan figure and a household figure side by side as if they were the same thing; " +
  "(3) check each candidate's caveats: card/flat-rate EMIs and gold loans may carry foreclosure or closure charges and save less than the rate implies, interest-free loans save nothing, " +
  "floating-rate home loans usually have no prepayment charge; use prepay_charge_pct and the note given; " +
  "(4) keep the emergency buffer and this month's dues safe, never advise spending more than the user has, and mention any pending dues or goals that compete for the cash; " +
  "(5) mention tax angles (e.g. home-loan interest/principal deductions) only as something to check, without quoting numbers that are not in the facts; " +
  "(6) end with one clear recommendation: exact amounts per loan, and what to do next with freed EMIs. " +
  "If the best option is close to the next one, say so and give the tie-breaker. Be concise, specific and honest about assumptions.";

export const MONTHLY_PLAN_Q =
  "Give me this month's plan: (1) can I afford extra toward debt, and how much, (2) exactly which loan should get it and why, " +
  "(3) anything due soon or risky, (4) how the debt-free date changes. Keep it under 200 words.";

export const VISUAL_SYSTEM = SYSTEM +
  " Answer VISUALLY and briefly. Reply with ONLY one JSON object, no prose, in this shape: " +
  '{"headline": str (max 16 words, the answer itself), "bullets": [str, ...] (3-6 items, max 28 words each, the first one is the clear recommendation), ' +
  '"charts": [{"type": "bar"|"line"|"pie", "title": str, "labels": [str, ...], "series": [{"name": str, "values": [number, ...]}]}] (0-2 charts), ' +
  '"actions": [str, ...] (0-3 short concrete next steps)}. ' +
  "Charts must use only numbers from FACTS (or simple sums/differences of them), plain rupees, same length for labels and values. " +
  "Prefer a pie/bar for 'where does money go / which loan' and a line for 'over time'. No markdown inside strings.";

export function buildContext(state: State, question = "") {
  const debts = state.debts();
  const dues = debts.reduce((s, d) => s + d.min_payment, 0);
  const bw = monthlyBandwidth(state.incomeThisMonth(), state.expensesTotal(), dues, num(state.settings.emergency_buffer));
  const loans = state.activeLoans().map((r) => {
    const [due] = state.nextDue(r);
    return { name: r.name, lender: r.lender, owner: r.owner, type: r.type, outstanding: Math.round(state.outstanding(r)), rate_pa: num(r.rate_pa),
      monthly_due: Math.round(state.monthlyDue(r)), next_due: due, deadline: r.deadline || null, rate_type: r.rate_type, structure: structure(r).kind, interest_still_to_pay: state.payoff(r).interest == null ? null : Math.round(state.payoff(r).interest!),
      total_still_to_pay: state.payoff(r).total == null ? null : Math.round(state.payoff(r).total!), ends: state.payoff(r).end,
      prepay_charge_pct: num(r.prepay_charge_pct), instalments_paid: state.paidCount(r.id), instalments_total: num(r.tenure_months) || null };
  });
  const comp = debts.length ? compareStrategies(debts, bw.spare).map((c) => ({ strategy: c.strategy, months: c.months, total_interest: Math.round(c.total_interest),
    total_balance_every_6_months: c.timeline.filter((_, i) => i % 6 === 0), debt_free: c.debt_free_date })) : [];
  const amount = parseAmount(question) ?? (bw.spare >= 1000 ? Math.round(bw.spare) : null);
  const goals = state.goals().map((g) => ({ name: g.name, target: g.target, saved: Math.round(g.saved_total), share_pct: g.percent }));
  const ctx: Record<string, unknown> = { today: fmtDate(today()), month: monthLong(today()), bandwidth: bw, loans, extra_per_month_used: Math.round(bw.spare),
    strategy_comparison: comp, goals, loan_structures: Object.fromEntries(state.activeLoans().map((l) => [l.name, structure(l).kind])) };
  if (amount && debts.length) ctx.lump_sum_analysis = lumpSumAnalysis(state, amount);
  return ctx;
}

export async function ask(facts: unknown, question: string, system = SYSTEM): Promise<string> {
  return complete(`${system}\n\nFACTS (JSON):\n${JSON.stringify(facts)}\n\nQUESTION:\n${question}`);
}

export interface VisualAnswer {
  headline?: string; bullets?: string[]; actions?: string[]; text?: string;
  charts?: { type: "bar" | "line" | "pie"; title?: string; labels: string[]; series: { name?: string; values: number[] }[] }[];
}

/** Ask for a structured, chart-friendly answer. Falls back to {text} if it isn't valid JSON. */
export async function askVisual(state: State, question: string): Promise<VisualAnswer> {
  const raw = await ask(buildContext(state, question), question || MONTHLY_PLAN_Q, VISUAL_SYSTEM);
  return parseJsonObject<VisualAnswer>(raw, (d) => !!(d.bullets || d.charts || d.headline)) ?? { text: raw };
}

export function parseJsonObject<T>(raw: string, ok: (d: T) => boolean): T | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try { const d = JSON.parse(m[0]); return d && typeof d === "object" && ok(d) ? d : null; } catch { return null; }
}
