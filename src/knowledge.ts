// All durable state lives here ($DOCENT_HOME). One module = one place to swap the backend.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Turn = { role: "user" | "assistant"; text: string };
export type Queued = { repo: string; ts: number; conversation: Turn[] };

export const home = () => process.env.DOCENT_HOME ?? join(homedir(), ".docent");
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const checkName = (n: string) => {
  if (!NAME.test(n)) throw new Error(`invalid name: ${n}`);
  return n;
};

const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};
const writeJson = (path: string, v: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2));
};

// --- repos + subscriptions ---
export const repos = () => readJson<Record<string, string>>(join(home(), "repos.json"), {});
export const addRepo = (name: string, path: string) => writeJson(join(home(), "repos.json"), { ...repos(), [checkName(name)]: path });

const subsPath = () => join(home(), "subscriptions.json");
export const subscriptions = () => readJson<Record<string, string[]>>(subsPath(), {});
export const subscribedTo = (root: string) => subscriptions()[root] ?? [];
export function setSubscribed(root: string, name: string, on: boolean) {
  const all = subscriptions();
  const set = new Set(all[root] ?? []);
  if (on) set.add(checkName(name));
  else set.delete(name);
  all[root] = [...set];
  writeJson(subsPath(), all);
}

// --- knowledge files ---
export const knowledgeDir = (name: string) => join(home(), "knowledge", checkName(name));
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
export const readIndex = (name: string) => read(join(knowledgeDir(name), "index.md"));
export const readTopic = (name: string, topic: string) => read(join(knowledgeDir(name), "topics", `${checkName(topic)}.md`));
export const logLines = (name: string) => read(join(knowledgeDir(name), "log.md")).split("\n").filter(Boolean);

// --- per-session "seen" cursor over log.md ---
const seenPath = (session: string) => join(home(), "seen", `${checkName(session)}.json`);
export const getSeen = (session: string) => readJson<Record<string, number>>(seenPath(session), {});
export const setSeen = (session: string, v: Record<string, number>) => writeJson(seenPath(session), v);

// --- queue (conversations waiting to be distilled) ---
const queueDir = (name: string) => join(home(), "queue", checkName(name));
export function enqueue(agentId: string, q: Queued) {
  writeJson(join(queueDir(q.repo), `${checkName(agentId)}.json`), q); // same agent again = latest wins
}
export function queued(name: string): { file: string; q: Queued }[] {
  const dir = queueDir(name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: join(dir, f), q: readJson<Queued>(join(dir, f), null as never) }))
    .filter((x) => x.q);
}

// --- single-writer lock per repo (mkdir is atomic) ---
const STALE_MS = 15 * 60_000;
export function acquire(name: string): boolean {
  const dir = join(home(), "locks", checkName(name));
  mkdirSync(join(dir, ".."), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      mkdirSync(dir);
      return true;
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs < STALE_MS) return false;
        rmSync(dir, { recursive: true }); // stale: owner died
      } catch {}
    }
  }
  return false;
}
export const release = (name: string) => rmSync(join(home(), "locks", checkName(name)), { recursive: true, force: true });
