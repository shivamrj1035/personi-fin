import { NextResponse } from "next/server";
import { parseImage } from "@/lib/importers";

export const maxDuration = 90;

export async function POST(req: Request) {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const type = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) ? file.type : "image/png";
  try {
    return NextResponse.json({ parsed: await parseImage(Buffer.from(await file.arrayBuffer()), type as "image/png") });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
