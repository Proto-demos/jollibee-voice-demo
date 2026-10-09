/**
 * One-off script: records Joy's pre-recorded greetings (lib/voice/greeting.ts)
 * with the OpenAI TTS API in the same "marin" voice as the live session, and
 * writes them to public/audio/. Re-run after changing the bestsellers.
 * Run with: NODE_OPTIONS=--use-system-ca npx tsx scripts/generate-greeting.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GREETINGS } from "../lib/voice/greeting";

for (const line of existsSync(".env.local") ? readFileSync(".env.local", "utf-8").split("\n") : []) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY is not set (checked process.env and .env.local).");
const VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";

async function main() {
  for (const greeting of GREETINGS) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: VOICE,
        input: greeting.spoken,
        instructions:
          "You are Joy, a warm, upbeat Filipina crew member greeting a customer at a Jollibee kiosk. Speak natural Taglish with a friendly Filipino accent at a quick, cheerful pace, like a happy, busy fast-food crew member. No long pauses.",
        response_format: "mp3",
      }),
    });
    if (!res.ok) throw new Error(`${greeting.audio}: ${res.status} ${await res.text()}`);
    const out = join("public", greeting.audio);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`done  ${greeting.audio}`);
  }
}
main();
