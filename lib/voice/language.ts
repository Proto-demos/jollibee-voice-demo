/**
 * Which language the customer is speaking, from their transcript. The model
 * kept sliding into Taglish with English speakers (its prompt, pitch lines and
 * tool hints are mostly Tagalog), so the kiosk tracks the language itself and
 * says it outright on every reply.
 */
export type CustomerLanguage = "en" | "tl";

const TAGALOG = new Set(
  "po opo ang ng mga na sa yung yun lang niyo nyo ninyo ko kayo isang isa dalawa dalawang tatlong apat pa ba hindi wala sige oo gusto natin din rin naman salamat tapos ito iyan yan dito diyan ano paano magkano pwede puwede ayaw meron mayroon kasi nalang lahat pala teka sandali ilan".split(" ")
);
const ENGLISH = new Set(
  "the please i i'd i'll i'm a an can get want no yes thanks thank that's thats is it just one two with me would like everything fine sure make of for to my you have do don't dont how what much this that some any instead okay yeah nope good all".split(" ")
);

/** null when the line gives no clear signal (e.g. just a menu name). */
export function detectLanguage(text: string): CustomerLanguage | null {
  // Menu names aren't a language signal: "1-pc Chickenjoy with Rice" comes back
  // as "one-piece Chickenjoy with rice" in a Tagalog order.
  const words =
    text
      .toLowerCase()
      .replace(/\b(one|two|three|four|six|\d+)[- ]?(piece|pc)s?\b/g, " ")
      .replace(/\bwith rice\b/g, " ")
      .match(/[a-z']+/g) ?? [];
  let tl = 0;
  let en = 0;
  for (const w of words) {
    if (TAGALOG.has(w)) tl += 1;
    else if (ENGLISH.has(w)) en += 1;
  }
  // Switching to English takes two English words: menu names ("Chickenjoy
  // with Rice") and a misheard "po" ("Poe", "Pull") shouldn't flip a Tagalog order.
  if (en >= 2 && en > tl) return "en";
  if (tl > en) return "tl";
  return null;
}

/** Appended to the instructions of every reply. */
export function languageNote(lang: CustomerLanguage): string {
  return lang === "en"
    ? "\n\nLANGUAGE RIGHT NOW: the customer is speaking ENGLISH. Write this whole reply in plain English — no Tagalog or Taglish words at all (no \"po\", \"na\", \"ang\", \"niyo\", \"natin\", \"Sige\", \"Added na\", \"Gawin na\", \"Libre lang\", \"Yun lang po ba?\"). Translate any Tagalog pitch line or hint from the tools into natural English (e.g. \"Which drink would you like?\", \"Is that everything?\")."
    : "\n\nLANGUAGE RIGHT NOW: the customer is speaking Tagalog. Reply in natural Tagalog/Taglish (po, natin, niyo) — not in English sentences; only menu words stay in English.";
}
