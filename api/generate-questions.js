/**
 * IntegrityAI — Smart Question Engine
 * Vercel Serverless Function — Groq API / Llama 3
 * VERSION: VERCEL-2
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
  "interviewer_tips": "2-3 sentence strategy note",
  "career_analysis": {
    "total_companies": 3,
    "average_tenure_months": 18,
    "job_hopping_risk": "low|medium|high",
    "project_continuity_risk": "low|medium|high",
    "job_hopping_summary": "1-sentence summary of career stability",
    "career_gaps": [
      {"period": "Jan 2022 - Apr 2022", "duration_months": 3, "note": "optional context"}
    ],
    "overall_career_red_flags": ["list of specific red flags or empty array"]
  }
}
trap_type values: fake_tool | contradiction | simplicity | specificity | achievement_depth | null
career_analysis RULES — follow exactly:
- average_tenure_months = total employed months across ALL jobs / number of jobs. Example: 1 job for 4 years = 48 months average. 2 jobs of 2 years each = 24 months average.
- Count each employer as ONE job regardless of role changes or promotions within the same company.
- If only years given (e.g. "4 years"), multiply by 12. If start/end dates given, calculate month difference precisely.
- job_hopping_risk: high if avg tenure < 12mo, medium if 12-18mo, low if > 18mo.
- total_companies: count distinct employers only, not roles.

RESUME TO ANALYSE:
`;

// Recalculate average_tenure_months from actual year ranges in resume text.
// LLMs frequently get date math wrong (e.g. 4 years → returns 12 months).
// This reads "YYYY – YYYY" / "YYYY - Present" patterns and corrects the value.
// Recalculate average_tenure_months from actual year ranges in resume text.
// LLMs frequently get date math wrong (e.g. 4 years → returns 12 months).
// Handles: "Dec 2021 – till date", "2020 - 2024", "Jan 2019 – Mar 2022" etc.
function correctTenure(career, resumeText) {
  if (!career || !resumeText) return career;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const PRESENT = /^(present|current|now|till\s*date|today|date)$/i;

  // Parse "Dec 2021" or "2021" → { year, month }
  function parseDate(monStr, yearStr) {
    const y = parseInt(yearStr);
    const mo = monStr ? (MONTHS[monStr.toLowerCase().slice(0,3)] || 1) : null;
    return { year: y, month: mo };
  }

  // Match patterns like:
  //   "Dec 2021 – till date"  "Jan 2019 – Mar 2022"  "2020 – 2024"  "2018 - Present"
  const re = /(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\s*[-–—to]+\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2}|present|current|now|till\s*date|today|date)/gi;

  const spans = [];
  let m;
  while ((m = re.exec(resumeText)) !== null) {
    const start = parseDate(m[1], m[2]);
    const endRaw = m[4];
    let endYear, endMonth;

    if (PRESENT.test(endRaw.trim())) {
      endYear = curYear; endMonth = curMonth;
    } else {
      const ep = parseDate(m[3], endRaw);
      endYear = ep.year; endMonth = ep.month || 12;
    }

    if (start.year >= 1990 && endYear >= start.year && endYear <= curYear + 1) {
      const startMonth = start.month || 1;
      const months = (endYear - start.year) * 12 + (endMonth - startMonth);
      if (months > 0) spans.push(months);
    }
  }
  if (!spans.length) return career;

  const companies = Math.max(1, career.total_companies || 1);

  // 1 company → use the longest single span (their total tenure)
  // Multiple → sum top N spans / N
  let recalcAvg;
  if (companies === 1) {
    recalcAvg = Math.max(...spans);
  } else {
    spans.sort((a, b) => b - a);
    const topN = spans.slice(0, companies);
    recalcAvg = Math.round(topN.reduce((s, v) => s + v, 0) / companies);
  }

  // Correct only if AI value is significantly lower than our calculation
  if (recalcAvg > 0 && career.average_tenure_months < recalcAvg * 0.6) {
    career.average_tenure_months = recalcAvg;
    if (recalcAvg >= 18) career.job_hopping_risk = 'low';
    else if (recalcAvg >= 12) career.job_hopping_risk = 'medium';
    else career.job_hopping_risk = 'high';
  }
  return career;
}

module.exports = async (req, res) => {
  // CORS headers — allow any origin
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "https://integrityai-hackathon.vercel.app");
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "Say hello in one word." }], max_tokens: 10 })
      });
      const testData = await testRes.json();
      groqTest = { http_status: testRes.status, ok: testRes.ok, raw_response: testData };
    } catch (e) {
      groqTest = { error: e.message };
    }
    return res.status(200).json({ version: "VERCEL-2", key_set: apiKey.length > 0, key_prefix: apiKey.substring(0, 7), groq_test: groqTest });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  try {
    const { resume_text } = req.body;

    if (!resume_text || resume_text.trim().length < 80) {
      return res.status(400).json({ detail: "Resume text is too short. Please upload a proper PDF." });
    }

    // Guard against non-resume content
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
      return res.status(400).json({ detail: "This file doesn't appear to be a resume or CV. Please upload the candidate's actual resume PDF." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ detail: "GROQ_API_KEY not set in Vercel environment variables." });
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
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

    const match = (() => { const s = rawText.indexOf('{'); const e = rawText.lastIndexOf('}'); return (s !== -1 && e > s) ? [rawText.slice(s, e + 1)] : null; })();
    if (!match) {
      return res.status(500).json({ detail: "Unexpected response format. Please try again." });
    }

    const result = JSON.parse(match[0]);

    // Normaliser: force category='trap' on any question with non-null trap_type
    // Guards against model returning trap questions tagged as 'technical', breaking the Traps tab
    if (Array.isArray(result.questions)) {
      result.questions = result.questions.map(q => {
        if (q.trap_type && q.trap_type !== 'null' && q.trap_type !== null) {
          return { ...q, category: 'trap' };
        }
        return q;
      });
    }

    // Career analysis tenure correction — LLMs are unreliable at date math.
    // Re-extract year ranges from the actual resume text and recalculate ourselves.
    if (result.career_analysis) {
      result.career_analysis = correctTenure(result.career_analysis, resume_text);
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};
