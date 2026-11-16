/** Deterministic "where should this money go" maths. The AI explains these numbers; it does not invent them. Pure: no server-only imports. */
import { ISODate } from "./dates";
import * as L from "./loans";
import { Debt, monthlyBandwidth, simulate } from "./planner";
import { Row, State, num } from "./state";

/** Pull a rupee amount out of free text: "50k", "50,000", "1.5 lakh", "₹2 lac". */
export function parseAmount(text: string): number | null {
  const re = /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] || "").toLowerCase();
    const v = n * (unit === "k" || unit === "thousand" ? 1e3 : /^(lakh|lac|l)/.test(unit) ? 1e5 : /^(cr)/.test(unit) ? 1e7 : 1);
    if (v >= 1000) return Math.round(v);
  }
  return null;
}

/** How a loan really works, since that decides whether (and how much) prepaying saves. */
export function structure(l: Row): { kind: string; note: string } {
  const card = /credit card/i.test(String(l.lender));
  switch (l.type) {
    case "bank_emi":
      return card
        ? { kind: "card EMI", note: "Card EMI conversions are often flat-rate: interest may be pre-computed, so closing early saves less than the rate suggests, and banks usually charge a foreclosure fee. Check the foreclosure terms before paying extra." }
        : { kind: "reducing-balance EMI", note: "Interest is charged on the outstanding balance, so every rupee prepaid cuts interest for the rest of the loan. Early years of a long loan are mostly interest." };
    case "bullet": return { kind: "gold loan (interest monthly, principal at the end)", note: "Interest runs on the principal until it is repaid; a part-payment cuts interest from that day. Confirm the bank accepts part-payments before the due date and any renewal/closure charges." };
    case "interest_only": return { kind: "interest-only", note: "Each ₹1 of principal repaid saves its interest every month for as long as the loan would have stayed open. There is no end date, so this loan never ends by itself." };
    case "interest_free_deadline": return { kind: "interest-free with a deadline", note: "No interest, so paying early saves no money. It only matters for meeting the deadline and for goodwill." };
    case "fixed_monthly": return { kind: "fixed monthly to a person", note: "Usually interest-free; paying early saves no interest. It is a relationship/priority call." };
    default: return { kind: "interest-free, flexible", note: "No interest and no deadline, so prepaying saves no money." };
  }
}

function remainingMonths(state: State, l: Row): number | null {
  const sch = state.schedule(l.id).filter((r) => !(String(r.paid).toUpperCase() === "TRUE" || r.paid === true));
  return sch.length ? sch.length : null;
}

export interface LumpOption {
  label: string;
  allocations: { loan: string; amount: number }[];
  interest_saved: number; charges: number; net_saving: number;
  months_saved: number; debt_free: ISODate | null; total_interest_after: number;
  emi_freed_per_month: number;
}

export interface LumpAnalysis {
  amount: number;
  assumptions: string;
  monthly_spare_assumed: number;
  total_monthly_paid_assumed: number;
  baseline: { total_interest_from_now: number; months_to_debt_free: number | null; debt_free: ISODate | null };
  options: LumpOption[];
  per_loan: {
    loan: string; structure: string; rate_pa: number; outstanding: number; monthly_payment: number; months_left: number | null;
    interest_still_to_pay: number | null; ends: ISODate | null; prepay_charge_pct: number;
    /** Prepaying here and nothing else changing: the loan's own saving over its whole life, over just the next 12 months, and the yearly return it equals. */
    standalone_if_all_goes_here: { applied: number; interest_saved_over_loan_life: number; interest_saved_next_12_months: number; months_saved: number | null; effective_return_pa: number; years_it_takes_to_earn_that: number | null } | null;
    /** Whole-household result (all loans, freed EMIs rolled on) of putting everything here, after prepayment charges. */
    household_net_saving_if_all_here: number;
    note: string;
  }[];
}

/** Compare every sensible way to spend `amount` on debt: all into one loan, or clear a small loan and put the rest into another. */
export function lumpSumAnalysis(state: State, amount: number): LumpAnalysis {
  const loans = state.activeLoans();
  const debts = state.debts();
  const dues = debts.reduce((s, d) => s + d.min_payment, 0);
  const spare = monthlyBandwidth(state.incomeThisMonth(), state.expensesTotal(), dues, num(state.settings.emergency_buffer)).spare;
  const budget = dues + spare; // keep paying the same total each month; freed EMIs roll into the costliest loan (avalanche)
  const base = simulate(debts, budget, "avalanche");
  const byId = new Map(loans.map((l) => [l.id, l]));

  const apply = (alloc: { id: string; amt: number }[]) => {
    const ds: Debt[] = debts.map((d) => ({ ...d }));
    let charges = 0, freed = 0;
    for (const a of alloc) {
      const d = ds.find((x) => x.id === a.id)!, l = byId.get(a.id)!;
      const amt = Math.min(a.amt, d.balance);
      charges += (amt * num(l.prepay_charge_pct)) / 100;
      d.balance -= amt;
      if (d.balance <= 0.005) { freed += d.min_payment; d.balance = 0; d.min_payment = 0; }
      else if (l.type === "interest_only" || l.type === "bullet") d.min_payment = (d.balance * d.rate) / 1200; // interest shrinks with the principal
    }
    return { sim: simulate(ds, budget, "avalanche"), charges, freed };
  };
  const toOption = (label: string, alloc: { id: string; amt: number }[]): LumpOption => {
    const { sim, charges, freed } = apply(alloc);
    const saved = base.total_interest - sim.total_interest;
    return { label, allocations: alloc.map((a) => ({ loan: byId.get(a.id)!.name, amount: Math.round(Math.min(a.amt, debts.find((d) => d.id === a.id)!.balance)) })),
      interest_saved: Math.round(saved), charges: Math.round(charges), net_saving: Math.round(saved - charges),
      months_saved: base.months != null && sim.months != null ? base.months - sim.months : 0, debt_free: sim.debt_free_date,
      total_interest_after: Math.round(sim.total_interest), emi_freed_per_month: Math.round(freed) };
  };

  const options: LumpOption[] = [];
  const single = new Map<string, LumpOption>();
  for (const l of loans) {
    const bal = state.outstanding(l);
    const one = toOption(`All ${Math.round(Math.min(amount, bal)).toLocaleString("en-IN")} into ${l.name}`, [{ id: l.id, amt: amount }]);
    single.set(l.id, one);
    options.push(one);
    if (bal < amount) // clears this loan, then the rest goes to another
      for (const o of loans) if (o.id !== l.id)
        options.push(toOption(`Clear ${l.name}, rest into ${o.name}`, [{ id: l.id, amt: bal }, { id: o.id, amt: amount - bal }]));
  }
  options.sort((a, b) => b.net_saving - a.net_saving);

  const per_loan = loans.map((l) => {
    const bal = state.outstanding(l), p = state.payoff(l), s = structure(l), rate = num(l.rate_pa);
    const sch = state.schedule(l.id);
    let standalone = null as LumpAnalysis["per_loan"][number]["standalone_if_all_goes_here"];
    const applied = Math.min(amount, bal);
    if (sch.length && rate > 0) {
      const unpaid = sch.filter((r) => !(r.paid === true || String(r.paid).toUpperCase() === "TRUE"));
      const first = String(unpaid[0]?.due_date ?? "");
      const e = L.prepaymentEffect(bal, rate, num(l.emi), applied, true);
      const f = (b: number) => L.schedule(b, rate, num(l.emi), 12, (state.nextDue(l)[0] ?? first) as ISODate).reduce((a, r) => a + r.interest, 0);
      const y12 = f(bal) - f(Math.max(bal - applied, 0));
      standalone = { applied: Math.round(applied), interest_saved_over_loan_life: Math.round(e.interest_saved), interest_saved_next_12_months: Math.round(y12), months_saved: e.months_saved,
        effective_return_pa: rate, years_it_takes_to_earn_that: e.months_saved != null && e.interest_saved > 0 ? Math.round(((remainingMonths(state, l) ?? 0) / 12) * 10) / 10 : null };
    } else if ((l.type === "bullet" || l.type === "interest_only") && rate > 0) {
      const life = l.type === "bullet" ? (() => { const [a, b] = state.bulletEffect(l, applied); return a - b; })() : null;
      standalone = { applied: Math.round(applied), interest_saved_over_loan_life: life == null ? Math.round((applied * rate) / 100) : Math.round(life), interest_saved_next_12_months: Math.round((applied * rate) / 100),
        months_saved: null, effective_return_pa: rate, years_it_takes_to_earn_that: null };
    }
    return { loan: l.name, structure: s.kind, rate_pa: rate, outstanding: Math.round(bal), monthly_payment: Math.round(state.monthlyDue(l)), months_left: remainingMonths(state, l),
      interest_still_to_pay: p.interest == null ? null : Math.round(p.interest), ends: p.end, prepay_charge_pct: num(l.prepay_charge_pct), standalone_if_all_goes_here: standalone,
      household_net_saving_if_all_here: single.get(l.id)?.net_saving ?? 0, note: s.note };
  });

  return { amount: Math.round(amount),
    monthly_spare_assumed: Math.round(spare), total_monthly_paid_assumed: Math.round(budget),
    assumptions: "options/household_net_saving use a whole-household simulation: the user keeps paying total_monthly_paid_assumed every month (all EMIs plus monthly_spare_assumed), and money freed by a cleared loan rolls into the highest-rate remaining loan. That monthly spare is NOT guaranteed; if it is small, long loans stay open longer and the ranking can change. standalone_if_all_goes_here is the simpler view: prepay that one loan and change nothing else. Interest is modelled as reducing-balance monthly; net_saving subtracts prepayment charges.",
    baseline: { total_interest_from_now: Math.round(base.total_interest), months_to_debt_free: base.months, debt_free: base.debt_free_date },
    options: options.slice(0, 6), per_loan: per_loan.sort((a, b) => b.household_net_saving_if_all_here - a.household_net_saving_if_all_here) };
}
