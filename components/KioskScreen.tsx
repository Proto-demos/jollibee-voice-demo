"use client";

import { useEffect, useState } from "react";
import { ActionFeed } from "./ActionFeed";
import { MenuDrawer } from "./MenuDrawer";
import { CheckoutModal } from "./CheckoutModal";
import { TranscriptPanel } from "./TranscriptPanel";
import { VoiceOrb } from "./VoiceOrb";
import { useCart } from "@/lib/cart";
import {
  useRealtimeVoice,
  type ActionCard,
  type TranscriptEntry,
} from "@/lib/voice/useRealtimeVoice";
import type { UpsellSuggestion } from "@/lib/voice/tools";

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
    items: [
      { name: "1-pc Chickenjoy Combo", price: 179, image: "/menu/combo-chickenjoy-1pc.png" },
      { name: "Cheesy Yumburger Combo", price: 129, image: "/menu/combo-cheesy-yumburger.png" },
      { name: "1-pc Chickenjoy Solo", price: 98, image: "/menu/chickenjoy-1pc-solo.png" },
    ],
  },
  { id: 2, kind: "added", title: "1-pc Chickenjoy Combo", qty: 1, price: 179, image: "/menu/combo-chickenjoy-1pc.png", total: 179 },
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
  { id: 2, role: "user", text: "Isang Chickenjoy Combo po." },
  { id: 3, role: "assistant", text: "Sige po! Gusto niyo rin po ng Peach-Mango Pie, ₱45 lang?" },
];

export function KioskScreen() {
  const cart = useCart();
  const [preview, setPreview] = useState(false);

  const voice = useRealtimeVoice({ openCheckout: () => cart.setStage("checkout") });

  // Stage is the single source of truth: the modal is open for checkout AND
  // the confirmation screen, closed only while ordering — so Joy's tool calls
  // (start_checkout / resume_ordering / clear_cart) fully control it.
  const checkoutOpen = cart.state.stage !== "ordering";

  useEffect(() => {
    // One-time post-mount read; window isn't available during SSR, so this
    // can't be a useState initializer without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(new URLSearchParams(window.location.search).get("preview") === "voice");
  }, []);

  const status = preview ? "listening" : voice.status;
  const actions = preview ? PREVIEW_ACTIONS : voice.actions;
  const suggestion = preview ? PREVIEW_SUGGESTION : voice.suggestions[0];
  const transcript = preview ? PREVIEW_TRANSCRIPT : voice.transcript;
  const isActive = status === "connecting" || status === "listening" || status === "speaking";

  const itemCount = cart.state.lines.reduce((n, l) => n + l.qty, 0);
  const showTotal = (preview || itemCount > 0) && isActive;
  const totalValue = preview ? 179 : cart.totals.total;
  const totalCount = preview ? 1 : itemCount;

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
          {isActive && (
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white/75">
              ● {STATUS_LABEL[status]}
            </span>
          )}
        </header>

        <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 overflow-y-auto">
          <div className="my-auto flex flex-col items-center gap-5 w-full py-2">
          <VoiceOrb
            status={status}
            onClick={() => (isActive ? voice.stop() : voice.start())}
            getLevel={preview ? () => 0 : voice.getAudioLevel}
          />

          {!isActive ? (
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
              <ActionFeed actions={actions} suggestion={suggestion} />
              {showTotal && (
                <div className="text-center">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/65">
                    Kabuuan · {totalCount} item
                  </p>
                  <p className="font-extrabold text-4xl leading-tight">₱{totalValue}</p>
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

      {checkoutOpen && <CheckoutModal />}
    </div>
  );
}
