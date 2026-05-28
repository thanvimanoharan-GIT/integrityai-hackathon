/**
 * IntegrityAI — Dynamic Trap Question Generator
 * Vercel Serverless Function — Groq API / Llama 3.3 70B
 *
 * Triggered when suspicion meter exceeds 70 for 2 consecutive turns.
 * Generates ONE targeted pressure question designed to expose AI-assisted cheating.
 * The question is personalised to the specific suspicious pattern detected.
 */

const TRAP_GEN_PROMPT = `You are an expert technical interviewer who has just detected a candidate likely using AI assistance (ChatGPT or similar) to answer questions in real-time.

You will receive:
1. The candidate's last 2 answers (which triggered high suspicion scores)
2. Their role being interviewed for
3. A brief resume snippet

Your job: Generate ONE sharp, highly targeted pressure question that will immediately expose AI assistance if it is being used.

PRINCIPLES FOR A GOOD TRAP QUESTION:
- Ask for something HYPER-SPECIFIC that ChatGPT cannot answer without real lived experience
  Examples: "What was the exact error message you got?", "What was your manager's name on that project?", "Walk me through the specific git command you ran"
- Ask them to CONTRADICT or SIMPLIFY something they just said
  Examples: "You mentioned microservices — explain that to a 10-year-old in 15 seconds", "In your last answer you said X — what would you do if X failed?"
- INTERRUPT with an unexpected tangent they can't have pre-prepared
  Examples: "Stop — what was the hardest bug you personally fixed in that system?", "Name one thing that went WRONG in that project"
- Ask for REAL NUMBERS: dates, team sizes, error rates, story points, specific versions
- Make them THINK OUT LOUD: "Don't give me the solution — what's the first question you'd ask before solving this?"

WHAT NOT TO DO:
- Don't ask generic behavioral questions (they have pre-written answers for those)
- Don't ask conceptual knowledge questions (ChatGPT knows them all)
- Don't ask multi-part questions (keep it sharp and single-focus)

TRAP SUBTYPES — pick the one that best targets the suspicious pattern:
- contradiction: catches an inconsistency between their two answers or resume vs what they said
- specificity: demands a concrete detail they should know if they genuinely did this work
- simplicity: asks them to explain it simply — real experts can, AI readers cannot
- achievement_depth: asks what went wrong or what was hard — AI generates successes, not failures
- pressure: sudden pivot to something unrelated but they should know if the experience is real

Respond ONLY with valid JSON, no markdown:
{"question": "<the trap question — one sentence, sharp, direct>", "trap_type": "contradiction|specificity|simplicity|achievement_depth|pressure", "target": "<one sentence explaining what suspicious pattern this targets>"}`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "https://integrityai-hackathon.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed" });

  try {
    const { last_answers, role, resume_snippet, suspicion_notes } = req.body;

    if (!last_answers || last_answers.length < 1) {
      return res.status(400).json({ detail: "last_answers required" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ detail: "GROQ_API_KEY not set." });

    const answersBlock = last_answers
      .map((a, i) => `Answer ${i + 1}:\n${a.substring(0, 600)}`)
      .join('\n\n');

    const userContent = `Role being interviewed for: ${role || 'Software Engineer'}

Resume snippet:
${resume_snippet ? resume_snippet.substring(0, 400) : 'Not provided'}

Suspicious AI flags from scoring: ${suspicion_notes || 'Uniformly structured answers, no personal specifics, high suspicion score'}

Candidate's last 2 answers (both scored >70 suspicion):
${answersBlock}

Generate one targeted trap question to expose whether these answers are AI-assisted.`;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: TRAP_GEN_PROMPT },
          { role: "user", content: userContent }
        ],
        max_tokens: 200,
        temperature: 0.4
      }),
    });

    const groqData = await groqResponse.json();
    if (!groqResponse.ok) {
      return res.status(500).json({ detail: groqData?.error?.message || `Groq error ${groqResponse.status}` });
    }

    const rawText = groqData.choices[0].message.content;
    const match = rawText.match(/\{[^}]*?\}/);
    if (!match) return res.status(200).json({
      question: "Stop — walk me through exactly what you did, step by step, in your own words. No frameworks, no buzzwords.",
      trap_type: "specificity",
      target: "Fallback: demands concrete personal account"
    });

    const result = JSON.parse(match[0]);
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};
