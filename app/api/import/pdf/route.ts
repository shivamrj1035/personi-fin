import { NextResponse } from "next/server";
import { PasswordRequired, parsePdf } from "@/lib/importers";

export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  try {
    const parsed = await parsePdf(new Uint8Array(await file.arrayBuffer()), (form.get("password") as string) || undefined);
    return NextResponse.json({ parsed });
  } catch (e) {
    if (e instanceof PasswordRequired) return NextResponse.json({ needsPassword: true, wrong: e.wrong });
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
