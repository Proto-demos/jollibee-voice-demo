"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@/lib/voice/useRealtimeVoice";
import { formatPeso, modifierLabel, type CartLine } from "@/lib/cart";
import type { Handoff } from "./HandoffCard";
import type { HandoffKind } from "@/lib/voice/tools";

const HANDOFF_LABEL: Record<HandoffKind, string> = {
  prank: "Prank / hindi totoong order",
  abuse: "Bastos na customer",
  threat: "🚨 BANTA – tawagan ang security / manager",
  request: "Gusto makausap ang crew",
  complaint: "May reklamo",
};

export interface CrewTicket {
  orderNumber: string;
  lines: CartLine[];
  total: number;
  sentAt: number;
}

type TicketStatus = "new" | "preparing" | "ready";

const STATUS: Record<TicketStatus, { label: string; className: string }> = {
  new: { label: "Bago", className: "bg-jb-yellow text-[#2a0907]" },
  preparing: { label: "Inihahanda", className: "bg-jb-red text-white" },
  ready: { label: "Ready sa counter", className: "bg-[#2e9e5b] text-white" },
};

/** A sent order's status for the demo: new → preparing after 6s → ready after 25s. */
function statusOf(ticket: CrewTicket, now: number): TicketStatus {
  const age = now - ticket.sentAt;
  return age < 6000 ? "new" : age < 25000 ? "preparing" : "ready";
}

function TicketLines({ lines }: { lines: CartLine[] }) {
  return (
    <ul className="space-y-1">
      {lines.map((l) => (
        <li key={l.lineId} className="text-[12.5px] leading-snug">
          <span className="font-bold">{l.qty}×</span> {l.name}
          {l.modifiers.length > 0 && <span className="block pl-5 text-[11.5px] text-white/60">{modifierLabel(l)}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the crew sees while Joy runs the kiosk (as on the Dunkin' demo's crew
 * screen): the order she is taking right now, the orders she has sent to the
 * kitchen, and – when she hands a customer over – the live-agent alert with
 * the take-over button. The transcript sits behind a tab.
 */
export function CrewPanel({
  liveLines,
  liveActive,
  tickets,
  transcript,
  handoff,
  handoffCount,
  takeOverCount,
  onTakeOver,
  onNextCustomer,
}: {
  liveLines: CartLine[];
  liveActive: boolean;
  tickets: CrewTicket[];
  transcript: TranscriptEntry[];
  handoff: Handoff | null;
  handoffCount: number;
  takeOverCount: number;
  onTakeOver: () => void;
  onNextCustomer: () => void;
}) {
  const [tab, setTab] = useState<"tickets" | "transcript">("tickets");
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tick so ticket statuses move on.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab === "transcript") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, tab]);

  return (
    <aside className="hidden lg:flex flex-col bg-[#2a0907] text-white border-r border-white/10 w-[300px] shrink-0 min-h-0">
      <div className="px-4 pt-4 pb-3 shrink-0 border-b border-white/10">
        <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-white/50">Crew screen · Kiosk 1</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="relative flex w-2.5 h-2.5">
            {liveActive && <span className="absolute inset-0 rounded-full bg-[#2e9e5b] animate-ping opacity-70" />}
            <span className={`relative w-2.5 h-2.5 rounded-full ${liveActive ? "bg-[#2e9e5b]" : "bg-white/30"}`} />
          </span>
          <span className="text-[13px] font-semibold">Order-taker: Joy (AI)</span>
        </div>
        <p className="mt-1 text-[11.5px] text-white/55">Walang crew sa kiosk – diretso sa kitchen ang orders.</p>
        <div className="mt-3 flex gap-1 rounded-full bg-white/10 p-1 text-[11.5px] font-semibold">
          {(["tickets", "transcript"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full py-1 ${tab === t ? "bg-white text-[#2a0907]" : "text-white/70 hover:text-white"}`}
            >
              {t === "tickets" ? `Orders (${tickets.length})` : "Transcript"}
            </button>
          ))}
        </div>
      </div>

      {handoff && (
        <div
          role="alert"
          className={`mx-4 mt-3 rounded-lg p-3 shrink-0 ${
            handoff.takenOver
              ? "bg-white/10"
              : handoff.kind === "threat"
                ? "bg-[#7a0a05] ring-2 ring-jb-yellow animate-pulse"
                : "bg-jb-red animate-pulse"
          }`}
        >
          <p className={`text-[10.5px] font-bold uppercase tracking-wider ${handoff.takenOver ? "" : "text-jb-yellow"}`}>
            {handoff.takenOver ? "✓ Crew ang may hawak" : "⚠ Kailangan ng live agent"}
          </p>
          <p className="text-[12px] font-bold mt-1">{HANDOFF_LABEL[handoff.kind]}</p>
          <p className="text-[12.5px] mt-1 leading-snug text-white/85">{handoff.reason}</p>
          {handoff.takenOver ? (
            <button
              onClick={onNextCustomer}
              className="mt-2 w-full rounded-full bg-white text-jb-red-dark font-bold text-[12.5px] py-1.5 hover:bg-jb-yellow"
            >
              Tapos na – susunod na customer
            </button>
          ) : (
            <>
              <button
                onClick={onTakeOver}
                className="mt-2 w-full rounded-full bg-white text-jb-red-dark font-bold text-[12.5px] py-1.5 hover:bg-jb-yellow"
              >
                Kunin ang kiosk (take over)
              </button>
              <button onClick={onNextCustomer} className="mt-1.5 w-full text-[11px] underline text-white/70 hover:text-white">
                I-reset para sa susunod na customer
              </button>
            </>
          )}
        </div>
      )}

      {tab === "tickets" ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {/* The order Joy is taking right now */}
          <div className="rounded-lg border border-dashed border-white/25 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/60">Kinukuha ngayon</span>
              {liveActive && <span className="text-[10.5px] text-[#7fd3a1]">● live</span>}
            </div>
            {liveLines.length ? (
              <TicketLines lines={liveLines} />
            ) : (
              <p className="text-[12px] text-white/45">{liveActive ? "Nakikinig si Joy…" : "Walang customer sa kiosk."}</p>
            )}
          </div>

          {/* Sent to the kitchen, newest first */}
          {[...tickets].reverse().map((t) => {
            const st = statusOf(t, now);
            return (
              <div key={t.orderNumber} className="card-in rounded-lg bg-white/[0.07] p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-[17px] font-extrabold leading-none">#{t.orderNumber}</p>
                    <p className="text-[11.5px] text-white/60 mt-0.5">
                      {new Date(t.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS[st].className}`}>
                    {STATUS[st].label}
                  </span>
                </div>
                <TicketLines lines={t.lines} />
                <p className="mt-2 pt-2 border-t border-white/10 text-right text-[12.5px] font-bold">{formatPeso(t.total)}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {transcript.length === 0 ? (
            <p className="text-xs text-white/45">Lalabas dito ang usapan ni Joy at ng customer.</p>
          ) : (
            transcript.map((entry) => (
              <div key={entry.id}>
                <p className={`text-[9.5px] font-semibold uppercase tracking-wider mb-0.5 ${entry.role === "assistant" ? "text-jb-yellow" : "text-white/55"}`}>
                  {entry.role === "assistant" ? "Joy" : "Customer"}
                </p>
                <p className="text-[12.5px] leading-snug text-white/90">{entry.text}</p>
              </div>
            ))
          )}
        </div>
      )}

      <div className="shrink-0 px-4 py-3 border-t border-white/10 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/[0.07] py-2">
          <p className="text-xl font-extrabold leading-none">{tickets.length}</p>
          <p className="text-[10px] text-white/55 mt-1">Orders ni Joy</p>
        </div>
        <div className="rounded-lg bg-white/[0.07] py-2">
          <p className="text-xl font-extrabold leading-none">{handoffCount}</p>
          <p className="text-[10px] text-white/55 mt-1">Ipinasa sa crew</p>
        </div>
        <div className="rounded-lg bg-white/[0.07] py-2">
          <p className="text-xl font-extrabold leading-none">{takeOverCount}</p>
          <p className="text-[10px] text-white/55 mt-1">Kinuha ng crew</p>
        </div>
      </div>
    </aside>
  );
}
