import { NextResponse } from "next/server";
import { handleImage } from "@/lib/ai-handlers";

export const maxDuration = 90;

export async function POST(req: Request) {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const r = await handleImage(Buffer.from(await file.arrayBuffer()), file.type);
  return NextResponse.json(r.body, { status: r.status === 500 ? 422 : r.status });
}
