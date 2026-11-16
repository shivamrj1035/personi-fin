import { NextResponse } from "next/server";
import { describe, unpack } from "@/lib/activity";
import { ACTIONS } from "@/lib/rpc";
import { exclusive, getStore, loadAndSync } from "@/lib/server";
import { State } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { name, args } = await req.json();
  try {
    const out = await exclusive(async () => {
      const store = await getStore();
      const snap = await store.readAll();
      const state = new State(snap.tabs);

      if (name === "undoActivity") {
        const entry = await store.activityEntry(String(args?.id));
        if (!entry) throw new Error("That log entry no longer exists.");
        if (entry.status === "undone") throw new Error("Already undone.");
        const ops = unpack(entry.undo);
        if (!ops.length) throw new Error("This entry can't be undone.");
        await store.undoOps(ops);
        await store.markUndone(entry.row);
        return { result: true, tabs: (await loadAndSync(store)).tabs };
      }

      const handler = ACTIONS[name];
      if (!handler) throw Object.assign(new Error(`Unknown action: ${name}`), { status: 400 });
      const summary = describe(name, args || {}, state);
      store.beginRecord();
      let result: unknown, ops;
      try { result = await handler(store, state, args || {}); } finally { ops = store.endRecord(); }
      await store.logActivity({ action: name, summary, ops, count: snap.tabs.Activity.length });
      return { result: result ?? null, tabs: (await loadAndSync(store)).tabs };
    });
    return NextResponse.json({ ...out, at: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: (e as { status?: number }).status ?? 500 });
  }
}
