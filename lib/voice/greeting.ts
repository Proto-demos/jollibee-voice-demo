import { getFeaturedBestsellers } from "@/lib/menu";

/**
 * Joy's opening line, pre-recorded so it plays the instant the customer taps
 * the mic — the live session connects in the background while it plays.
 * `text` is shown in the transcript and handed to the model as what she
 * already said; `spoken` is what the recording reads.
 * Regenerate the audio with: NODE_OPTIONS=--use-system-ca npx tsx scripts/generate-greeting.ts
 */
export interface Greeting {
  audio: string;
  text: string;
  spoken: string;
}

/** "A, B, at C" — the featured bestsellers, named the same way as on the card. */
function featured(): string {
  const names = getFeaturedBestsellers().map((b) => b.name);
  return `${names.slice(0, -1).join(", ")}, at ${names[names.length - 1]}`;
}

/** "1-pc" reads as "one-piece" out loud. */
const spoken = (text: string) => text.replace(/(\d)-pc/g, "$1-piece");

// Short on purpose: the mic stays closed while it plays, and the prices are
// already on the bestsellers card.
export const GREETINGS: Greeting[] = [
  {
    audio: "/audio/greeting-1.mp3",
    text: `Hi po, welcome sa Jollibee! Bestsellers natin today ang ${featured()}. Ano pong gusto niyo?`,
    spoken: spoken(`Hi po, welcome sa Jollibee! Bestsellers natin today ang ${featured()}. Ano pong gusto niyo?`),
  },
  {
    audio: "/audio/greeting-2.mp3",
    text: `Hello po, welcome sa Jollibee! Paborito ngayon ang ${featured()}. Ano pong order niyo?`,
    spoken: spoken(`Hello po, welcome sa Jollibee! Paborito ngayon ang ${featured()}. Ano pong order niyo?`),
  },
];

export function pickGreeting(): Greeting {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}
