import "server-only";
import { Store } from "./store";
import { State, Tabs } from "./state";

/** One Store per warm server instance; bootstrap (tab/header checks) runs once per instance. */
const g = globalThis as unknown as { __store?: Store; __boot?: Promise<void>; __queue?: Promise<unknown> };

export async function getStore(): Promise<Store> {
  const s = (g.__store ||= new Store());
  await (g.__boot ||= s.bootstrap().catch((e) => { g.__boot = undefined; throw e; }));
  return s;
}

/** Serialise Sheet work inside one instance so two requests never create the same tab at once. */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__queue || Promise.resolve()).then(fn, fn);
  g.__queue = run.catch(() => undefined);
  return run;
}

export async function loadAndSync(store: Store): Promise<{ tabs: Tabs; state: State }> {
  const { snap } = await store.sync();
  return { tabs: snap.tabs, state: new State(snap.tabs) };
}
