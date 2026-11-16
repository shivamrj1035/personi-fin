/** Runs prompts through the locally installed AI command-line tool (server only). No API key: it uses the CLI's own login. */
import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class AiUnavailable extends Error {
  code = "AI_UNAVAILABLE" as const;
}

function executable(p: string | undefined): p is string {
  try { return !!p && fs.statSync(p).isFile() && (fs.accessSync(p, fs.constants.X_OK), true); } catch { return false; }
}

/** $EL_AI_BIN, `claude` on PATH, ~/.claude/local/claude, then the binary bundled with the VS Code extension. */
export function findCli(): string | null {
  const home = os.homedir();
  const cands: (string | undefined)[] = [process.env.EL_AI_BIN];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) if (dir) cands.push(path.join(dir, "claude"));
  cands.push(path.join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  try {
    const ext = path.join(home, ".vscode", "extensions");
    for (const d of fs.readdirSync(ext).filter((x) => x.startsWith("anthropic.claude-code-")).sort().reverse()) cands.push(path.join(ext, d, "resources", "native-binary", "claude"));
  } catch { /* no VS Code extensions folder */ }
  return cands.find(executable) ?? null;
}

export interface CompleteOpts {
  /** Let the model search the web (current prices and news). */
  search?: boolean;
  /** An image the model should read. */
  image?: { data: Buffer; ext: string };
  timeoutMs?: number;
}

export async function complete(prompt: string, opts: CompleteOpts = {}): Promise<string> {
  const exe = findCli();
  if (!exe) throw new AiUnavailable("The AI command-line tool isn't available on this server. Run the AI bridge on your computer (npm run ai-bridge) or open the app locally.");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "el-ai-")); // empty working dir: the CLI can only see what we put here
  try {
    const args = ["-p"];
    let input = prompt;
    if (opts.image) {
      const name = `shot${opts.image.ext}`;
      fs.writeFileSync(path.join(tmp, name), opts.image.data);
      args.push("--tools", "Read", "--allowedTools", "Read");
      input = `Read the image file ./${name}.\n\n${prompt}`;
    } else if (opts.search) args.push("--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch,WebFetch");
    else args.push("--tools", "");

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ exe, args, { cwd: /* turbopackIgnore: true */ tmp, env: process.env });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("The AI took too long to answer. Try again.")); }, opts.timeoutMs ?? 180_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(`AI CLI error: ${err.trim().slice(0, 400) || `exit ${code}`}`)); });
      child.stdin.end(input);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
