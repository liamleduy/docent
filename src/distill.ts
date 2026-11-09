import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { acquire, home, knowledgeDir, queued, release } from "./knowledge.ts";

const run = promisify(execFile);
// the distiller is detached (stdio ignored), so failures go to a log file
const fail = (name: string, msg: string) => {
  console.error(`distill ${name} failed, keeping queue: ${msg}`);
  try {
    mkdirSync(home(), { recursive: true });
    appendFileSync(`${home()}/distill.log`, `${new Date().toISOString()} ${name}: ${msg}\n`);
  } catch {}
};
const promptFile = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "distill.md");

/** Fold queued helper conversations into the repo's knowledge. Single writer; drains until empty. */
export async function distill(name: string): Promise<void> {
  if (!acquire(name)) return; // someone else is distilling and will drain the queue
  try {
    const dir = knowledgeDir(name);
    mkdirSync(dir, { recursive: true });
    for (let batch = queued(name); batch.length; batch = queued(name)) {
      const convos = batch
        .map(({ q }, i) => `### Conversation ${i + 1}\n` + q.conversation.map((t) => `**${t.role}:** ${t.text}`).join("\n\n"))
        .join("\n\n");
      const prompt = `${readFileSync(promptFile, "utf8")}\n\nRepo: ${name}\nKnowledge dir: ${dir}\n\n${convos}`;
      const args = [
        "-p", prompt, "--output-format", "json",
        "--tools", "Read,Grep,Glob,Edit,Write",
        "--allowedTools", "Read", "Grep", "Glob", `Edit(/${dir}/**)`, // leading "//" = absolute; Edit rules cover Write
        "--permission-mode", "dontAsk",
      ];
      if (process.env.DOCENT_DISTILL_MODEL) args.push("--model", process.env.DOCENT_DISTILL_MODEL);
      try {
        const { stdout } = await run(process.env.DOCENT_CLAUDE_BIN ?? "claude", args, {
          cwd: dir,
          env: { ...process.env, DOCENT_DISTILLING: "1" },
          timeout: 10 * 60_000,
        });
        // exit 0 is not enough: a denied write still exits 0
        let r: { is_error?: boolean; result?: string; permission_denials?: { tool_name: string; tool_input: unknown }[] } = {};
        try {
          r = JSON.parse(stdout);
        } catch {} // non-JSON (e.g. test stub): trust exit code
        if (r.is_error) throw new Error(`claude error: ${r.result}`);
        if (r.permission_denials?.length) throw new Error(`denied: ${JSON.stringify(r.permission_denials.map((d) => [d.tool_name, d.tool_input]))}`);
      } catch (e) {
        return fail(name, (e as Error).message);
      }
      // delete only what we consumed; a follow-up that re-queued meanwhile has a newer ts and stays
      for (const { file, q } of batch) {
        const now = queued(name).find((x) => x.file === file);
        if (now && now.q.ts === q.ts) rmSync(file, { force: true });
      }
    }
  } finally {
    release(name);
  }
}
