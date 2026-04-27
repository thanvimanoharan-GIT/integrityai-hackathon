/**
 * IntegrityAI — Live Turn Scorer
 * Vercel Serverless Function — Groq API / Llama 3
 * Scores a single candidate answer turn in real time.
 * Designed to be fast (< 2s) — minimal prompt, tiny output.
 * Returns suspicion score 0–100 (higher = more suspicious).
 */

const TURN_PROMPT = `You are a real-time interview authenticity detector. You will receive ONE candidate answer.

Score its suspicion level from 0 to 100:
- 0–30: Natural, specific, authentic. Hesitations, personal details, specific numbers/errors.
- 31–60: Some polish but plausible. Generic but not alarming.
- 61–80: Suspiciously clean. Textbook phrasing, no fillers, perfect structure.
- 81–100: Almost certainly scripted or AI-generated. No personality, reads like documentation.

Also flag the single strongest signal if score > 40.

Respond ONLY with valid JSON, no markdown:
{"suspicion_score": <0-100>, "flag": "scripted_language"|"vocab_shift"|"no_fillers"|"no_specifics"|"fake_tool_accepted"|"contradiction"|"none", "note": "<one sentence max>"}`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed" });

  try {
    const { answer_text, turn_number } = req.body;

    if (!answer_text || answer_text.trim().length < 5) {
      return res.status(200).json({ suspicion_score: 0, flag: "none", note: "Too short to score." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ detail: "GROQ_API_KEY not set." });

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
          { role: "user", content: `Turn ${turn_number || '?'} — Candidate answer:\n\n${answer_text.substring(0, 800)}` }
        ],
        max_tokens: 120,
        temperature: 0.1
      }),
    });

    const groqData = await groqResponse.json();
    if (!groqResponse.ok) {
      return res.status(500).json({ detail: groqData?.error?.message || `Groq error ${groqResponse.status}` });
    }

    const rawText = groqData.choices[0].message.content;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return res.status(200).json({ suspicion_score: 30, flag: "none", note: "Could not parse response." });

    const result = JSON.parse(match[0]);
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};
