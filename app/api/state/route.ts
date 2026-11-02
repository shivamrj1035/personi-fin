import { NextResponse } from "next/server";
import { exclusive, getStore, loadAndSync } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const tabs = await exclusive(async () => (await loadAndSync(await getStore())).tabs);
    return NextResponse.json({ tabs, at: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
