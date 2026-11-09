import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { distill } from "./distill.ts";
import { handleHook, HELPER } from "./hooks.ts";
import { acquire, addRepo, enqueue, knowledgeDir, queued, release, setSubscribed } from "./knowledge.ts";
import { parseTranscript } from "./transcript.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "docent-"));
const fresh = () => (process.env.DOCENT_HOME = join(tmp(), "home"));

test("lock: exclusive, released, stale lock is stolen", () => {
  const h = fresh();
  assert.ok(acquire("r"));
  assert.ok(!acquire("r"));
  release("r");
  assert.ok(acquire("r"));
  const old = new Date(Date.now() - 20 * 60_000);
  utimesSync(join(h, "locks", "r"), old, old);
  assert.ok(acquire("r"), "stale lock should be stolen");
});

test("invalid names rejected (path traversal)", () => {
  fresh();
  assert.throws(() => addRepo("../x", "/tmp"));
  assert.throws(() => knowledgeDir("a/b"));
});

test("session-start injects index of subscribed repo; prompt shows only new log lines", () => {
  const h = fresh();
  const proj = tmp();
  addRepo("api", tmp());
  setSubscribed(proj, "api", true);
  const k = knowledgeDir("api");
  mkdirSync(k, { recursive: true });
  writeFileSync(join(k, "index.md"), "- [Auth](topics/auth.md) — tokens\n");
  writeFileSync(join(k, "log.md"), "- t1 auth: first\n");

  const start: any = handleHook("session-start", { session_id: "s1", cwd: proj });
  assert.match(start.hookSpecificOutput.additionalContext, /Auth/);
  assert.equal(handleHook("prompt", { session_id: "s1", cwd: proj }), null);

  writeFileSync(join(k, "log.md"), "- t1 auth: first\n- t2 auth: second\n");
  const p: any = handleHook("prompt", { session_id: "s1", cwd: proj });
  assert.match(p.hookSpecificOutput.additionalContext, /second/);
  assert.doesNotMatch(p.hookSpecificOutput.additionalContext, /first/);
  assert.equal(handleHook("prompt", { session_id: "s1", cwd: proj }), null);
  assert.ok(existsSync(h));
});

test("pre-tool-use: allows only the helper, only inside registered repos / DOCENT_HOME", () => {
  const h = fresh();
  const repo = tmp();
  const outside = tmp();
  writeFileSync(join(repo, "a.ts"), "x");
  symlinkSync(outside, join(repo, "escape"));
  addRepo("api", repo);
  const call = (agent_type: string, file_path: string) =>
    handleHook("pre-tool-use", { agent_type, tool_name: "Read", tool_input: { file_path }, cwd: tmp() }) as any;

  assert.equal(call(HELPER, join(repo, "a.ts")).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(call(HELPER, join(h, "knowledge", "api", "index.md")).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(call("other:agent", join(repo, "a.ts")), null);
  assert.equal(call(HELPER, join(outside, "secret")), null);
  assert.equal(call(HELPER, join(repo, "escape", "secret")), null, "symlink escape must not be allowed");
  assert.equal(call(HELPER, join(repo, "..", "x")), null);
});

test("transcript: keeps user/assistant text, drops tool blocks and junk", () => {
  const f = join(tmp(), "t.jsonl");
  writeFileSync(
    f,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "repo: api\nhow does auth work?" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read" }, { type: "text", text: "JWT, see auth.ts:10" }] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "big" }] } }),
      "not json",
    ].join("\n"),
  );
  assert.deepEqual(parseTranscript(f), [
    { role: "user", text: "repo: api\nhow does auth work?" },
    { role: "assistant", text: "JWT, see auth.ts:10" },
  ]);
});

test("subagent-stop queues the conversation for a registered repo only", () => {
  fresh();
  addRepo("api", tmp());
  process.env.DOCENT_CLAUDE_BIN = "true"; // spawned detached distiller must be harmless
  const f = join(tmp(), "t.jsonl");
  const line = (role: string, text: string) => JSON.stringify({ type: role, message: { role, content: text } });
  writeFileSync(f, [line("user", "repo: api\nq"), line("assistant", "a")].join("\n"));
  handleHook("subagent-stop", { agent_type: HELPER, agent_id: "ag1", agent_transcript_path: f });
  assert.equal(queued("api").length, 1);

  writeFileSync(f, [line("user", "repo: nope\nq"), line("assistant", "a")].join("\n"));
  handleHook("subagent-stop", { agent_type: HELPER, agent_id: "ag2", agent_transcript_path: f });
  assert.equal(queued("nope").length, 0);
});

test("distill: drains queue on success, keeps it on failure, re-queued newer ts survives", async () => {
  fresh();
  addRepo("api", tmp());
  const q = (ts: number) => ({ repo: "api", ts, conversation: [{ role: "user" as const, text: "q" }] });
  enqueue("a1", q(1));

  const bin = join(tmp(), "fake-claude");
  writeFileSync(bin, "#!/bin/sh\nexit 1\n");
  chmodSync(bin, 0o755);
  process.env.DOCENT_CLAUDE_BIN = bin;
  await distill("api");
  assert.equal(queued("api").length, 1, "failure keeps queue");
  assert.ok(acquire("api"), "lock released after failure");
  release("api");

  // fake claude that "succeeds" and simulates a follow-up re-queueing while it ran
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' '${JSON.stringify(q(2))}' > "$DOCENT_HOME/queue/api/a1.json"\nexit 0\n`);
  await distill("api");
  assert.equal(queued("api").length, 0, "second pass consumed the newer conversation");
});

test("distill: exit 0 with permission_denials keeps the queue and logs it", async () => {
  const h = fresh();
  addRepo("api", tmp());
  enqueue("a1", { repo: "api", ts: 1, conversation: [{ role: "user", text: "q" }] });
  const bin = join(tmp(), "fake-claude");
  writeFileSync(bin, `#!/bin/sh\necho '{"is_error":false,"permission_denials":[{"tool_name":"Write","tool_input":{"file_path":"/x"}}]}'\n`);
  chmodSync(bin, 0o755);
  process.env.DOCENT_CLAUDE_BIN = bin;
  await distill("api");
  assert.equal(queued("api").length, 1);
  assert.match(readFileSync(join(h, "distill.log"), "utf8"), /denied/);
});
