/**
 * IntegrityAI — Smart Question Engine
 * Netlify Serverless Function — Groq API / Llama 3 (genuinely free)
 * VERSION: GROQ-1
 */

const QUESTION_GEN_PROMPT = `You are IntegrityAI's Smart Question Engine — an expert technical interviewer specialising in detecting AI-assisted interview cheating.

Analyse the resume and produce a strategic question bank designed to test genuine depth and expose scripted answers.

TECHNICAL (5-7 questions): Personalised to their exact stack. Probe edge cases, trade-offs, failure modes they'd only know from real use.
BEHAVIORAL (3-4 questions): STAR-format tied to specific roles and projects in their resume.
TRAP QUESTIONS (4-5 questions) — MOST CRITICAL:
  a) FAKE TOOL TRAP: Invent a plausible-sounding but non-existent tool in their stack.
  b) CONTRADICTION PROBE: Cross-reference two claims that reveal tension.
  c) SIMPLICITY TEST: Explain complex claimed skill to a non-technical manager in 2 sentences.
  d) SPECIFICITY DRILL: Ask for exact detail only real users know.
  e) ACHIEVEMENT DEPTH: Ask for baseline metric, tool used, and biggest change behind any % claim.
PRESSURE FOLLOW-UPS (3-4 questions): Force spontaneous thinking when answers feel scripted.

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

exports.handler = async (event) => {

  // ── Diagnostic: GET /.netlify/functions/generate-questions
  if (event.httpMethod === "GET") {
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
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "GROQ-2",
        key_set: apiKey.length > 0,
        key_prefix: apiKey.substring(0, 7),
        groq_test: groqTest
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ detail: "Method not allowed" }) };
  }

  try {
    const { resume_text } = JSON.parse(event.body);

    if (!resume_text || resume_text.trim().length < 50) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ detail: "Resume text is too short. Please upload a proper PDF." }),
      };
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ detail: "GROQ_API_KEY not set in Netlify environment variables." }),
      };
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
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          detail: groqData?.error?.message || `Groq API error ${groqResponse.status}`,
          groq_error: groqData?.error || {}
        }),
      };
    }

    const rawText = groqData.choices[0].message.content;

    // Extract JSON from response
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ detail: "Unexpected response format. Please try again." }),
      };
    }

    const result = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(result),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ detail: err.message }),
    };
  }
};
