import { NextResponse } from "next/server";
import { advise } from "@/lib/invest";
import { State, Tabs } from "@/lib/state";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { tabs, investable, question } = (await req.json()) as { tabs: Tabs; investable: number; question?: string };
  try {
    return NextResponse.json(await advise(new State(tabs), Number(investable) || 0, question || ""));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
