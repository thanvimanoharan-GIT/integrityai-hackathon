/**
 * IntegrityAI — Smart Question Engine
 * Vercel Serverless Function — Groq API / Llama 3
 * VERSION: VERCEL-1
 */

const QUESTION_GEN_PROMPT = `You are IntegrityAI's Smart Question Engine — an expert technical interviewer specialising in detecting AI-assisted interview cheating.

Analyse the resume and produce a strategic question bank designed to test genuine depth and expose scripted answers.

TECHNICAL (5-7 questions): Personalised to their exact stack. Probe edge cases, trade-offs, failure modes they'd only know from real use.
BEHAVIORAL (3-4 questions): STAR-format tied to specific roles and projects in their resume.
TRAP QUESTIONS (4-5 questions) — MOST CRITICAL — set "category": "trap" for ALL of these:
  a) FAKE TOOL TRAP: Invent a plausible-sounding but non-existent tool in their stack. Real experts say "never heard of it." Coached candidates play along.
  b) CONTRADICTION PROBE: Cross-reference two claims in their resume that reveal tension.
  c) SIMPLICITY TEST: "Explain [complex claimed skill] to a non-technical manager in 2 sentences."
  d) SPECIFICITY DRILL: Ask for exact detail only real users know — error messages, config names, default ports.
  e) ACHIEVEMENT DEPTH: If they claim "improved performance by 40%", ask for baseline metric, tool used, and single biggest change.
PRESSURE FOLLOW-UPS (3-4 questions): Force spontaneous thinking when answers feel scripted. Set "category": "pressure" for these.

CRITICAL RULE for categories:
- Technical questions → "category": "technical"
- Behavioral questions → "category": "behavioral"
- Trap questions (ALL 5 types above) → "category": "trap"  ← MUST be "trap", never "technical"
- Pressure follow-ups → "category": "pressure"

Respond ONLY with valid JSON, no markdown, no code fences, no explanation outside the JSON:
{
  "candidate_name": "name from resume or Candidate",
  "candidate_summary": "2-sentence honest assessment",
  "risk_flags": ["specific claims worth extra scrutiny"],
  "questions": [
    {
      "id": 1,
      "category": "technical",
      "trap_type": null,
      "difficulty": "easy",
      "question": "The exact question to ask",
      "why_it_matters": "What genuine vs coached answers reveal",
      "red_flags": "Phrases that suggest a scripted answer",
      "follow_up": "Probing follow-up"
    }
  ],
  "interviewer_tips": "2-3 sentence strategy note"
}
trap_type values: fake_tool | contradiction | simplicity | specificity | achievement_depth | null

RESUME TO ANALYSE:
`;

module.exports = async (req, res) => {
  // CORS headers — allow any origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ── Diagnostic: GET /api/generate-questions ──────────────────────────────
  if (req.method === "GET") {
    const apiKey = process.env.GROQ_API_KEY || "";
    let groqTest = {};
    try {
      const testRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Say hello in one word." }],
          max_tokens: 10
        })
      });
      const testData = await testRes.json();
      groqTest = { http_status: testRes.status, ok: testRes.ok, raw_response: testData };
    } catch (e) {
      groqTest = { error: e.message };
    }
    return res.status(200).json({
      version: "VERCEL-1",
      key_set: apiKey.length > 0,
      key_prefix: apiKey.substring(0, 7),
      groq_test: groqTest
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  try {
    const { resume_text } = req.body;

    if (!resume_text || resume_text.trim().length < 80) {
      return res.status(400).json({
        detail: "Resume text is too short. Please upload a proper PDF."
      });
    }

    // Guard against non-resume content — prevents AI hallucination on garbage input
    const lower = resume_text.toLowerCase();
    const resumeSignals = [
      'experience','education','skill','work','job','university','college',
      'degree','company','project','employment','career','qualification',
      'certif','linkedin','github','email','phone','summary','objective',
      'intern','engineer','developer','manager','analyst','designer',
      'bachelor','master','diploma','built','developed','managed','led'
    ];
    const hits = resumeSignals.filter(w => lower.includes(w)).length;
    if (hits < 3) {
      return res.status(400).json({
        detail: "This file doesn't appear to be a resume or CV. Please upload the candidate's actual resume PDF."
      });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        detail: "GROQ_API_KEY not set in Vercel environment variables."
      });
    }

    // Call Groq API (free tier — Llama 3 70B)
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: QUESTION_GEN_PROMPT + resume_text }],
        max_tokens: 4096,
        temperature: 0.7
      }),
    });

    const groqData = await groqResponse.json();

    if (!groqResponse.ok) {
      return res.status(500).json({
        detail: groqData?.error?.message || `Groq API error ${groqResponse.status}`,
        groq_error: groqData?.error || {}
      });
    }

    const rawText = groqData.choices[0].message.content;

    // Extract JSON from response
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(500).json({
        detail: "Unexpected response format. Please try again."
      });
    }

    const result = JSON.parse(match[0]);

    // Normalizer: if trap_type is non-null, category MUST be "trap"
    // Guards against model ignoring the category rule
    if (Array.isArray(result.questions)) {
      result.questions = result.questions.map(q => {
        if (q.trap_type && q.trap_type !== 'null' && q.trap_type !== null) {
          return { ...q, category: 'trap' };
        }
        return q;
      });
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};
