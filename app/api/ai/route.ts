import { NextResponse } from "next/server";
import { handleAi } from "@/lib/ai-handlers";

export const maxDuration = 120;

/** The browser already holds the data, so it sends it along: no Sheet round-trip, and the AI sees exactly what is on screen. */
export async function POST(req: Request) {
  const r = await handleAi(await req.json());
  return NextResponse.json(r.body, { status: r.status });
}
