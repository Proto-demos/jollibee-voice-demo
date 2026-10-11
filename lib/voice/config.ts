/**
 * How fast Joy speaks: the Realtime API's `audio.output.speed` (0.25–1.5,
 * 1 = the voice's natural pace). Set on the session when it's created and
 * again in every session.update, so the kiosk and scripts/debug-realtime.ts
 * run at the same pace. The pre-recorded greeting plays at GREETING_PLAYBACK_RATE
 * – its TTS recording reads a little slower than Joy speaks live.
 */
export const VOICE_SPEED = 1.15;

/** Playback rate of the pre-recorded greeting, so it matches Joy's live pace. */
export const GREETING_PLAYBACK_RATE = 1.25;
