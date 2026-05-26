/**
 * IntegrityAI — Live Turn Scorer
 * Vercel Serverless Function — Groq API / Llama 3
 * Scores a single candidate answer turn in real time.
 * Designed to be fast (< 2s) — minimal prompt, tiny output.
 * Returns suspicion score 0–100 (higher = more suspicious).
 */

const TURN_PROMPT = `You are a real-time interview authenticity detector. You will receive ONE candidate answer spoken aloud in an interview.

Score its SUSPICION level from 0 to 100 (higher = more likely AI-assisted or coached):
- 0–30: Authentic. Specific personal details, natural phrasing, inconsistent quality (real humans aren't always perfect), war stories, things that went wrong.
- 31–60: Possibly coached. Generic but plausible. Lacks personal specifics but not alarming.
- 61–80: Likely AI-assisted. Textbook structure, no personal details, perfect sentences, reads like a LinkedIn post.
- 81–100: Almost certainly read from ChatGPT or similar. No personality, uniform jargon, numbered structure, generic examples, impressive but untraceable.

KEY ChatGPT FINGERPRINTS to detect (any of these pushes score up significantly):
- Numbered structure mid-answer: "There are three aspects: first... second... third..."
- Transitions nobody says aloud: "Additionally", "Furthermore", "It's worth noting"
- Neat summary sentence at the end of every answer
- Generic unverifiable example: "In my previous role I improved X by Y%"
- Every answer similar length regardless of question complexity
- Technical jargon evenly dense throughout — no simpler moments
- No specific error messages, dates, team names, or anything traceable
- Could have been written by someone who has never done this job

FALSE POSITIVE GUARD: Many genuine candidates speak clearly and formally — especially non-native English speakers and well-prepared candidates. Do NOT penalise:
- Clear structured speech or formal transitions — natural for many speakers
- Dense technical language — expected from real experts
- Missing fillers — speech-to-text strips these from everyone

Score HIGH suspicion only when: specifics are absent AND language is suspiciously uniform AND/OR answer feels like it could describe anyone's experience, not this person's specific situation.
A polished answer WITH specific details (error messages, dates, team names, real project names) = authentic.
A polished answer WITHOUT any verifiable specifics = suspicious.

TIMING SIGNALS (if provided — push score up 10-20pts when combined with other flags):
- Response latency (time from question end to first word):
  - < 5s: Very natural — confident or well-prepared
  - 5–12s: Normal thinking pause — authentic
  - 13–20s: Slightly long — possible typing/searching (mild flag)
  - > 20s: Suspiciously long — consistent with typing query into ChatGPT and waiting for response (significant flag — add "slow_response" to note)
- Longest mid-answer silence gap:
  - > 4s gap mid-answer: Natural — person is thinking, recalling, gathering words
  - 1–3s gaps: Normal speech rhythm
  - < 1s with very long answer (>100 words): Suspiciously fluent — consistent with reading from screen (flag "unbroken_fluency")
  IMPORTANT: Do NOT penalise short pauses — natural speech has pauses. Only flag when there are NO pauses in a long answer.

Respond ONLY with valid JSON, no markdown:
{"suspicion_score": <0-100>, "flag": "ai_generated"|"scripted_language"|"no_specifics"|"no_fillers"|"vocab_shift"|"fake_tool_accepted"|"slow_response"|"unbroken_fluency"|"none", "note": "<one sentence — name the specific pattern you detected, mention timing if flagged>"}`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed" });

  try {
    const { answer_text, turn_number, latency_ms, longest_silence_ms, gaze_deviations } = req.body;

    if (!answer_text || answer_text.trim().length < 5) {
      return res.status(200).json({ suspicion_score: 0, flag: "none", note: "Too short to score." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ detail: "GROQ_API_KEY not set." });

    // Build context string: timing + gaze
    let contextStr = '';
    if (latency_ms != null || longest_silence_ms != null) {
      const latSec = latency_ms != null ? (latency_ms / 1000).toFixed(1) : null;
      const silSec = longest_silence_ms != null ? (longest_silence_ms / 1000).toFixed(1) : null;
      contextStr += `\nTIMING DATA: Response latency = ${latSec != null ? latSec + 's' : 'unknown'} | Longest mid-answer silence = ${silSec != null ? silSec + 's' : 'unknown'}`;
    }
    if (gaze_deviations != null && gaze_deviations > 0) {
      contextStr += `\nGAZE DATA: Candidate looked away from screen ${gaze_deviations} time(s) during this answer — may indicate reading from external source.`;
    }

    const userContent = `Turn ${turn_number || '?'} — Candidate answer:\n\n${answer_text.substring(0, 800)}${contextStr}`;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: TURN_PROMPT },
          { role: "user", content: userContent }
        ],
        max_tokens: 150,
        temperature: 0.1
      }),
    });

    const groqData = await groqResponse.json();
    if (!groqResponse.ok) {
      return res.status(500).json({ detail: groqData?.error?.message || `Groq error ${groqResponse.status}` });
    }

    const rawText = groqData.choices[0].message.content;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return res.status(200).jso