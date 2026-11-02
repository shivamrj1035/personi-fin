import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Store } from "../lib/store";

// Reads the real Sheet, runs sync(), but every WRITE is only logged. LIVE=1 npx vitest run tests/live-dryrun.test.ts
it.skipIf(!process.env.LIVE)("sync would write (dry run)", async () => {
  const s = new Store() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const log: string[] = [];
  s.values = async (d: [string, unknown[][]][]) => { log.push(`values ${d.length}: ` + d.slice(0, 6).map(([r, v]) => `${r} ${JSON.stringify(v).slice(0, 90)}`).join(" | ")); };
  s.batch = async (r: unknown[]) => { if (r.length) log.push(`batch ${r.length}: ` + JSON.stringify(r).slice(0, 160)); return {}; };
  s.clear = async (r: string[]) => { log.push(`clear ${r.join(",")}`); };
  s.append = async (t: string, rows: unknown[]) => { log.push(`append ${t} ${JSON.stringify(rows)}`); };
  s.updateRow = async (t: string, m: unknown, v: unknown) => { log.push(`updateRow ${t} ${JSON.stringify(m)} ${JSON.stringify(v)}`); return true; };
  s.addSheet = async (t: string) => { log.push(`ADD SHEET ${t}`); return { id: 1, title: t }; };
  await s.refreshWss();
  const { wrote } = await s.sync();
  console.log("wrote:", wrote, "\n" + log.join("\n"));
}, 90000);
