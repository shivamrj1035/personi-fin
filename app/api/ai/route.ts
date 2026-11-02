import { NextResponse } from "next/server";
import { askVisual } from "@/lib/ai";
import { State, Tabs } from "@/lib/state";

export const maxDuration = 120;

/** The browser already holds the data, so it sends it along: no Sheet round-trip, and the AI sees exactly what is on screen. */
export async function POST(req: Request) {
  const { tabs, question } = (await req.json()) as { tabs: Tabs; question?: string };
  try {
    return NextResponse.json(await askVisual(new State(tabs), question || ""));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
