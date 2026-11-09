import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { distill } from "./distill.ts";
import { gitRoot, handleHook } from "./hooks.ts";
import { addRepo, readIndex, readTopic, repos, setSubscribed } from "./knowledge.ts";

const { positionals: [cmd, a, b] } = parseArgs({ allowPositionals: true });
const need = (v: string | undefined, what: string) => {
  if (!v) throw new Error(`usage: docent ${cmd} <${what}>`);
  return v;
};

try {
  if (cmd === "hook") {
    if (process.env.DOCENT_DISTILLING) process.exit(0); // distiller's own session: never recurse
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    const out = handleHook(need(a, "event"), input);
    if (out) console.log(JSON.stringify(out));
  } else if (cmd === "add") {
    const path = resolve(b ?? ".");
    if (!existsSync(path)) throw new Error(`no such dir: ${path}`);
    addRepo(need(a, "name"), path);
    console.log(`added ${a} -> ${path}`);
  } else if (cmd === "list") {
    for (const [n, p] of Object.entries(repos())) console.log(`${n}\t${p}\t${readIndex(n).split("\n").filter(Boolean).length} topics`);
  } else if (cmd === "subscribe" || cmd === "unsubscribe") {
    const name = need(a, "repo");
    if (cmd === "subscribe" && !(name in repos())) throw new Error(`unknown repo ${name} (docent add first)`);
    setSubscribed(gitRoot(process.cwd()), name, cmd === "subscribe");
    console.log(`${cmd}d ${gitRoot(process.cwd())} ${cmd === "subscribe" ? "to" : "from"} ${name}`);
  } else if (cmd === "knowledge") {
    console.log((b ? readTopic(need(a, "repo"), b) : readIndex(need(a, "repo"))) || "(empty)");
  } else if (cmd === "distill") {
    await distill(need(a, "repo"));
  } else {
    console.error("usage: docent add|list|subscribe|unsubscribe|knowledge|distill|hook ...");
    process.exit(1);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
