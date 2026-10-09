/**
 * One-off script: generates a photo for every menu item / combo via the
 * OpenAI Images API and writes it to public/<image path from lib/menu.ts>.
 * Run with: npx tsx scripts/generate-images.ts [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADDONS, COMBOS, MENU_ITEMS } from "../lib/menu";

/** Add-ons and meal drinks that have no menu item of their own to borrow a photo from. */
const ADDON_PROMPTS: Record<string, string> = {
  "addon-upsize-drink": "Two plain white fast-food paper soft-drink cups with white plastic lids and red straws, a tall large cup standing beside a shorter regular cup, showing a drink upsize. The lids are on, so no drink is visible.",
  "addon-gravy": "A small round dipping cup filled with rich, glossy brown chicken gravy.",
  "drink-coke-zero": "A clear plastic fast-food cup filled with dark brown cola and clear ice cubes, a black lid and black straw, condensation on the cup. The cola is dark brown, never red.",
  "drink-sprite": "A clear plastic fast-food cup of colourless, crystal-clear sparkling lemon-lime soda with bubbles and clear ice cubes, a clear lid and a straw, a lemon and lime slice beside it. The soda is clear like water, not green or yellow.",
  "drink-royal": "A clear fast-food cup of bright orange soda with ice, a lid and a straw.",
  "drink-pineapple-juice": "A clear fast-food cup of golden pineapple juice with ice and a straw, a pineapple wedge beside it.",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("OPENAI_API_KEY is not set (checked process.env and .env.local).");
  process.exit(1);
}

const FORCE = process.argv.includes("--force");
const CONCURRENCY = 4;

interface Job {
  id: string;
  imagePath: string;
  prompt: string;
}

const STYLE_SUFFIX =
  "Professional fast-food advertising photography, appetizing, vibrant natural colors, soft studio lighting, shallow depth of field, clean plain light-grey or white background, no text, no logos, no brand names, no packaging labels, square framing.";

const jobs: Job[] = [
  ...MENU_ITEMS.map((item) => ({
    id: item.id,
    imagePath: item.image,
    prompt: `${item.name}: ${item.description} ${STYLE_SUFFIX}`,
  })),
  ...COMBOS.map((combo) => ({
    id: combo.id,
    imagePath: combo.image,
    prompt: `A fast-food combo meal tray containing: ${combo.description} Arranged appetizingly together on a tray. ${STYLE_SUFFIX}`,
  })),
  ...ADDONS.filter((addon) => addon.image && ADDON_PROMPTS[addon.id]).map((addon) => ({
    id: addon.id,
    imagePath: addon.image!,
    prompt: `${ADDON_PROMPTS[addon.id]} ${STYLE_SUFFIX}`,
  })),
];

async function generateOne(job: Job): Promise<void> {
  const outPath = join(ROOT, "public", job.imagePath);
  if (existsSync(outPath) && !FORCE) {
    console.log(`skip  (exists) ${job.imagePath}`);
    return;
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: job.prompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${job.id}: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { data: Array<{ b64_json: string }> };
  const b64 = data.data[0]?.b64_json;
  if (!b64) throw new Error(`${job.id}: no image data returned`);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, "base64"));
  console.log(`done  ${job.imagePath}`);
}

async function runPool(items: Job[], size: number) {
  let index = 0;
  let failures = 0;
  async function worker() {
    while (index < items.length) {
      const job = items[index++];
      try {
        await generateOne(job);
      } catch (err) {
        failures++;
        console.error(`FAIL  ${job.imagePath}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return failures;
}

async function main() {
  const failures = await runPool(jobs, CONCURRENCY);
  console.log(`\n${jobs.length - failures}/${jobs.length} images generated.`);
  if (failures > 0) process.exit(1);
}

main();
