import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import fs from "node:fs";
import path from "node:path";
import { parsePdf, PasswordRequired, Parsed } from "../lib/importers";

const dir = process.env.SOURCES_DIR || path.join(__dirname, "../sources");
async function load(name: string): Promise<Parsed | null> {
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) return null;
  try { return await parsePdf(new Uint8Array(fs.readFileSync(f))); } catch (e) { if (e instanceof PasswordRequired) return null; throw e; }
}

describe("sample PDFs (same expectations as the Python tests)", () => {
  it("central bank home loan", async () => {
    const r = await load("REPAYMENT SCH_260720_171602.pdf"); if (!r) return;
    expect(r.tenure_months).toBe(356); expect(r.emi).toBe(20710);
    expect(r.schedule!.at(-1)!.closing).toBe(0); expect(r.rate_pa).toBeGreaterThan(6); expect(r.rate_pa).toBeLessThan(9);
  });
  it("idfc", async () => {
    const r = await load("Repayment Schedule_182605473.pdf"); if (!r) return;
    expect([r.principal, r.rate_pa, r.emi, r.tenure_months]).toEqual([94370, 12.19, 4451, 24]);
  });
  it("bajaj zero rate", async () => {
    const r = await load("RPS.pdf"); if (!r) return;
    expect(r.rate_pa).toBe(0); expect(r.tenure_months).toBe(15); expect(r.schedule!.at(-1)!.closing).toBe(0);
  });
  it("axis card needs dates", async () => {
    const r = await load("AXISMB_25-10-2026 182005.pdf"); if (!r) return;
    expect(r.needs_dates).toBe(true); expect(r.tenure_months).toBe(12); expect(r.emi).toBe(576);
  });
});
