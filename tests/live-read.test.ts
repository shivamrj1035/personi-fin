import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Store } from "../lib/store";
import { State } from "../lib/state";

// Read-only check against the real Sheet. Run with: LIVE=1 npx vitest run tests/live-read.test.ts
it.skipIf(!process.env.LIVE)("reads the live sheet", async () => {
  const s = new Store();
  const { tabs } = await s.readAll();
  const st = new State(tabs);
  console.log(Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length])));
  console.log(st.activeLoans().map((l) => [l.name, Math.round(st.outstanding(l)), st.paidCount(l.id), st.nextDue(l)]));
  console.log("settings", st.settings, "income", st.incomeThisMonth(), "expenses", st.expensesTotal());
}, 60000);
