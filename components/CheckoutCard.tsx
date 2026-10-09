"use client";

import { DISCOUNT_LABELS, formatPeso, modifierLabel, useCart } from "@/lib/cart";

const PAYMENT_LABELS: Record<string, { label: string; icon: string }> = {
  cash: { label: "Cash", icon: "💵" },
  card: { label: "Card", icon: "💳" },
  qr: { label: "QR (GCash/Maya)", icon: "📱" },
};

/**
 * Everything here is a read-out of cart state, advanced only by Joy's tool
 * calls (start_checkout / apply_discount / set_payment_method / confirm_order
 * / resume_ordering / clear_cart) — there is deliberately no clickable way to
 * navigate checkout. The one exception is the card gateway: paying by card
 * is a real manual step in life, so that's the only button here.
 *
 * Shown inside the voice stage in place of the order cards (not as a modal),
 * so it stays centred under the mic and Joy's listening rings stay visible.
 */
export function CheckoutCard() {
  const { state, totals, confirmOrder } = useCart();

  const title = (() => {
    if (state.stage === "confirmed") return "Kumpirmado na ang order!";
    if (!state.discountDecided) return "May discount po ba?";
    if (!state.paymentMethod) return "Paano po kayo magbabayad?";
    if (state.paymentMethod === "card") return "Bayad gamit ang card";
    return "Kinukumpirma ang order…";
  })();

  return (
    <div className="relative z-10 w-full max-w-md">
      <div className="card-in bg-white text-foreground rounded-2xl overflow-hidden shadow-[0_16px_40px_-16px_rgba(0,0,0,0.45)]">
        <div className="bg-jb-yellow text-jb-red-dark px-5 py-4">
          <h2 className="font-extrabold text-lg">{title}</h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            {state.lines.map((line) => (
              <div key={line.lineId} className="flex justify-between gap-3 text-sm">
                <span>
                  {line.qty}× {line.name}
                  {line.modifiers.length > 0 && (
                    <span className="block text-[12px] text-neutral-500">+ {modifierLabel(line)}</span>
                  )}
                </span>
                <span className="font-semibold shrink-0">{formatPeso(line.unitPrice * line.qty)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-[#E5DACB] pt-3 flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{formatPeso(totals.subtotal)}</span>
          </div>

          {!state.discountDecided && (
            <p className="text-sm text-neutral-500">
              Sabihin kay Joy kung may Senior Citizen / PWD ID kayo, o ibigay ang promo code
              niyo kung mayroon.
            </p>
          )}

          {state.discountDecided && (
            <div className="flex justify-between text-sm text-jb-red-dark">
              <span>{DISCOUNT_LABELS[state.discount]}</span>
              <span>{state.discount === "none" ? "—" : `−${formatPeso(totals.discountAmount)}`}</span>
            </div>
          )}

          {state.discountDecided && !state.paymentMethod && (
            <>
              <p className="text-sm text-neutral-500">
                Sabihin kay Joy kung paano kayo magbabayad — cash, card, o QR.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(PAYMENT_LABELS).map(([id, opt]) => (
                  <div
                    key={id}
                    className="rounded-xl border border-[#EDE7DD] px-2 py-3 text-center text-neutral-300"
                  >
                    <div className="text-2xl grayscale opacity-50">{opt.icon}</div>
                    <div className="text-xs font-semibold mt-1">{opt.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {state.discountDecided && state.stage !== "confirmed" && (
            <div className="border-t border-dashed border-[#E5DACB] pt-3 flex justify-between font-bold">
              <span>Babayaran</span>
              <span>{formatPeso(totals.total)}</span>
            </div>
          )}

          {state.paymentMethod === "qr" && state.stage !== "confirmed" && (
            <div className="flex flex-col items-center gap-2 py-3">
              <div className="w-36 h-36 rounded-lg bg-[repeating-conic-gradient(#241412_0_25%,white_0_50%)] bg-[length:12px_12px] border-4 border-[#EDE7DD]" />
              <p className="text-xs text-neutral-500">I-scan para magbayad · demo QR</p>
              <p className="text-xs text-neutral-400">Kukumpirmahin ni Joy kapag bayad na.</p>
            </div>
          )}

          {state.paymentMethod === "cash" && state.stage !== "confirmed" && (
            <div className="rounded-xl border border-dashed border-[#E5DACB] p-4 text-center text-xs text-neutral-500">
              Magbayad po sa counter. Kukumpirmahin ni Joy ang order niyo.
            </div>
          )}

          {state.paymentMethod === "card" && state.stage !== "confirmed" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#EDE7DD] p-4 space-y-2">
                <div className="text-xs text-neutral-400 uppercase tracking-wide">
                  Card payment gateway (demo)
                </div>
                <div className="h-10 rounded-lg bg-background flex items-center px-3 text-sm text-neutral-400">
                  •••• •••• •••• 4242
                </div>
                <div className="flex gap-2">
                  <div className="h-10 flex-1 rounded-lg bg-background flex items-center px-3 text-sm text-neutral-400">
                    12/29
                  </div>
                  <div className="h-10 flex-1 rounded-lg bg-background flex items-center px-3 text-sm text-neutral-400">
                    CVC
                  </div>
                </div>
              </div>
              <button
                onClick={() => confirmOrder()}
                className="w-full rounded-full bg-jb-red text-white font-bold py-3 hover:bg-jb-red-dark"
              >
                Bayaran — {formatPeso(totals.total)}
              </button>
            </div>
          )}

          {state.stage === "confirmed" && (
            <div className="text-center space-y-3 py-4">
              <div className="text-5xl">✅</div>
              <p className="font-bold text-xl">Order #{state.orderNumber}</p>
              <p className="text-sm text-neutral-500">
                Salamat po! Hintayin lang tawagin ang pangalan niyo sa counter.
              </p>
              <div className="flex justify-between font-bold border-t border-dashed border-[#E5DACB] pt-3">
                <span>Nabayaran</span>
                <span>{formatPeso(totals.total)}</span>
              </div>
              <p className="text-xs text-neutral-400 pt-2">
                Sabihin lang kay Joy kung gusto niyong mag-order ulit.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
