import { readFileSync } from "node:fs";
import type { Turn } from "./knowledge.ts";

/** Claude Code transcript jsonl -> plain user/assistant text turns (tool calls and results dropped). */
export function parseTranscript(path: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    try {
      const e = JSON.parse(line);
      const role = e.message?.role ?? e.type;
      if (role !== "user" && role !== "assistant") continue;
      const c = e.message?.content;
      const text = (typeof c === "string" ? c : (c ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")).trim();
      if (text) turns.push({ role, text });
    } catch {} // skip malformed lines
  }
  return turns;
}
