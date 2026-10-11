import { VOICE_SPEED } from "@/lib/voice/config";

export const runtime = "nodejs";

const DEFAULT_MODEL = "gpt-realtime-2.1";
const DEFAULT_VOICE = "marin";

export async function POST(req: Request) {
  const offerSdp = await req.text();
  if (!offerSdp) {
    return new Response("Missing SDP offer", { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not set on the server." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL;
  const voice = process.env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE;

  const sessionConfig = JSON.stringify({
    type: "realtime",
    model,
    audio: { output: { voice, speed: VOICE_SPEED } },
  });

  const formData = new FormData();
  formData.set("sdp", offerSdp);
  formData.set("session", sessionConfig);

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": "jollibee-voice-demo",
    },
    body: formData,
  });

  const answerSdp = await upstream.text();

  if (!upstream.ok) {
    return new Response(answerSdp || "Failed to create realtime session", {
      status: upstream.status,
    });
  }

  return new Response(answerSdp, { headers: { "Content-Type": "application/sdp" } });
}
