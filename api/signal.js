/**
 * IntegrityAI — Session Signal Bus
 *
 * Cross-machine signal relay: consent, gaze, tab-switch, candidate transcript.
 * Two transcript tracks:
 *   CHUNK    — real-time incremental (kept for future use / display)
 *   SNAPSHOT — full accumulated text + behavioral signals sent every ~10s from Mac B
 *
 * Snapshot payload from Mac B:
 *   { type:'transcript_snapshot', text, gaze_count, longest_silence_ms }
 *
 * GET response includes:
 *   transcript_snapshot, snapshot_gaze, snapshot_silence_ms
 *   (used by Mac A to call scoreTurn with full behavioral context)
 */

const sessions = new Map();

function getOrCreate(session) {
  if (!sessions.has(session)) {
    sessions.set(session, {
      transcript_chunks:   [],
      transcript_snapshot: '',
      snapshot_ts:         0,
      snapshot_gaze:       0,    // gaze_count from Mac B at time of last snapshot
      snapshot_silence_ms: null, // longest_silence_ms from Mac B at time of last snapshot
    });
    setTimeout(() => sessions.delete(session), 6 * 60 * 60 * 1000);
  }
  return sessions.get(session);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://integrityai-hackathon.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = req.method === 'POST' ? req.body?.session : req.query?.session;
  if (!session) return res.status(400).json({ detail: 'session required' });

  // POST handler
  if (req.method === 'POST') {
    const { type, text, gaze_count, longest_silence_ms } = req.body;
    const s = getOrCreate(session);

    if (type === 'transcript_snapshot' && text) {
      s.transcript_snapshot = text;
      s.snapshot_ts         = Date.now();
      s.snapshot_gaze       = typeof gaze_count       === 'number' ? gaze_count       : 0;
      s.snapshot_silence_ms = typeof longest_silence_ms === 'number' ? longest_silence_ms : null;

    } else if (type === 'transcript_chunk' && text && text.trim()) {
      s.transcript_chunks.push({ text: text.trim(), ts: Date.now() });
      if (s.transcript_chunks.length > 500) s.transcript_chunks.shift();

    } else if (type) {
      s[type] = true;
    }

    return res.status(200).json({ ok: true });
  }

  // GET handler
  if (req.method === 'GET') {
    const s      = sessions.get(session) || {};
    const cursor = parseInt(req.query.cursor || '0', 10);
    const chunks = (s.transcript_chunks || []).slice(cursor);

    const {
      transcript_chunks,
      transcript_snapshot,
      snapshot_ts,
      snapshot_gaze,
      snapshot_silence_ms,
      ...flags
    } = s;

    return res.status(200).json({
      ...flags,
      transcript_chunks:   chunks,
      next_cursor:         cursor + chunks.length,
      transcript_snapshot: transcript_snapshot || '',
      snapshot_ts:         snapshot_ts         || 0,
      snapshot_gaze:       snapshot_gaze       || 0,
      snapshot_silence_ms: snapshot_silence_ms ?? null,
    });
  }

  return res.status(405).json({ detail: 'Method not allowed' });
};
