/**
 * Diagnostic: replays one customer turn against the Realtime API with the
 * exact session config the kiosk uses, and prints every event.
 * Run with: NODE_OPTIONS=--use-system-ca npx tsx scripts/debug-realtime.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { buildSystemInstructions } from "../lib/voice/prompt";
import { detectLanguage, languageNote, type CustomerLanguage } from "../lib/voice/language";
import { GREETINGS } from "../lib/voice/greeting";
import { createToolHandlers, TOOL_DEFINITIONS } from "../lib/voice/tools";
import { VOICE_SPEED } from "../lib/voice/config";
import type { ChoiceKind } from "../lib/menu";
import { cartReducer, computeTotals, initialState, modifierLabel, planAddon, planChoices, planRemoveAddon, planUpgrade, type CartAction, type CartContextValue } from "../lib/cart";

// A real order behind the tools — the same reducer and add-on planner as the
// kiosk — so every tool call gets the reply the kiosk would give.
let cartState = initialState;
const dispatch = (action: CartAction) => (cartState = cartReducer(cartState, action));
const cart = {
  getState: () => cartState,
  addItem: (refId: string, qty = 1) => (dispatch({ type: "ADD_LINE", kind: "item", refId, qty }), true),
  addCombo: (refId: string, qty = 1) => (dispatch({ type: "ADD_LINE", kind: "combo", refId, qty }), true),
  addAddon: (refId: string, qty = 1) => (dispatch({ type: "ADD_LINE", kind: "addon", refId, qty }), true),
  applyAddon: (addonId: string, qty: number, forRef?: string, forLineId?: string) => {
    const plan = planAddon(cartState.lines, addonId, qty, forRef, forLineId);
    if ("error" in plan) return plan;
    dispatch(plan.action);
    return { applied: plan.applied, itemName: plan.itemName, itemRef: plan.itemRef };
  },
  upgradeToCombo: (comboId: string, qty: number, forRef?: string, forLineId?: string) => {
    const plan = planUpgrade(cartState.lines, comboId, qty, forRef, forLineId);
    if ("error" in plan) return plan;
    dispatch(plan.action);
    return { upgraded: plan.upgraded, from: plan.from, absorbed: plan.absorbed, drinkPicked: plan.drinkPicked };
  },
  removeAddon: (addonId: string, qty?: number, forRef?: string, forLineId?: string) => {
    const plan = planRemoveAddon(cartState.lines, addonId, qty, forRef, forLineId);
    if ("error" in plan) return plan;
    dispatch(plan.action);
    return { removed: plan.removed, itemName: plan.itemName };
  },
  setChoices: (kind: ChoiceKind, choices: string[], qty?: number, forRef?: string, forLineId?: string) => {
    const plan = planChoices(cartState.lines, kind, choices, qty, forRef, forLineId);
    if ("error" in plan) return plan;
    dispatch(plan.action);
    return { set: plan.set, itemName: plan.itemName };
  },
  removeLine: (lineId: string) => dispatch({ type: "REMOVE_LINE", lineId }),
  updateQty: (lineId: string, qty: number) => dispatch({ type: "UPDATE_QTY", lineId, qty }),
  clearCart: () => dispatch({ type: "CLEAR_CART" }),
  setDiscount: (discount: CartContextValue["state"]["discount"]) => dispatch({ type: "SET_DISCOUNT", discount }),
  setPaymentMethod: (method: CartContextValue["state"]["paymentMethod"]) => dispatch({ type: "SET_PAYMENT_METHOD", method }),
  setStage: (stage: CartContextValue["state"]["stage"]) => dispatch({ type: "SET_STAGE", stage }),
  confirmOrder: () => (dispatch({ type: "CONFIRM_ORDER", orderNumber: "JB-0001" }), "JB-0001"),
} as unknown as CartContextValue;
const HANDLERS = createToolHandlers(cart, {
  openCheckout: () => {},
  onHandoff: (reason, kind) => console.log(`     HANDOFF TO CREW [${kind}]: ${reason}`),
});
const orderText = () =>
  cartState.lines.map((l) => `${l.qty}× ${l.name}${l.modifiers.length ? ` (${modifierLabel(l)})` : ""}`).join(" | ") +
  ` = ₱${computeTotals(cartState).total}`;

for (const line of existsSync(".env.local") ? readFileSync(".env.local", "utf-8").split("\n") : []) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.OPENAI_API_KEY!;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
// One argument per customer turn: each is spoken after Joy finishes replying.
const SAYS = process.argv.length > 2 ? process.argv.slice(2) : ["Isang 1-pc Chickenjoy Combo po."];

async function tts(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`tts ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer()); // 24 kHz, 16-bit mono PCM
}

function runTool(name: string, args: string) {
  const handler = HANDLERS[name];
  const result = handler ? handler(JSON.parse(args || "{}")) : { error: `Unknown tool: ${name}` };
  if (result && typeof result === "object" && "error" in result) console.log("     TOOL ERROR", name, JSON.stringify(result));
  else console.log("     ORDER:", orderText());
  return result;
}

async function main() {
  const speeches = await Promise.all(SAYS.map(tts));
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, [
    "realtime",
    `openai-insecure-api-key.${KEY}`,
  ]);
  const t0 = Date.now();
  const log = (...a: unknown[]) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
  let greeted = false;
  let spoke = false;
  let textTurn = false;
  let active = false;
  let pending = false;
  let redrafted = false;
  let speechSeq = 0;
  let phraseDoneAt = 0;

  const send = (o: unknown) => ws.send(JSON.stringify(o));
  let turn = 0;
  let all: Buffer = Buffer.alloc(0);
  let i = 0;
  const speak = () => {
    spoke = true;
    log(`>>> sending customer audio: "${SAYS[turn]}"`);
    all = speeches[turn];
    i = 0;
    turn += 1;
    if (turn > 1) return;
    // Stream at real-time speed (200 ms chunks), like an open microphone:
    // the current phrase, then silence.
    setInterval(() => {
      const chunk = i < all.length ? all.subarray(i, i + 9600) : Buffer.alloc(9600);
      if (i < all.length && i + 9600 >= all.length) phraseDoneAt = Date.now();
      send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
      i += 9600;
    }, 200);
  };

  ws.onopen = () =>
    send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: buildSystemInstructions(),
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        audio: {
          input: {
            turn_detection: { type: "semantic_vad", create_response: false, interrupt_response: true, ...(process.env.VAD_EAGERNESS && { eagerness: process.env.VAD_EAGERNESS }) },
            transcription: { model: "whisper-1", language: "tl" },
          },
          output: { speed: VOICE_SPEED },
        },
      },
    });

  let customerLang: CustomerLanguage = "tl";
  let transcriptPending = false;
  let onTranscript: Array<() => void> = [];
  const afterTranscript = (fn: () => void) => {
    if (!transcriptPending) return fn();
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    onTranscript.push(run);
    setTimeout(run, 1500);
  };
  const transcriptArrived = () => { transcriptPending = false; const w = onTranscript; onTranscript = []; w.forEach((f) => f()); };
  const instr = (extra = "") => `${buildSystemInstructions()}${extra}${languageNote(customerLang)}`;
  ws.onmessage = (m) => {
    const e = JSON.parse(String(m.data));
    if (e.type === "response.output_audio.delta" && !(globalThis as { firstAudio?: boolean }).firstAudio) { (globalThis as { firstAudio?: boolean }).firstAudio = true; log("FIRST AUDIO"); }
    if (e.type.endsWith(".delta")) return;
    if (e.type === "error") log("ERROR", JSON.stringify(e.error));
    else if (e.type === "conversation.item.input_audio_transcription.completed") { log(e.type, JSON.stringify(e.transcript)); customerLang = detectLanguage(String(e.transcript)) ?? customerLang; log("LANG", customerLang); transcriptArrived(); }
    else if (e.type === "conversation.item.input_audio_transcription.failed") { log(e.type, JSON.stringify(e.error)); transcriptArrived(); }
    else if (e.type === "response.output_audio_transcript.done") log("JOY SAID:", JSON.stringify(e.transcript));
    else if (e.type === "response.done") {
      active = false;
      if (pending && e.response?.status === "cancelled") { pending = false; send({ type: "response.create", response: { output_modalities: ["text"], instructions: instr() } }); log("response.done cancelled → redraft"); return; }
      const calls: Array<{ name: string; arguments: string; call_id: string }> = (e.response?.output ?? []).filter((o: { type: string }) => o.type === "function_call");
      log("response.done", JSON.stringify(e.response?.output_modalities), (e.response?.output ?? []).map((o: {type: string}) => o.type).join(","), e.response?.status, JSON.stringify(e.response?.status_details ?? null), calls.map((c: { name: string; arguments: string; call_id: string }) => `${c.name}(${c.arguments})`).join(" "));
      for (const c of calls) {
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: JSON.stringify(runTool(c.name, c.arguments)) } });
      }
      if (calls.length) afterTranscript(() => send({ type: "response.create", response: { output_modalities: ["audio"], instructions: instr() } }));
      else if (e.response?.output_modalities?.[0] === "text" || textTurn) {
        // Small talk: drop the silent text draft and ask for the spoken reply.
        textTurn = false;
        const msgs = (e.response?.output ?? []).filter((o: { type: string }) => o.type === "message");
        const draft = (msgs.at(-1)?.content?.[0]?.text ?? "").replace(/\p{Extended_Pictographic}/gu, "");
        const announces = /\b(sandali lang|saglit lang|aayusin ko|ayusin ko|i-?a-?add ko|idadagdag ko|ilalagay ko|gagawin ko|let me|i'?ll (add|get|put|make|update|change))\b/i;
        log("TEXT DRAFT:", JSON.stringify(draft));
        const wrongLanguage = customerLang === "en" && detectLanguage(draft) === "tl";
        if (!redrafted && (announces.test(draft) || wrongLanguage)) {
          redrafted = true;
          log("REDRAFT (draft only announced an action)");
          for (const o of msgs) send({ type: "conversation.item.delete", item_id: o.id });
          send({ type: "response.create", response: { output_modalities: ["text"], instructions: wrongLanguage ? instr() : instr("\n\nRIGHT NOW: don't announce it — make the customer's change with the tool calls straight away, then confirm.") } });
          return;
        }
        // Like the kiosk: the draft stays as the reply; an out-of-band read-aloud voices it.
        for (const o of msgs.slice(0, -1)) send({ type: "conversation.item.delete", item_id: o.id });
        if (!draft) send({ type: "response.create", response: { output_modalities: ["audio"], instructions: instr() } });
        else send({ type: "response.create", response: { conversation: "none", input: [], output_modalities: ["audio"], tool_choice: "none", instructions: `You are Joy, a warm, upbeat Filipina Jollibee crew member. Read this line aloud exactly as written, in its own language, warmly and naturally — nothing before it, nothing after it, no translation:\n${draft}` } });
        return;
      }
      textTurn = false;
      if (!greeted) { greeted = true; speak(); }
      // Finished only once the customer's phrase has fully played (plus a beat) —
      // otherwise the second half of a split sentence was never heard.
      else if (spoke && e.response?.status === "completed" && calls.length === 0 && i >= all.length && Date.now() - phraseDoneAt > 2500) {
        if (turn < SAYS.length) setTimeout(speak, 1500);
        else setTimeout(() => { log("done"); ws.close(); process.exit(0); }, 1500);
      }
    } else log(e.type);
    if (e.type === "response.created") active = true;
    if (e.type === "input_audio_buffer.speech_stopped") log("speech_stopped");
    if (e.type === "input_audio_buffer.speech_started") speechSeq += 1;
    if (e.type === "input_audio_buffer.committed") transcriptPending = true;
    if (e.type === "input_audio_buffer.committed" && greeted) {
      // Like the kiosk: wait a beat — if the customer is talking again, the next commit drafts.
      const seq = speechSeq;
      setTimeout(() => {
        if (speechSeq !== seq) return log("(still talking — waiting for the rest)");
        // First pass after the customer speaks is text-only, so any "sige, i-add ko…" filler is never voiced.
        redrafted = false;
        if (active) { pending = true; send({ type: "response.cancel" }); }
        else send({ type: "response.create", response: { output_modalities: ["text"], instructions: instr() } });
      }, 250);
    }
    if (e.type === "response.output_text.done") log("TEXT:", JSON.stringify(e.text));
    if (e.type === "session.updated" && !greeted) {
      // Like the kiosk: the greeting was pre-recorded and already played, so
      // it goes into the conversation as something Joy said — no live greeting.
      greeted = true;
      const g = GREETINGS[0];
      log("PRE-RECORDED GREETING:", JSON.stringify(g.text));
      send({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: g.text }] } });
      speak();
    }
  };
  ws.onerror = (e) => log("ws error", e);
  setTimeout(() => { log("timeout"); ws.close(); process.exit(0); }, 60000 * SAYS.length);
}
main();
