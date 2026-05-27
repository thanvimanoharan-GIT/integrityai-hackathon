/**
 * IntegrityAI — Session Signal Bus
 * Handles consent, gaze, tab-switch signals + candidate transcript delivery.
 *
 * Cross-instance problem: Netlify/Vercel serverless has multiple Lambda instances
 * that don't share memory.  We solve this with a two-track transcript strategy:
 *
 *  1. CHUNK track  — real-time incremental chunks (fast, may miss on instance switch)
 *  2. SNAPSHOT track — full accumulated transcript sent every ~10 s by candidate
 *                      (survives instance switches; interviewer merges whichever is longer)
 *
 * The interviewer takes whichever delivers more text: snapshot or chunk reassembly.
 */

const sessions = new Map(); // sessionId -> session object

function getOrCreate(session) {
  if (!sessions.has(session)) {
    sessions.set(session, {
      transcript_chunks: [],   // incremental chunks
      transcript_snapshot: '', // full text snapshot, overwritten each heartbeat
      snapshot_ts: 0,
    });
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
      // Real-time incremental chunk
      s.transcript_chunks.push({ text: text.trim(), ts: Date.now() });
      if (s.transcript_chunks.length > 500) s.transcript_chunks.shift();

    } else if (type === 'transcript_snapshot' && text) {
      // Full accumulated transcript heartbeat — survives instance switches
      s.transcript_snapshot = text;
      s.snapshot_ts = Date.now();

    } else if (type) {
      // Boolean signal: consent_given, tab_switch, gaze_deviation etc.
      s[type] = true;
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    const s = sessions.get(session) || { transcript_chunks: [], transcript_snapshot: '', snapshot_ts: 0 };
    const cursor = parseInt(req.query.cursor || '0', 10);
    const chunks = s.transcript_chunks.slice(cursor);
    const { transcript_chunks, transcript_snapshot, snapshot_ts, ...flags } = s;
    return res.status(200).json({
      ...flags,
      transcript_chunks: chunks,
      next_cursor: cursor + chunks.length,
      transcript_snapshot,
      snapshot_ts,
    });
  }

  return res.status(405).json({ detail: "Method not allowed" });
};
