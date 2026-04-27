/**
 * IntegrityAI — Session Signal Bus
 * Tiny in-process store for cross-machine signals (consent, join status).
 * Module-level Map stays warm within a Vercel function instance (~5 min).
 * Good enough for a demo session. Not for production.
 */

const signals = new Map(); // sessionId -> { consent_given: bool, candidate_joined: bool }

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = req.method === 'POST' ? req.body?.session : req.query?.session;
  if (!session) return res.status(400).json({ detail: "session required" });

  if (req.method === 'POST') {
    const { type } = req.body;
    if (!signals.has(session)) signals.set(session, {});
    signals.get(session)[type] = true;
    // Auto-cleanup after 6 hours
    setTimeout(() => signals.delete(session), 6 * 60 * 60 * 1000);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    return res.status(200).json(signals.get(session) || {});
  }

  return res.status(405).json({ detail: "Method not allowed" });
};
