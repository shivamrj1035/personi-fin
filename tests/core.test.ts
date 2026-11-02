import { describe, it, expect } from "vitest";
import { emi, solveRate, schedule, installmentsDue, prepaymentEffect, monthsToClear } from "../lib/loans";
import { compareStrategies } from "../lib/planner";
import { addMonths, fmtDate, parseDate, parseMonthTitle, lastWorkingDay } from "../lib/dates";

function balanceAfter(p: number, rate: number, pay: number, paid: number) { const r = rate / 1200; let b = p; for (let i = 0; i < paid; i++) b = b * (1 + r) - pay; return Math.max(b, 0); }

describe("loan maths", () => {
  it("emi matches idfc pdf", () => expect(Math.round(emi(94370, 12.19, 24))).toBe(4451));
  it("solveRate recovers", () => expect(Math.abs(solveRate(94370, emi(94370, 12.19, 24), 24) - 12.19)).toBeLessThan(0.01));
  it("zero rate", () => expect(solveRate(114900, 7660, 15)).toBe(0));
  it("central bank rate reasonable", () => { const r = solveRate(2_000_000, 20710, 356); expect(r).toBeGreaterThan(0); expect(r).toBeLessThan(20); });
  it("schedule ends at zero", () => { const s = schedule(67018, 16.2, 6087, 12, "2026-11-03"); expect(s.at(-1)!.closing).toBeLessThan(1); expect(s.length).toBe(12); });
  it("installments due", () => { expect(installmentsDue("2026-08-10", "2026-10-25", 356)).toBe(3); expect(installmentsDue("2026-11-03", "2026-10-25", 24)).toBe(0); });
  it("prepayment shortens tenure", () => {
    const bal = balanceAfter(2_500_000, 8.5, 20710, 3);
    const r = prepaymentEffect(bal, 8.5, 20710, 200_000, true);
    expect(r.months_saved).toBeGreaterThan(0); expect(r.interest_saved).toBeGreaterThan(0);
    expect(prepaymentEffect(bal, 8.5, 20710, 200_000, false).new_emi!).toBeLessThan(20710);
    expect(monthsToClear(bal, 8.5, 20710)).toBeGreaterThan(0);
  });
  it("avalanche pays no more interest than snowball", () => {
    const d = (id: string, name: string, balance: number, rate: number, min_payment: number, kind = "bank_emi") => ({ id, name, balance, rate, min_payment, kind, deadline: null });
    const res = Object.fromEntries(compareStrategies([d("a", "Home", 2_000_000, 8.5, 20710), d("b", "Car", 300_000, 14, 8000), d("c", "Friend", 50_000, 0, 0, "interest_free_flexible")], 10000).map((r) => [r.strategy, r]));
    expect(res.avalanche.total_interest).toBeLessThanOrEqual(res.snowball.total_interest);
    expect(res.avalanche.months).not.toBeNull();
  });
});

describe("dates", () => {
  it("add months clamps day", () => expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"));
  it("parses sheet formats", () => { expect(parseDate("05 Nov 2026")).toBe("2026-11-05"); expect(parseDate("05/11/2026")).toBe("2026-11-05"); expect(fmtDate("2026-11-05")).toBe("05 Nov 2026"); });
  it("month title", () => expect(parseMonthTitle("Nov 2026")).toBe("2026-11-01"));
  it("last working day", () => expect(lastWorkingDay("2026-11-10")).toBe("2026-11-30"));
});
