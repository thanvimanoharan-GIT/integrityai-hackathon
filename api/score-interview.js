/**
 * IntegrityAI — Interview Scorer
 * Vercel Serverless Function — Groq API / Llama 3
 * Analyses full interview transcript and returns integrity report
 */

const SCORE_PROMPT = `You are IntegrityAI's Interview Analyst — an expert at detecting AI-assisted, coached, or scripted interview answers.

You will receive a full interview transcript (includes everything said — interviewer questions and candidate answers), candidate details, and behavioral signals.

WHAT TO ANALYSE:
1. SCRIPTED LANGUAGE — Does the candidate sound like they're reading? Perfect structure, no hesitations, textbook phrases like "leveraging synergies", "end-to-end solutions", "utilising best practices"?
2. VOCABULARY SHIFT — Are some answers dramatically more sophisticated than others? Signals switching between coached and uncoached answers.
3. FAKE TOOL TRAP — If a fake/non-existent tool name was asked about (listed in trap_questions), did the candidate claim familiarity? This is the single strongest red flag.
4. LACK OF SPECIFICITY — Real experience = specific numbers, dates, error messages, team names, config values. Vague generalities = surface knowledge only.
5. MISSING FILLERS — Natural speech has "um", "uh", "like", "you know", "so". Their total absence in technical answers strongly suggests scripted responses.
6. ANSWER LATENCY PATTERN — If the transcript shows unusually instant, perfectly structured answers with no thinking pauses.
7. CONTRADICTION — Did the candidate contradict themselves between answers?

TAB SWITCHES — Weight this as supporting evidence, not standalone proof.

SCORING:
- 70–100: LOW risk — mostly authentic signals. Natural speech, specific details, appropriate hesitations.
- 40–69: MEDIUM risk — some flags. Proceed with targeted in-person follow-up.
- 0–39: HIGH risk — strong indicators of AI assistance. Do not proceed.

If transcript is short, do your best. If no meaningful transcript, say so clearly in assessment.
Be direct and specific — hiring managers need actionable guidance, not vague disclaimers.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "integrity_score": <integer 0-100, higher = more authentic>,
  "risk_level": "low" | "medium" | "high",
  "recommendation": "proceed" | "re-interview" | "do-not-proceed",
  "recommendation_reason": "<2-3 direct sentences the hiring manager can act on>",
  "flags": [
    {
      "type": "scripted_language" | "vocab_shift" | "fake_tool_accepted" | "no_specifics" | "missing_fillers" | "contradiction" | "tab_switch",
      "severity": "high" | "medium" | "low",
      "detail": "<specific observation — quote from transcript where possible>"
    }
  ],
  "notable_quotes": [
    {
      "quote": "<exact or near-exact suspicious quote from transcript>",
      "why_suspicious": "<brief plain-English note>"
    }
  ],
  "overall_assessment": "<3-4 sentence narrative — specific, direct, actionable>"
}`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed" });

  try {
    const { transcript, candidate_name, trap_questions, tab_switches, duration_seconds } = req.body;

    if (!transcript || transcript.trim().length < 20) {
      return res.status(400).json({ detail: "Transcript is too short to analyse." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ detail: "GROQ_API_KEY not set." });

    // Truncate transcript to ~3000 words to stay within token limits
    const words = transcript.split(' ');
    const truncated = words.length > 3000 ? words.slice(0, 3000).join(' ') + ' [transcript truncated]' : transcript;

    const userMessage = `
CANDIDATE NAME: ${candidate_name || 'Unknown'}
INTERVIEW DURATION: ${Math.round((duration_seconds || 0) / 60)} minutes
TAB/WINDOW SWITCHES DETECTED: ${tab_switches || 0}

TRAP QUESTIONS THAT WERE IN THE BANK (fake tools — check if candidate accepted any):
${trap_questions?.length ? trap_questions.map((q, i) => `${i+1}. ${q}`).join('\n') : 'None provided'}

FULL INTERVIEW TRANSCRIPT:
${truncated}
`;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SCORE_PROMPT },
          { role: "user", content: userMessage }
        ],
        max_tokens: 2048,
        temperature: 0.3
      }),
    });

    const groqData = await groqResponse.json();
    if (!groqResponse.ok) {
      return res.status(500).json({ detail: groqData?.error?.message || `Groq error ${groqResponse.status}` });
    }

    const rawText = groqData.choices[0].message.content;
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ detail: "Unexpected AI response format." });

    const report = JSON.parse(match[0]);
    return res.status(200).json(report);

  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};
