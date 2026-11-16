import { NextResponse } from "next/server";
import { handleInvest } from "@/lib/ai-handlers";

export const maxDuration = 300;

export async function POST(req: Request) {
  const r = await handleInvest(await req.json());
  return NextResponse.json(r.body, { status: r.status });
}
