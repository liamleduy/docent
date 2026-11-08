import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { enqueue, getSeen, home, knowledgeDir, logLines, readIndex, repos, setSeen, subscribedTo } from "./knowledge.ts";
import { parseTranscript } from "./transcript.ts";

export const HELPER = "knowledge-gc:helper";
type Input = Record<string, any>;
const ctx = (hookEventName: string, additionalContext: string) => ({ hookSpecificOutput: { hookEventName, additionalContext } });

export function gitRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return cwd;
  }
}

function sessionStart(i: Input) {
  const all = repos();
  const names = Object.keys(all);
  if (!names.length) return null;
  const subs = subscribedTo(gitRoot(i.cwd)).filter((n) => n in all);
  const seen = getSeen(i.session_id);
  for (const n of subs) seen[n] = logLines(n).length;
  setSeen(i.session_id, seen);
  const list = names.map((n) => `- ${n}: path=${all[n]} knowledge=${knowledgeDir(n)}`).join("\n");
  let out = `knowledge-gc repos (ask via the ${HELPER} subagent):\n${list}`;
  for (const n of subs) out += `\n\n## Knowledge index: ${n}\n${readIndex(n) || "(empty — nothing learned yet)"}`;
  return ctx("SessionStart", out);
}

function prompt(i: Input) {
  const seen = getSeen(i.session_id);
  const parts: string[] = [];
  for (const n of subscribedTo(gitRoot(i.cwd))) {
    const lines = logLines(n);
    if (n in seen && lines.length > seen[n]) parts.push(`New insights in ${n}:\n${lines.slice(seen[n]).join("\n")}`);
    seen[n] = lines.length; // first sight mid-session: mark seen, don't dump history
  }
  setSeen(i.session_id, seen);
  return parts.length ? ctx("UserPromptSubmit", parts.join("\n\n")) : null;
}

// realpath of the deepest existing ancestor + the not-yet-existing rest (e.g. a missing index.md)
const real = (p: string): string => {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(real(parent), abs.slice(parent.length + 1));
  }
};
const under = (p: string, root: string) => p === root || p.startsWith(root + sep);

/** Auto-approve the helper's reads of registered repos + $KGC_HOME. Anything else falls through to normal permissions. */
function preToolUse(i: Input) {
  if (i.agent_type !== HELPER) return null;
  const raw = i.tool_input?.file_path ?? i.tool_input?.path;
  if (!raw) return null;
  const p = real(raw.startsWith("~") ? join(homedir(), raw.slice(1)) : resolve(i.cwd ?? ".", raw));
  const roots = [home(), ...Object.values(repos())].map(real);
  if (!roots.some((r) => under(p, r))) return null;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "knowledge-gc helper read" } };
}

function subagentStop(i: Input) {
  if (i.agent_type !== HELPER || !i.agent_transcript_path || !i.agent_id) return null;
  const conversation = parseTranscript(i.agent_transcript_path);
  // the final answer is often not flushed to the transcript yet; the hook input carries it
  const last = typeof i.last_assistant_message === "string" ? i.last_assistant_message.trim() : "";
  if (last && !conversation.some((t) => t.role === "assistant" && t.text === last)) conversation.push({ role: "assistant", text: last });
  const repo = conversation.find((t) => t.role === "user")?.text.match(/^\s*repo:\s*(\S+)/i)?.[1];
  if (!repo || !(repo in repos()) || !conversation.some((t) => t.role === "assistant")) return null;
  enqueue(i.agent_id, { repo, ts: Date.now(), conversation });
  const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.ts");
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "distill", repo], { detached: true, stdio: "ignore" }).unref();
  return null;
}

const handlers: Record<string, (i: Input) => unknown> = {
  "session-start": sessionStart,
  prompt,
  "pre-tool-use": preToolUse,
  "subagent-stop": subagentStop,
};
export const handleHook = (event: string, input: Input) => handlers[event]?.(input) ?? null;
