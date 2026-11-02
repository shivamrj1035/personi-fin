import { NextResponse } from "next/server";
import { ACTIONS } from "@/lib/rpc";
import { exclusive, getStore, loadAndSync } from "@/lib/server";
import { State } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { name, args } = await req.json();
  const handler = ACTIONS[name];
  if (!handler) return NextResponse.json({ error: `Unknown action: ${name}` }, { status: 400 });
  try {
    const out = await exclusive(async () => {
      const store = await getStore();
      const snap = await store.readAll();
      const result = await handler(store, new State(snap.tabs), args || {});
      const { tabs } = await loadAndSync(store);
      return { result: result ?? null, tabs };
    });
    return NextResponse.json({ ...out, at: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
