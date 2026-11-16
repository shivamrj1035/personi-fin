import { describe, it, expect } from "vitest";
import { lumpSumAnalysis, parseAmount } from "../lib/advice";
import { State, emptyTabs } from "../lib/state";

describe("parseAmount", () => {
  it("reads common ways of writing money", () => {
    expect(parseAmount("I have 50k amount")).toBe(50000);
    expect(parseAmount("pay ₹2,00,000 now")).toBe(200000);
    expect(parseAmount("1.5 lakh")).toBe(150000);
    expect(parseAmount("no number here")).toBeNull();
    expect(parseAmount("EMI #4 due")).toBeNull();
  });
});

describe("lumpSumAnalysis", () => {
  const loan = (id: string, name: string, rate: number, outstanding: number, emi: number) => ({ id, name, lender: "Bank", owner: "A", type: "bank_emi", principal: outstanding, rate_pa: rate,
    emi, tenure_months: "", first_due_date: "2026-11-05", rate_type: "floating", prepay_charge_pct: 0, deadline: "", status: "active", outstanding, notes: "", tab: name });
  const tabs = { ...emptyTabs(), Loans: [loan("h", "Home", 7.1, 3_000_000, 21000), loan("c", "Car", 14, 150_000, 6000)],
    Recurring: [{ person: "A", source: "Salary", amount: 60000 }], Income: [{ person: "A", type: "fixed", month: new Date().toISOString().slice(0, 7), amount: 60000, received: true, tab: "x", row: 1 }] };
  it("puts a lump into the costlier short loan and subtracts charges", () => {
    const a = lumpSumAnalysis(new State(tabs), 50000);
    expect(a.options[0].allocations[0].loan).toBe("Car");
    expect(a.options[0].net_saving).toBeGreaterThan(0);
    expect(a.per_loan[0].loan).toBe("Car");
  });
  it("charges reduce the net saving", () => {
    const withFee = { ...tabs, Loans: tabs.Loans.map((l) => (l.id === "c" ? { ...l, prepay_charge_pct: 5 } : l)) };
    const a = lumpSumAnalysis(new State(withFee), 50000), b = lumpSumAnalysis(new State(tabs), 50000);
    const car = (x: typeof a) => x.options.find((o) => o.label.startsWith("All") && o.label.includes("Car"))!;
    expect(car(a).charges).toBe(2500);
    expect(car(a).net_saving).toBeLessThan(car(b).net_saving);
  });
});
