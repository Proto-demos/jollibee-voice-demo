"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionFeed } from "./ActionFeed";
import { MenuDrawer } from "./MenuDrawer";
import { CheckoutCard } from "./CheckoutCard";
import { HandoffCard, type Handoff } from "./HandoffCard";
import { TranscriptPanel } from "./TranscriptPanel";
import { VoiceOrb } from "./VoiceOrb";
import { formatPeso, useCart } from "@/lib/cart";
import { getFeaturedBestsellers } from "@/lib/menu";
import {
  useRealtimeVoice,
  type ActionCard,
  type TranscriptEntry,
} from "@/lib/voice/useRealtimeVoice";
import type { HandoffKind, UpsellSuggestion } from "@/lib/voice/tools";

const STATUS_LABEL: Record<string, string> = {
  connecting: "Kumokonekta…",
  listening: "Nakikinig…",
  speaking: "Nagsasalita…",
};

/** Sample content for `?preview=voice` — tweak the stage UI without a mic. */
const PREVIEW_ACTIONS: ActionCard[] = [
  {
    id: 1,
    kind: "bestsellers",
    title: "Mga bestseller ngayon",
    items: getFeaturedBestsellers(),
  },
];
const PREVIEW_SUGGESTION: UpsellSuggestion = {
  refId: "addon-peach-mango-pie",
  kind: "addon",
  name: "Peach-Mango Pie",
  price: 45,
  image: "/menu/peach-mango-pie.png",
};
const PREVIEW_TRANSCRIPT: TranscriptEntry[] = [
  { id: 1, role: "assistant", text: "Hi po, welcome sa Jollibee! Ano pong gusto niyo ngayon?" },
  { id: 2, role: "user", text: "Isang 1-pc Chickenjoy Combo po, Sprite, upsize na rin." },
  { id: 3, role: "assistant", text: "Sige po! Bagay diyan ang Peach-Mango Pie, ₱45 lang – idagdag ko na po?" },
];
/** Sample conversation for `?preview=handoff` – a question Joy passes to the crew. */
const PREVIEW_HANDOFF_TRANSCRIPT: TranscriptEntry[] = [
  { id: 1, role: "assistant", text: "Hi po, welcome sa Jollibee! Ano pong gusto niyo ngayon?" },
  { id: 2, role: "user", text: "Sino ang presidente ng Pilipinas?" },
  { id: 3, role: "assistant", text: "Sandali lang po, ikokonekta ko kayo sa aming crew." },
];

export function KioskScreen() {
  const cart = useCart();
  const [preview, setPreview] = useState(false);

  // A customer Joy handed to a live crew member (prank, abuse, threat, asked for a person).
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  // Joy says her one line, then her session closes – the crew has the kiosk now.
  const stopRef = useRef<() => void>(() => {});
  // Bumped on every handover, take-over and reset, so a stale safety-net
  // timer never closes the next customer's session.
  const handoffSeqRef = useRef(0);
  const onHandoff = useCallback((reason: string, kind: HandoffKind) => {
    setHandoff({ reason, kind, takenOver: false });
    // Joy's session closes itself once her handover line has played; this is only a safety net.
    const seq = ++handoffSeqRef.current;
    setTimeout(() => {
      if (handoffSeqRef.current === seq) stopRef.current();
    }, 12000);
  }, []);
  const voice = useRealtimeVoice({ openCheckout: () => cart.setStage("checkout"), onHandoff });
  useEffect(() => {
    stopRef.current = voice.stop;
  }, [voice.stop]);

  /** A crew member steps in: Joy steps back, and the conversation is theirs. */
  const takeOver = () => {
    handoffSeqRef.current += 1;
    voice.stop();
    voice.clearTranscript();
    cart.clearCart();
    setHandoff((h) => (h ? { ...h, takenOver: true } : h));
    setPreview(false);
  };
  /** Ready for the next customer: a clean kiosk with the mic back on. */
  const nextCustomer = () => {
    handoffSeqRef.current += 1;
    voice.stop();
    voice.clearTranscript();
    cart.clearCart();
    setHandoff(null);
    setPreview(false);
  };

  // Stage is the single source of truth: the checkout card replaces the order
  // cards for checkout AND the confirmation screen, and goes away only while
  // ordering — so Joy's tool calls (start_checkout / resume_ordering /
  // clear_cart) fully control it.
  const checkoutOpen = cart.state.stage !== "ordering";

  useEffect(() => {
    // One-time post-mount read; window isn't available during SSR, so this
    // can't be a useState initializer without a hydration mismatch.
    const mode = new URLSearchParams(window.location.search).get("preview");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(mode === "voice" || mode === "checkout" || mode === "handoff");
    // `?preview=handoff`: a customer Joy passed to the crew.
    if (mode === "handoff") setHandoff({ reason: "Asked to speak to a manager", kind: "request", takenOver: false });
    // `?preview=voice`: a sample order on the stage (the cards come from the cart).
    if (mode === "voice") {
      cart.addCombo("combo-chickenjoy-1pc");
      cart.setChoices("drinks", ["drink-sprite"], 1, "combo-chickenjoy-1pc");
      cart.applyAddon("addon-upsize-drink", 1, "combo-chickenjoy-1pc");
    }
    // `?preview=checkout`: a sample order sitting at the payment step.
    if (mode === "checkout") {
      cart.addCombo("combo-cheesy-yumburger", 2);
      cart.setChoices("drinks", ["drink-coke"], 1, "combo-cheesy-yumburger");
      cart.setChoices("drinks", ["drink-iced-tea"], 1, "combo-cheesy-yumburger");
      cart.addItem("peach-mango-pie");
      cart.setStage("checkout");
      cart.setDiscount("none");
      cart.setPaymentMethod("cash");
    }
    // Runs once on mount; the cart actions are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = preview ? "listening" : voice.status;
  const actions = preview ? PREVIEW_ACTIONS : voice.actions;
  const suggestion = preview ? PREVIEW_SUGGESTION : voice.suggestions[0];
  const transcript = preview ? (handoff ? PREVIEW_HANDOFF_TRANSCRIPT : PREVIEW_TRANSCRIPT) : voice.transcript;
  // Once Joy has handed over, her session is winding down: no live order UI.
  const isActive = !handoff && (status === "connecting" || status === "listening" || status === "speaking");

  const itemCount = cart.state.lines.reduce((n, l) => n + l.qty, 0);
  const showTotal = itemCount > 0 && isActive;
  const totalValue = cart.totals.total;
  const totalCount = itemCount;

  return (
    <div className="h-full flex flex-col lg:grid lg:grid-cols-[auto_minmax(0,1fr)_min(38vw,560px)] overflow-hidden">
      <TranscriptPanel entries={transcript} />

      {/* ================= voice stage ================= */}
      <section className="relative flex-1 lg:flex-none bg-gradient-to-br from-jb-red to-jb-red-dark text-white flex flex-col min-h-0 pb-[88px] lg:pb-0">
        <header className="flex items-center justify-between px-5 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-lg">
              🐝
            </span>
            <b className="font-extrabold text-[15px]">Jollibee</b>
          </div>
          {isActive ? (
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/75">
              ● {STATUS_LABEL[status]}
            </span>
          ) : handoff && !handoff.takenOver ? (
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-jb-yellow">
              ● Live agent
            </span>
          ) : null}
        </header>

        <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 overflow-y-auto">
          <div className="my-auto flex flex-col items-center gap-5 w-full py-2">
          {/* Handed to the crew: no mic, so nobody restarts Joy on a customer a person now has. */}
          {!handoff && (
            <VoiceOrb
              status={status}
              onClick={() => (isActive ? voice.stop() : voice.start())}
              getLevel={preview ? () => 0 : voice.getAudioLevel}
            />
          )}

          {handoff ? (
            <HandoffCard handoff={handoff} onTakeOver={takeOver} onNextCustomer={nextCustomer} />
          ) : checkoutOpen ? (
            <CheckoutCard />
          ) : !isActive ? (
            <>
              <div className="text-center">
                <p className="font-extrabold text-2xl">Kausapin si Joy</p>
                <p className="text-sm text-white/85 mt-1">
                  {status === "error"
                    ? voice.errorMessage || "Nagka-problema — subukan ulit"
                    : "I-tap ang mic para magsimula"}
                </p>
              </div>
              <p className="text-sm text-white/80 text-center max-w-[30ch]">
                Sabihin lang ang gusto niyo — hal.{" "}
                <b className="text-jb-yellow">&ldquo;Isang Chickenjoy Combo po&rdquo;</b>
              </p>
            </>
          ) : (
            <>
              <ActionFeed
                actions={actions}
                lines={cart.state.lines}
                suggestion={suggestion}
                morphKeys={preview ? {} : voice.morphKeys}
              />
              {showTotal && (
                <div className="text-center">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/65">
                    Kabuuan · {totalCount} item
                  </p>
                  <p className="font-extrabold text-4xl leading-tight">{formatPeso(totalValue)}</p>
                </div>
              )}
            </>
          )}
          </div>
        </div>

        {isActive && (
          <footer className="flex items-center justify-between px-5 py-3.5 shrink-0 text-white/75">
            <span className="text-xs">Sabihin lang — nakikinig si Joy</span>
            <button
              onClick={voice.stop}
              className="text-xs font-semibold hover:text-white border border-white/30 rounded-full px-3.5 py-1.5"
            >
              Tapusin
            </button>
          </footer>
        )}
      </section>

      {/* ================= menu drawer ================= */}
      <MenuDrawer />
    </div>
  );
}
