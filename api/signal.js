/**
 * IntegrityAI — Session Signal Bus
 * In-process store for cross-machine signals: consent, gaze, tab switches, transcript chunks.
 * Module-level Map stays warm within a Vercel function instance (~5 min).
 * Good enough for a demo session. Not for production.
 */

const sessions = new Map(); // sessionId -> { flags, transcript_chunks: [] }

function getOrCreate(session) {
  if (!sessions.has(session)) {
    sessions.set(session, { transcript_chunks: [] });
    // Auto-cleanup after 6 hours
    setTimeout(() => sessions.delete(session), 6 * 60 * 60 * 1000);
  }
  return sessions.get(session);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = req.method === 'POST' ? req.body?.session : req.query?.session;
  if (!session) return res.status(400).json({ detail: "session required" });

  if (req.method === 'POST') {
    const { type, text } = req.body;
    const s = getOrCreate(session);

    if (type === 'transcript_chunk' && text && text.trim()) {
      // Append candidate speech chunk — InterviewScreen polls and pulls these
      s.transcript_chunks.push({ text: text.trim(), ts: Date.now() });
      // Cap at 500 chunks to avoid memory bloat
      if (s.transcript_chunks.length > 500) s.transcript_chunks.shift();
    } else if (type) {
      // Boolean signal: consent_given, tab_switch, gaze_deviation etc.
      s[type] = true;
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    const s = sessions.get(session) || { transcript_chunks: [] };
    const cursor = parseInt(req.query.cursor || '0', 10);
    const chunks = s.transcript_chunks.slice(cursor);
    const { transcript_chunks, ...flags } = s;
    return res.status(200).json({
      ...flags,
      transcript_chunks: chunks,
      next_cursor: cursor + chunks.length,
    });
  }

  return res.status(405).json({ detail: "Method not allowed" });
};
