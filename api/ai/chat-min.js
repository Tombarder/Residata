// Minimal probe — /api/ai/chat-min — to isolate whether the chat
// function-build path itself works. If this 200s and chat.js 500s,
// then chat.js has a top-level crash; otherwise Vercel's serverless
// pipeline is the problem.
export default async function handler(req, res) {
  return res.status(200).json({ ok: true, ts: Date.now() });
}
