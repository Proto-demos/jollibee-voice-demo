"use client";

import { useEffect, useRef } from "react";
import type { VoiceStatus } from "@/lib/voice/useRealtimeVoice";

function spawnRing(container: HTMLElement, level: number) {
  const ring = document.createElement("span");
  ring.className = "voice-ring";
  // Rings only run during a conversation, when the orb is small and the cards
  // sit just below it: cap them at ~2x so they stop short of the cards.
  ring.style.setProperty("--ring-s", String(1.3 + Math.min(level, 1) * 0.75));
  ring.style.setProperty("--ring-o", String(Math.min(0.3 + level * 0.7, 0.85)));
  container.appendChild(ring);
  ring.addEventListener("animationend", () => ring.remove());
}

/**
 * The mic orb. Idle: a slow "breathe" loop that invites the tap. Active:
 * expanding rings spawned from live audio loudness (mic + Joy's voice) —
 * louder speech spawns bigger rings faster, silence spawns none.
 */
export function VoiceOrb({
  status,
  onClick,
  getLevel,
}: {
  status: VoiceStatus;
  onClick: () => void;
  getLevel: () => number;
}) {
  const isActive = status === "connecting" || status === "listening" || status === "speaking";
  const ringsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isActive) return;
    let raf = 0;
    let lastRing = 0;
    const loop = (t: number) => {
      const level = getLevel();
      // Louder → shorter interval between rings (90ms floor), quiet → none.
      const interval = 420 - Math.min(level, 0.6) * 550;
      if (level > 0.05 && t - lastRing > Math.max(90, interval) && ringsRef.current) {
        lastRing = t;
        spawnRing(ringsRef.current, level);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isActive, getLevel]);

  return (
    <button
      onClick={onClick}
      aria-label={isActive ? "Tapusin ang order" : "Simulan ang pag-order gamit ang boses"}
      className={`relative rounded-full shrink-0 transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50 ${
        isActive ? "w-16 h-16 mb-4" : "w-28 h-28"
      }`}
    >
      {/* audio-synced rings live behind the face */}
      <span ref={ringsRef} className="absolute inset-0 rounded-full" aria-hidden="true" />
      <span
        className={`absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#FFD34D,#FFC72C_70%)] ${
          !isActive ? "animate-[breathe_2.6s_ease-in-out_infinite]" : ""
        }`}
      />
      <span
        className={`absolute inset-0 flex items-center justify-center ${
          isActive ? "text-2xl" : "text-5xl"
        }`}
      >
        🎙️
      </span>
    </button>
  );
}
