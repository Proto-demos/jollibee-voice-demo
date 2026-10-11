"use client";

import type { HandoffKind } from "@/lib/voice/tools";

/** A customer Joy passed to a live crew member; `takenOver` once a person has stepped in. */
export interface Handoff {
  reason: string;
  kind: HandoffKind;
  takenOver: boolean;
}

const HANDOFF_LABEL: Record<HandoffKind, string> = {
  prank: "Prank / hindi totoong order",
  abuse: "Bastos na customer",
  threat: "🚨 BANTA – tawagan ang security / manager",
  request: "Gusto makausap ang crew",
  complaint: "May reklamo",
};

/**
 * Shown in the voice stage in place of the mic once Joy hands over: the
 * customer sees that a person is coming, and the crew sees why, with the
 * button to take over. Joy's mic stays off until the kiosk is reset.
 */
export function HandoffCard({
  handoff,
  onTakeOver,
  onNextCustomer,
}: {
  handoff: Handoff;
  onTakeOver: () => void;
  onNextCustomer: () => void;
}) {
  const threat = handoff.kind === "threat";

  return (
    <div className="card-in relative z-10 w-full max-w-md bg-white text-foreground rounded-2xl overflow-hidden shadow-[0_16px_40px_-16px_rgba(0,0,0,0.45)]">
      {/* What the customer sees */}
      <div className="px-6 pt-7 pb-6 text-center">
        <div className="text-4xl" aria-hidden>
          🎧
        </div>
        <p className="font-extrabold text-2xl mt-2 text-jb-red-dark">
          {handoff.takenOver ? "Andito na ang crew" : "Sandali lang po"}
        </p>
        <p className="text-sm text-black/60 mt-1">
          {handoff.takenOver
            ? "Isang crew member na ang tutulong sa inyo."
            : "Kinokonekta namin kayo sa aming crew."}
        </p>
      </div>

      {/* What the crew sees */}
      {handoff.takenOver ? (
        <div className="bg-black/[0.05] px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-black/55">✓ Crew ang may hawak</p>
          <button
            onClick={onNextCustomer}
            className="mt-3 w-full rounded-full bg-jb-red text-white font-bold text-[13.5px] py-2 hover:bg-jb-red-dark"
          >
            Susunod na customer →
          </button>
        </div>
      ) : (
        <div
          role="alert"
          className={`px-5 py-4 text-white ${threat ? "bg-[#7a0a05] ring-4 ring-inset ring-jb-yellow animate-pulse" : "bg-jb-red-dark"}`}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-jb-yellow">⚠ Kailangan ng live agent</p>
          <p className="text-[13px] font-bold mt-1">{HANDOFF_LABEL[handoff.kind]}</p>
          <p className="text-[12.5px] mt-0.5 leading-snug text-white/85">{handoff.reason}</p>
          <button
            onClick={onTakeOver}
            className="mt-3 w-full rounded-full bg-white text-jb-red-dark font-bold text-[13.5px] py-2 hover:bg-jb-yellow"
          >
            Kunin ang kiosk (take over)
          </button>
          <button
            onClick={onNextCustomer}
            className="mt-2 w-full text-[11.5px] underline text-white/70 hover:text-white"
          >
            I-reset para sa susunod na customer
          </button>
        </div>
      )}
    </div>
  );
}
