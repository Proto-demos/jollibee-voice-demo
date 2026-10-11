"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DISCOUNT_LABELS, useCart, type DiscountType } from "@/lib/cart";
import { ADDONS, COMBOS, MENU_ITEMS, findAddon, findCombo, findMenuItem, findOrderable, findProduct, getFeaturedBestsellers } from "@/lib/menu";
import { buildSystemInstructions } from "./prompt";
import { detectLanguage, languageNote, type CustomerLanguage } from "./language";
import { pickGreeting, type Greeting } from "./greeting";
import { createToolHandlers, TOOL_DEFINITIONS, type HandoffKind, type UpsellSuggestion } from "./tools";
import { GREETING_PLAYBACK_RATE, VOICE_SPEED } from "./config";

export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

export interface TranscriptEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
}

/**
 * A fact card shown on the voice stage — the screen shows only what happened
 * (items, prices, totals); Joy's voice carries everything else.
 */
export interface ActionCard {
  id: number;
  kind: "bestsellers" | "options" | "added" | "removed" | "qty" | "discount" | "payment" | "confirmed";
  title: string;
  qty?: number;
  price?: number;
  image?: string;
  /** Running order total after this action. */
  total?: number;
  /** For the bestsellers welcome card and the products Joy is talking about. */
  items?: Array<{ name: string; price: number; image?: string }>;
}

interface RealtimeEvent {
  type: string;
  delta?: string;
  transcript?: string;
  response?: { output?: RealtimeOutputItem[]; output_modalities?: string[]; status?: string };
  [key: string]: unknown;
}

interface RealtimeOutputItem {
  type: string;
  id?: string;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  call_id?: string;
  arguments?: string;
}

const PAYMENT_TITLES: Record<string, string> = {
  cash: "Bayad — Cash sa counter",
  card: "Bayad — Card",
  qr: "Bayad — QR (GCash/Maya)",
};

/** Hyphens read as spaces ("Peach Mango Pie") and "one-piece" as "1-pc", as Joy says them. */
const normalise = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/-/g, " ")
    .replace(/\b(one|1) piece\b/g, "1 pc")
    .replace(/\b(two|2) piece\b/g, "2 pc")
    .replace(/\b(six|6) piece\b/g, "6 pc")
    .replace(/\s+/g, " ");

/** Every product Joy could pitch, by spoken name — add-ons first so a shared name resolves to the add-on. */
const PITCHABLE: UpsellSuggestion[] = (() => {
  const seen = new Set<string>();
  const all: UpsellSuggestion[] = [
    ...ADDONS.filter((a) => a.category !== "choice").map((a) => ({ refId: a.id, kind: "addon" as const, name: a.name, price: a.price, image: a.image })),
    ...COMBOS.map((c) => ({ refId: c.id, kind: "combo" as const, name: c.name, price: c.price, image: c.image })),
    ...MENU_ITEMS.map((i) => ({ refId: i.id, kind: "item" as const, name: i.name, price: i.price, image: i.image })),
  ];
  return all.filter((p) => !seen.has(normalise(p.name)) && seen.add(normalise(p.name)));
})();
/** How Joy actually says some add-ons. */
const SPOKEN_ALIASES: Array<[string, string]> = [
  ["upsize", "addon-upsize-drink"],
  ["extra gravy", "addon-gravy"],
  ["gravy", "addon-gravy"],
  ["sundae", "addon-sundae-chocolate"],
];

/** "Sandali lang", "aayusin ko 'yan", "I'll add that…" — saying what she's about to do instead of doing it. */
const ANNOUNCES_ACTION =
  /\b(sandali lang|saglit lang|aayusin ko|ayusin ko|i-?a-?add ko|idadagdag ko|ilalagay ko|gagawin ko|let me|i'?ll (add|get|put|make|update|change))\b/i;

/**
 * Read-aloud instructions for the silent draft. Sent as an out-of-band
 * response that sees nothing but this: with the conversation in view, the
 * voice pass sometimes added filler or said the line twice.
 */
/** "₱130" → "130 pesos", so the read-aloud never voices the sign as dollars. */
function spokenPrices(text: string): string {
  return text.replace(/₱\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 pesos");
}

function speakDraftInstructions(draft: string): string {
  return `You are Joy, a warm, upbeat Filipina Jollibee crew member. Read this line aloud exactly as written, in its own language, warmly and naturally — nothing before it, nothing after it, no translation:\n${spokenPrices(draft)}`;
}

/**
 * Words that make a sentence an offer rather than a description: a price, a
 * question, or a selling verb. "Naka-upsize na yung Cheesy Yumburger Combo
 * niyo." names a product but offers nothing.
 */
const OFFER_CUE = /\?|₱|\bpesos?\b|\b(gusto|pwede|puwede|try|idagdag|dagdag|lagyan|gawin|gawing|i-upsize|upsize|upgrade|add|want|like)\b/;

/** The sentence (in normalised text) around a position. */
function sentenceAt(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf(".", at), text.lastIndexOf("!", at), text.lastIndexOf("?", at - 1)) + 1;
  const ends = [".", "!", "?"].map((c) => text.indexOf(c, at)).filter((i) => i !== -1);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end);
}

export function findPitchedProduct(said: string, inOrder: string[]): UpsellSuggestion | undefined {
  const original = normalise(said);
  let text = original;
  const owned = new Set(inOrder.map(normalise));
  const terms: Array<[string, UpsellSuggestion]> = [
    ...PITCHABLE.map((p): [string, UpsellSuggestion] => [normalise(p.name), p]),
    ...SPOKEN_ALIASES.flatMap(([alias, id]): Array<[string, UpsellSuggestion]> => {
      const p = PITCHABLE.find((x) => x.refId === id);
      return p ? [[alias, p]] : [];
    }),
  ].sort((a, b) => b[0].length - a[0].length);
  let best: { at: number; product: UpsellSuggestion } | undefined;
  for (const [term, product] of terms) {
    let at = text.indexOf(term);
    while (at !== -1) {
      // Only an offer counts: the product isn't ordered yet, and its sentence pitches it.
      if (!owned.has(normalise(product.name)) && OFFER_CUE.test(sentenceAt(original, at)) && (!best || at > best.at)) {
        best = { at, product };
      }
      text = text.slice(0, at) + " ".repeat(term.length) + text.slice(at + term.length);
      at = text.indexOf(term);
    }
  }
  return best?.product;
}

function bestsellersCard(id: number): ActionCard {
  return {
    id,
    kind: "bestsellers",
    title: "Mga bestseller ngayon",
    items: getFeaturedBestsellers(),
  };
}

export function useRealtimeVoice({ openCheckout, onHandoff }: { openCheckout: () => void; onHandoff?: (reason: string, kind: HandoffKind) => void }) {
  const cart = useCart();
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [suggestions, setSuggestions] = useState<UpsellSuggestion[]>([]);
  /** Order item -> the accepted offer card's key it took over, so that card morphs in place. */
  const [morphKeys, setMorphKeys] = useState<Record<string, string>>({});
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  const idCounterRef = useRef(0);
  /** Mirror of the offer on screen, for matching it against what gets added. */
  const offerRef = useRef<UpsellSuggestion | undefined>(undefined);
  // Every offer gets its own card id; accepting it reuses that id for the
  // "added" card, so the same card transitions instead of being replaced.
  const showOffer = useCallback((next: UpsellSuggestion[]) => {
    const current = offerRef.current;
    const offer = next[0]
      ? { ...next[0], cardId: current?.refId === next[0].refId ? current.cardId : ++idCounterRef.current }
      : undefined;
    offerRef.current = offer;
    setSuggestions(offer ? [offer] : []);
  }, []);

  const uiRef = useRef({ openCheckout, onSuggest: showOffer, onHandoff });
  useEffect(() => {
    uiRef.current = { openCheckout, onSuggest: showOffer, onHandoff };
  }, [openCheckout, showOffer, onHandoff]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const greetedRef = useRef(false);
  /** Joy handed the customer to the crew: the mic is off and nothing they say is taken. */
  const handedOverRef = useRef(false);
  /** Whether Joy put an offer or list on screen herself since the customer last spoke. */
  const offerShownRef = useRef(false);
  /** The greeting names the bestsellers (already on their own card) — no offer from it. */
  const customerSpokeRef = useRef(false);
  /** Names of what was added since the customer last spoke. */
  const addedThisTurnRef = useRef<string[]>([]);
  /** A response is in flight — creating another one now would be rejected. */
  const responseActiveRef = useRef(false);
  /** The customer finished another utterance while a response was in flight. */
  const pendingDraftRef = useRef(false);
  /** This turn's draft was already sent back once for announcing instead of acting. */
  const redraftedRef = useRef(false);
  /** Counts the customer's speech starts, to tell a finished turn from a pause mid-sentence. */
  const speechSeqRef = useRef(0);
  /** Counts committed customer turns, for the pause-wait watchdog. */
  const commitSeqRef = useRef(0);
  const assistantTextRef = useRef("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<AnalyserNode[]>([]);
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const nextId = () => {
    idCounterRef.current += 1;
    return idCounterRef.current;
  };

  const pushTranscript = useCallback((role: "user" | "assistant", text: string) => {
    if (!text.trim()) return;
    idCounterRef.current += 1;
    const id = idCounterRef.current;
    setTranscript((prev) => [...prev.slice(-30), { id, role, text: text.trim() }]);
  }, []);

  /**
   * Instantaneous loudness (0..1) across mic + Joy's voice — read per-frame by
   * the orb's ring animation, deliberately NOT React state (60fps updates).
   */
  const getAudioLevel = useCallback(() => {
    let max = 0;
    for (const analyser of analysersRef.current) {
      if (!levelDataRef.current || levelDataRef.current.length < analyser.fftSize) {
        levelDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      }
      const data = levelDataRef.current;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < analyser.fftSize; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      max = Math.max(max, Math.sqrt(sum / analyser.fftSize));
    }
    return Math.min(max * 2.5, 1);
  }, []);

  const attachAnalyser = useCallback((stream: MediaStream) => {
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analysersRef.current.push(analyser);
    } catch {
      // audio analysis is progressive enhancement — rings just stay static
    }
  }, []);

  /**
   * The pre-recorded greeting plays the instant the customer taps, while the
   * live session connects. `done` once it ends (mic opens); `failed` if it
   * couldn't play, in which case Joy greets live as before.
   */
  const greetingRef = useRef<{ greeting: Greeting; el: HTMLAudioElement; done: boolean; failed: boolean } | null>(null);

  /**
   * Joy's browse cards (bestsellers / the products she is naming) only matter
   * while she's talking about them: a new list replaces the old one. The order
   * itself is drawn straight from the cart.
   */
  const pushAction = useCallback((card: Omit<ActionCard, "id">) => {
    setActions([{ ...card, id: ++idCounterRef.current }]);
  }, []);

  const stop = useCallback(() => {
    greetingRef.current?.el.pause();
    greetingRef.current = null;
    dcRef.current?.close();
    pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioElRef.current?.remove();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analysersRef.current = [];
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    audioElRef.current = null;
    setActions([]);
    setMorphKeys({});
    showOffer([]);
    // During a handover the transcript stays, so the crew can read what was
    // said; it's cleared when they take over (clearTranscript).
    if (!handedOverRef.current) setTranscript([]);
    customerSpokeRef.current = false;
    offerShownRef.current = false;
    responseActiveRef.current = false;
    pendingDraftRef.current = false;
    setStatus("idle");
  }, [showOffer]);

  /** Turn a successful tool call into the fact card the customer should see. */
  const cardForToolCall = useCallback(
    (name: string, args: Record<string, unknown>, result: Record<string, unknown>): Omit<ActionCard, "id"> | null => {
      if (result && typeof result === "object" && "error" in result) return null;
      const total = typeof result?.total === "number" ? (result.total as number) : undefined;

      switch (name) {
        case "add_item":
        case "add_combo": {
          // Either tool takes either id (a combo id passed to add_item still adds the combo).
          const product = findProduct(String(args.item_id ?? args.combo_id));
          if (!product) return null;
          const qty = Number(args.quantity) || 1;
          return { kind: "added", title: product.name, qty, price: product.price, image: product.image, total };
        }
        case "add_addon": {
          // Fries, a dessert or a drink lands in the order as its menu item; extra gravy as itself.
          const addon = findAddon(String(args.addon_id));
          if (!addon) return null;
          const product = addon.itemId ? findMenuItem(addon.itemId) : undefined;
          const qty = Number(args.quantity) || 1;
          return { kind: "added", title: product?.name ?? addon.name, qty, price: addon.price, image: product?.image ?? addon.image, total };
        }
        case "upgrade_to_combo": {
          const combo = findCombo(String(args.combo_id));
          if (!combo) return null;
          return { kind: "added", title: combo.name, qty: Number(result?.upgraded) || 1, price: combo.price, image: combo.image, total };
        }
        case "remove_line": {
          const ref = String(args.ref_id);
          const name = typeof result?.removed === "string" ? (result.removed as string) : findOrderable(ref)?.data.name ?? ref;
          return { kind: "removed", title: name, total };
        }
        case "update_quantity": {
          const ref = String(args.ref_id);
          const name = typeof result?.changed === "string" ? (result.changed as string) : findOrderable(ref)?.data.name ?? ref;
          return { kind: "qty", title: name, qty: Number(args.quantity), total };
        }
        case "apply_discount": {
          const type = String(args.discount_type) as DiscountType;
          if (type === "none") return null;
          return { kind: "discount", title: DISCOUNT_LABELS[type] ?? type, total };
        }
        case "set_payment_method":
          return { kind: "payment", title: PAYMENT_TITLES[String(args.method)] ?? String(args.method), total };
        case "show_items": {
          const ids = Array.isArray(args.ids) ? args.ids.map(String).slice(0, 6) : [];
          const items = ids
            .map((id) => findOrderable(id)?.data)
            .filter((d): d is NonNullable<typeof d> => Boolean(d))
            .map((d) => ({ name: d.name, price: d.price, image: d.image }));
          if (!items.length) return null;
          return { kind: "options", title: String(args.title || "Para sa inyo"), items };
        }
        case "confirm_order":
          return {
            kind: "confirmed",
            title: `Order #${String(result?.order_number ?? "")}`,
            total,
          };
        default:
          return null;
      }
    },
    []
  );

  const handleToolCall = useCallback(
    (name: string, args: Record<string, unknown>) => {
      const handlers = createToolHandlers(cartRef.current, uiRef.current);
      const handler = handlers[name];
      if (!handler) return { error: `Unknown tool: ${name}` };
      try {
        const result = handler(args) as Record<string, unknown>;
        // Handed over: mute the customer straight away so Joy's one line isn't
        // interrupted, and take no more turns – the crew has the kiosk now.
        if (name === "handoff_to_crew" && !("error" in result)) {
          handedOverRef.current = true;
          streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
          setActions([]);
          showOffer([]);
        }
        if ((name === "show_offer" || name === "show_items") && !("error" in result)) offerShownRef.current = true;
        // Joy is asking which drink, not pitching: keep the offer-card safety
        // net from reading the drinks she lists as an offer.
        if (result && typeof result === "object" && "ask_first" in result) offerShownRef.current = true;
        if (typeof result?.next === "string" && result.next.includes("ask the drink")) offerShownRef.current = true;
        // Joy has to ask which combos get the upsize: show the upsize with the
        // choices, and keep the pitch safety net from reading her question
        // ("yung may Coke o yung may Sprite?") as a new offer.
        if (name === "add_addon" && Array.isArray(result?.choices)) {
          const addon = findAddon(String(args.addon_id));
          if (addon) {
            showOffer([
              {
                refId: addon.id,
                kind: "addon",
                name: addon.name,
                price: addon.price,
                image: addon.image,
                choices: (result.choices as Array<{ items: string }>).map((c) => c.items),
              },
            ]);
            offerShownRef.current = true;
          }
          return result;
        }
        // The upsize shows up under its combo's order card, which the stage
        // draws from the cart.
        if (name === "remove_addon" && !("error" in result)) {
          showOffer([]);
          return result;
        }
        if (name === "add_addon" && typeof result?.item_ref === "string") {
          const addon = findAddon(String(args.addon_id));
          if (addon) addedThisTurnRef.current.push(addon.name);
          showOffer([]);
          return result;
        }
        const card = cardForToolCall(name, args, result);
        if (card?.kind === "options") {
          pushAction(card);
          showOffer([]);
        } else if (card?.kind === "added" || card?.kind === "removed") {
          // The order changed: browsing is over, and any pending offer too.
          if (card.kind === "added") {
            addedThisTurnRef.current.push(card.title);
            // Accepted offer: the new order card takes over the offer card's
            // key, so it morphs in place rather than popping in as a new card.
            const offer = offerRef.current;
            // An upgrade's new card is the combo, not the item it came from;
            // an add-on's is the menu item it lands as.
            const refId = String(
              (name === "upgrade_to_combo"
                ? args.combo_id
                : name === "add_addon"
                  ? findAddon(String(args.addon_id))?.itemId ?? args.addon_id
                  : args.item_id ?? args.combo_id) ?? ""
            );
            if (offer && refId && normalise(offer.name) === normalise(card.title)) {
              setMorphKeys((prev) => ({ ...prev, [refId]: `offer-${offer.cardId ?? offer.refId}` }));
            }
          }
          setActions([]);
          showOffer([]);
        }
        if (name === "clear_cart") {
          setActions([]);
          setMorphKeys({});
        }
        return result;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    [cardForToolCall, pushAction, showOffer]
  );

  const start = useCallback(async () => {
    try {
      setErrorMessage(null);
      // After a dropped connection, close the dead session before starting a new one.
      if (pcRef.current) {
        dcRef.current?.close();
        pcRef.current.close();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        audioElRef.current?.remove();
      }
      setStatus("connecting");
      // Show the bestsellers straight away, while the session connects — the
      // card is fixed menu data, and Joy names the same three in her greeting.
      pushAction(bestsellersCard(nextId()));

      // Joy's greeting starts right away from a recording (still inside the
      // tap gesture, so autoplay allows it); the session connects meanwhile.
      // The audio context is created inside the tap too: one created later can
      // start suspended, and routing the greeting through it would mute it.
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      ctx.resume().catch(() => {});
      const greeting = pickGreeting();
      const greetEl = new Audio(greeting.audio);
      // The TTS recording reads slower than Joy speaks live; playing it faster
      // (pitch kept) matches her pace and opens the mic sooner.
      greetEl.playbackRate = GREETING_PLAYBACK_RATE;
      greetEl.preservesPitch = true;
      const greet = { greeting, el: greetEl, done: false, failed: false };
      greetingRef.current = greet;
      const openMic = () => {
        if (handedOverRef.current) return;
        streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = true));
        if (dcRef.current?.readyState === "open") setStatus("listening");
      };
      greetEl.addEventListener("ended", () => {
        greet.done = true;
        openMic();
      });
      greetEl
        .play()
        .then(() => {
          setStatus("speaking");
          pushTranscript("assistant", greeting.text);
          try {
            // Drive the orb rings from the recording too (only once the
            // context is running — a suspended one would mute the greeting).
            if (ctx.state !== "running") return;
            const source = ctx.createMediaElementSource(greetEl);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            analyser.connect(ctx.destination);
            analysersRef.current.push(analyser);
          } catch {
            // rings are progressive enhancement
          }
        })
        .catch(() => {
          greet.failed = true;
          openMic();
        });

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.style.display = "none";
      // In the DOM + explicit play(): detached audio elements can be silently
      // ignored by autoplay policies, which made Joy's greeting text-only.
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        audioEl.play().catch(() => {
          /* autoplay fallback — resolved by the user's start tap gesture */
        });
        attachAnalyser(e.streams[0]);
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Keep the mic closed while the greeting plays, so Joy doesn't hear herself.
      if (!greet.done && !greet.failed) stream.getAudioTracks().forEach((t) => (t.enabled = false));
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      attachAnalyser(stream);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      greetedRef.current = false;
      handedOverRef.current = false;
      dc.addEventListener("open", () => {
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              output_modalities: ["audio"],
              instructions: buildSystemInstructions(),
              tools: TOOL_DEFINITIONS,
              tool_choice: "auto",
              audio: {
                input: {
                  turn_detection: {
                    type: "semantic_vad",
                    // We create the response ourselves: a silent text draft first
                    // (see "input_audio_buffer.committed").
                    create_response: false,
                    interrupt_response: true,
                  },
                  // Hint Tagalog so whisper stops mis-detecting short words (e.g. "combo" came out as "콤보").
                  transcription: { model: "whisper-1", language: "tl" },
                },
                output: { speed: VOICE_SPEED },
              },
            },
          })
        );
        if (greet.done || greet.failed) setStatus("listening");
      });

      dc.addEventListener("close", () => setStatus("idle"));

      // Now and then the realtime connection goes silent (no events, no
      // error). Don't leave the customer on a frozen screen: if no reply has
      // started 8s after a draft was requested, ask once more; still nothing,
      // say the connection dropped. The order stays as it is.
      let lastResponseAt = 0;
      const DROPPED = "Nawala ang koneksyon — i-tap ang mic para ituloy.";
      const watchReply = (retry: () => void) => {
        const sentAt = Date.now();
        setTimeout(() => {
          if (dcRef.current !== dc || lastResponseAt >= sentAt) return;
          retry();
          setTimeout(() => {
            if (dcRef.current !== dc || lastResponseAt >= sentAt) return;
            setErrorMessage(DROPPED);
            setStatus("error");
          }, 8000);
        }, 8000);
      };
      // The customer's language, from their transcripts; every reply's
      // instructions say it outright (see language.ts).
      let customerLang: CustomerLanguage = "tl";
      const replyInstructions = (extra = "") => `${buildSystemInstructions()}${extra}${languageNote(customerLang)}`;
      // The transcript (and so the language) can land just after the draft's
      // tool calls; the spoken reply waits for it, at most 1.5s.
      let transcriptPending = false;
      let onTranscript: Array<() => void> = [];
      const afterTranscript = (fn: () => void) => {
        if (!transcriptPending) return fn();
        let done = false;
        const run = () => {
          if (done) return;
          done = true;
          fn();
        };
        onTranscript.push(run);
        setTimeout(run, 1500);
      };
      const transcriptArrived = () => {
        transcriptPending = false;
        const waiting = onTranscript;
        onTranscript = [];
        waiting.forEach((fn) => fn());
      };
      const sendDraft = () => {
        const create = () =>
          dc.send(
            JSON.stringify({
              type: "response.create",
              response: { output_modalities: ["text"], instructions: replyInstructions() },
            })
          );
        create();
        watchReply(create);
      };
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setErrorMessage(DROPPED);
          setStatus("error");
        }
      });

      dc.addEventListener("message", (e) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }

        switch (event.type) {
          case "session.updated":
            // Greet only after our instructions are confirmed applied —
            // firing response.create immediately after session.update raced
            // it, producing a greeting without our audio/persona config.
            if (!greetedRef.current) {
              greetedRef.current = true;
              if (greet.failed) {
                // The recording couldn't play — Joy greets live.
                dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
              } else {
                // She has already said the recorded greeting: put it in the
                // conversation so she carries on from there.
                dc.send(
                  JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "message",
                      role: "assistant",
                      content: [{ type: "output_text", text: greet.greeting.text }],
                    },
                  })
                );
              }
            }
            break;

          case "input_audio_buffer.committed": {
            if (handedOverRef.current) break;
            redraftedRef.current = false;
            transcriptPending = true;
            // The customer finished speaking — unless they start again right
            // away ("Hindi po, | pero dagdag pa po ng…"): the turn detector
            // can close the turn at the comma while the rest is already
            // coming. Wait a beat; if they're talking again, keep listening —
            // the next commit drafts a reply to all of it.
            const seq = speechSeqRef.current;
            const commit = ++commitSeqRef.current;
            setTimeout(() => {
              if (dcRef.current !== dc) return;
              if (speechSeqRef.current !== seq) {
                // Waiting for the rest of the sentence; but if that "speech" was
                // only a noise and no turn follows, answer anyway rather than
                // leave the customer hanging.
                setTimeout(() => {
                  if (commitSeqRef.current === commit && !responseActiveRef.current && dcRef.current === dc) sendDraft();
                }, 3000);
                return;
              }
              // Joy's first pass is text-only, so any "sige, i-add ko…" filler
              // before a tool call is never voiced — she acts first, then
              // speaks once. If a response is still running (they paused
              // mid-sentence), cancel it and draft again once it has stopped.
              if (responseActiveRef.current) {
                pendingDraftRef.current = true;
                dc.send(JSON.stringify({ type: "response.cancel" }));
              } else {
                sendDraft();
              }
            }, 250);
            break;
          }

          case "input_audio_buffer.speech_started":
            if (handedOverRef.current) break;
            speechSeqRef.current += 1;
            // The offer stays up while the customer answers — a "yes" turns
            // it into the added card; a "no" clears it once Joy replies.
            setStatus("listening");
            offerShownRef.current = false;
            customerSpokeRef.current = true;
            addedThisTurnRef.current = [];
            break;

          case "conversation.item.input_audio_transcription.failed":
            transcriptArrived();
            break;

          case "conversation.item.input_audio_transcription.completed":
            if (typeof event.transcript === "string") {
              pushTranscript("user", event.transcript);
              customerLang = detectLanguage(event.transcript) ?? customerLang;
            }
            transcriptArrived();
            break;

          case "response.created":
            lastResponseAt = Date.now();
            responseActiveRef.current = true;
            assistantTextRef.current = "";
            if (event.response?.output_modalities?.[0] !== "text") setStatus("speaking");
            break;

          case "response.output_audio_transcript.delta":
          case "response.audio_transcript.delta":
            if (typeof event.delta === "string") assistantTextRef.current += event.delta;
            break;

          case "response.output_audio_transcript.done":
          case "response.audio_transcript.done": {
            // Joy sometimes pitches without calling show_offer — still show
            // what she named, as long as it isn't already in the order.
            // If she replied without offering anything, the earlier offer is over.
            if (customerSpokeRef.current && !offerShownRef.current) {
              // "Already ordered": products in the order, what's inside its
              // combos, the drinks picked for them ("with Iced Tea"), the
              // upsize only once every copy has it (so "upsize the other one"
              // still shows), and anything added this turn — so her
              // confirmation of what she just added isn't read as a new pitch.
              const orderLines = cartRef.current.getState().lines;
              // Per combo: every copy of each combo that carries the add-on has it
              // (solo items never carry one, so they don't count).
              const onEveryCup = [...new Set(orderLines.flatMap((l) => l.modifiers))].filter((id) =>
                orderLines
                  .filter((l) => orderLines.some((m) => m.refId === l.refId && m.modifiers.includes(id)))
                  .every((l) => l.modifiers.includes(id))
              );
              const picked = orderLines.flatMap((l) => l.modifiers.map((id) => findAddon(id)?.shortName ?? "")).filter(Boolean);
              const inCombos = orderLines.flatMap((l) => findCombo(l.refId)?.itemIds.map((id) => findMenuItem(id)?.name ?? id) ?? []);
              const ordered = [
                ...orderLines.map((l) => l.name),
                ...onEveryCup.map((id) => findAddon(id)?.name ?? id),
                ...picked,
                ...inCombos,
              ];
              const lines = [...ordered, ...addedThisTurnRef.current];
              const pitched = findPitchedProduct(assistantTextRef.current, lines);
              showOffer(pitched ? [pitched] : []);
            }
            pushTranscript("assistant", assistantTextRef.current);
            assistantTextRef.current = "";
            break;
          }

          case "response.done": {
            responseActiveRef.current = false;
            setStatus("listening");
            if (event.response?.status === "cancelled") {
              if (pendingDraftRef.current) {
                pendingDraftRef.current = false;
                sendDraft();
              }
              break;
            }
            const output = event.response?.output ?? [];
            const functionCalls = output.filter((item) => item.type === "function_call");
            for (const item of functionCalls) {
              if (!item.name || !item.call_id) continue;
              let args: Record<string, unknown> = {};
              try {
                args = item.arguments ? JSON.parse(item.arguments) : {};
              } catch {
                // ignore malformed arguments, handler will get {}
              }
              const result = handleToolCall(item.name, args);
              dc.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: item.call_id,
                    output: JSON.stringify(result),
                  },
                })
              );
            }
            if (pendingDraftRef.current) {
              // More customer speech arrived meanwhile — answer that instead.
              pendingDraftRef.current = false;
              sendDraft();
            } else if (functionCalls.length > 0) {
              afterTranscript(() =>
                dc.send(
                  JSON.stringify({
                    type: "response.create",
                    response: { output_modalities: ["audio"], instructions: replyInstructions() },
                  })
                )
              );
            } else if (event.response?.output_modalities?.[0] === "text") {
              // Small talk — no action needed. Joy speaks her draft word for
              // word (a fresh audio pass tended to think out loud first); the
              // text copy is removed so the history doesn't hold it twice.
              const messages = output.filter((item) => item.type === "message");
              // Only the last message: an earlier one is "sige, aayusin ko…" filler.
              const draft = (messages.at(-1)?.content ?? [])
                .map((c) => c.text ?? "")
                .join(" ")
                .replace(/\p{Extended_Pictographic}/gu, "")
                .trim();
              // A draft that only announces an action ("sandali lang, aayusin
              // ko 'yan") isn't small talk: drop it and draft once more, to act.
              // An English speaker answered in Taglish: draft once more, in English.
              const wrongLanguage = customerLang === "en" && detectLanguage(draft) === "tl";
              if (!redraftedRef.current && (ANNOUNCES_ACTION.test(draft) || wrongLanguage)) {
                redraftedRef.current = true;
                for (const item of messages) {
                  if (item.id) dc.send(JSON.stringify({ type: "conversation.item.delete", item_id: item.id }));
                }
                dc.send(
                  JSON.stringify({
                    type: "response.create",
                    response: {
                      output_modalities: ["text"],
                      instructions: wrongLanguage
                        ? replyInstructions()
                        : replyInstructions(
                            "\n\nRIGHT NOW: don't announce it — make the customer's change with the tool calls straight away, then confirm."
                          ),
                    },
                  })
                );
                break;
              }
              if (!draft) {
                dc.send(
                  JSON.stringify({
                    type: "response.create",
                    response: { output_modalities: ["audio"], instructions: replyInstructions() },
                  })
                );
                break;
              }
              // The draft stays in the conversation as Joy's reply (earlier
              // filler messages go); a separate read-aloud voices it, seeing only
              // the line itself, so it can't add to it or repeat it.
              for (const item of messages.slice(0, -1)) {
                if (item.id) dc.send(JSON.stringify({ type: "conversation.item.delete", item_id: item.id }));
              }
              dc.send(
                JSON.stringify({
                  type: "response.create",
                  response: {
                    conversation: "none",
                    input: [],
                    output_modalities: ["audio"],
                    tool_choice: "none",
                    instructions: speakDraftInstructions(draft),
                  },
                })
              );
            }
            break;
          }

          // Handed over: close the session once Joy's line has fully played
          // (not on a timer, which clipped its last word).
          case "output_audio_buffer.stopped":
            if (handedOverRef.current) setTimeout(() => dcRef.current === dc && stop(), 400);
            break;

          case "error":
            console.error("Realtime error event", event);
            break;

          default:
            break;
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const resp = await fetch("/api/session", {
        method: "POST",
        body: offer.sdp,
        headers: { "Content-Type": "application/sdp" },
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Session request failed (${resp.status})`);
      }

      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
      stop();
    }
  }, [attachAnalyser, handleToolCall, pushAction, pushTranscript, showOffer, stop]);

  useEffect(() => () => stop(), [stop]);

  const clearTranscript = useCallback(() => setTranscript([]), []);

  return { status, actions, suggestions, morphKeys, transcript, errorMessage, getAudioLevel, start, stop, clearTranscript };
}
