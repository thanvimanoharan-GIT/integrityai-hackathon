/**
 * IntegrityAI — Interview Scorer
 * Vercel Serverless Function — Groq API / Llama 3
 * Analyses candidate answers against their resume + behavioral signals
 */

const SCORE_PROMPT = `CRITICAL RULE – INSUFFICIENT DATA:
If the transcript is empty, very short (<50 words), contains "[No speech was recorded]",
or consists only of casual/non-interview language with no technical or professional content:
- Set integrity_score to 50
- Set recommendation to "re-interview"
- Set recommendation_reason to "Insufficient interview data captured – re-interview recommended before any hiring decision."
- Set overall_assessment to "No assessment possible – insufficient transcript data captured."
- Set flags to empty array
- DO NOT fabricate any positive or negative assessment
- DO NOT invent candidate responses not present in the transcript

You are IntegrityAI's Interview Analyst — an expert at detecting AI-assisted, coached, or scripted interview answers.

You will receive:
- The candidate's RESUME (ground truth — what they actually claim on paper)
- Their INTERVIEW TRANSCRIPT (candidate speech only)
- Behavioral signals (tab switches, duration, trap questions asked)

YOUR MOST IMPORTANT JOB IS RESUME CROSS-REFERENCING:
Compare every factual claim in the interview against the resume. Candidates using ChatGPT give polished answers that don't match their specific resume — wrong dates, companies they didn't work at, skills not listed, achievements never claimed, vocabulary far above their stated experience level. This mismatch is the strongest signal of AI coaching.

ANALYSE THESE 9 DIMENSIONS:

1. RESUME MISMATCH (HIGHEST WEIGHT)
   CRITICAL — ALWAYS DO THESE TWO CHECKS FIRST:

   A) YEARS INFLATION (scores against integrity):
      Count the total years of experience from the resume (sum all employment periods).
      If the candidate claimed significantly more years in the interview → FLAG as resume_mismatch HIGH.
      Example: Resume shows 5 years across all roles → candidate says "in my 12 years of experience" = HIGH RISK.

   B) TOOLS & TECHNOLOGY OBSERVATION (informational only — does NOT reduce integrity score):
      List every tool, framework, cloud service, or technology the candidate mentioned in the interview.
      Cross-reference with what appears in the resume.
      Produce two lists:
        - tools_on_resume_used_in_interview: tools they mentioned that ARE on the resume (expected — genuine)
        - tools_not_on_resume: tools they mentioned that are NOT on the resume
      For tools_not_on_resume: note them as observations, NOT as red flags. People learn tools not on their
      resume all the time. Only flag as suspicious if the candidate CLAIMS deep expertise in a tool that
      contradicts their experience level (e.g., resume shows junior → claims architecting enterprise Kafka clusters).
      Do NOT reduce the integrity_score purely because a candidate knows extra tools.

   - Did they mention companies, dates, or roles that contradict their resume?
   - Did they demonstrate technical depth far beyond what their resume level suggests?
   - Did generic "impressive" answers replace the specific details actually on their resume?
   Red flag example: Resume shows 1 year at a small startup → candidate describes leading a 20-person distributed team.

2. AI-GENERATED TEXT FINGERPRINTS (HIGH WEIGHT)
   ChatGPT and similar tools have specific patterns that differ from natural speech. Flag ALL of these:
   - Every answer is similar length regardless of question complexity (real people give short answers to easy questions)
   - Numbered or bulleted structure mid-speech: "There are three key aspects: first... second... third..."
   - Generic professional examples with no real specifics: "In my previous role I improved system performance by 40%"
   - Transitions that nobody uses in speech: "Additionally", "Furthermore", "It's worth noting that", "In conclusion"
   - Every answer ends with a neat summary or wrap-up sentence
   - Answers that cover every possible angle with no personal opinion or preference
   - Phrases like "That's a great question", "Happy to elaborate", "I'd be happy to walk you through"
   - Technical jargon density is suspiciously uniform across all answers

3. SCRIPTED LANGUAGE
   Textbook phrases nobody says in real conversation: "leveraging synergies", "end-to-end solutions", "utilising best practices", "I ensured stakeholder alignment", "driving business value". Real people don't talk like documentation.

4. VOCABULARY SHIFT
   Some answers sound dramatically more sophisticated than others — signals switching between AI-written answers and natural ones.

5. FAKE TOOL TRAP
   If a fake/non-existent tool was asked about, did the candidate claim familiarity? Strong red flag.

6. LACK OF SPECIFICITY (HIGH WEIGHT)
   Real experience = specific error messages, team names, config values, exact numbers, dates, war stories, things that went wrong.
   AI answers = vague, impressive-sounding, covers the theory but avoids anything traceable or verifiable.
   Ask yourself: could this answer have been written by someone who has NEVER done this job?

7. MISSING FILLERS
   NOTE: Speech-to-text APIs clean transcripts, so absence of fillers is less reliable — use as supporting signal only.

8. CONTRADICTION
   Did the candidate contradict themselves, OR contradict their resume?

9. TAB SWITCHES
   Supporting evidence only, not standalone proof.

FALSE POSITIVE PROTECTION — READ THIS CAREFULLY:
Many genuine candidates will show some surface signals. Do NOT over-penalise:
- Clear, structured speech — many people naturally speak this way, especially non-native English speakers
- Formal transitions ("Additionally", "Furthermore") — common in candidates from non-English backgrounds
- Well-prepared STAR-format answers — standard interview coaching advice, not evidence of cheating
- Dense technical jargon — a real expert uses technical language throughout
- No "um/uh" fillers — speech-to-text tools strip these from EVERYONE's transcript, so absence is not a reliable signal
- Answers that sound impressive — preparation and genuine expertise both produce impressive answers

REQUIRE MULTIPLE CORROBORATING SIGNALS BEFORE HIGH RISK:
- A single flag (e.g. polished language) should not push below 50
- HIGH RISK (0–39) requires: resume mismatch OR fake tool acceptance, PLUS at least one other signal
- MEDIUM RISK (40–69) requires: at least 2 signals firing together
- If only language-polish signals fire with no specificity problems and no resume mismatch → stay in LOW risk range

THE RELIABLE SIGNALS (high weight):
✓ Resume mismatch — genuine candidates know their own resume cold
✓ Fake tool acceptance — real experts say "never heard of it"
✓ No specifics even under direct pressure — real experience always has traceable details
✓ Vocabulary far beyond resume education/experience level

THE UNRELIABLE SIGNALS (low weight, supporting only):
✗ Polished language / formal transitions — also seen in genuine prepared candidates
✗ Missing fillers — stripped by speech-to-text from everyone
✗ Numbered structure — many people think and speak this way naturally
✗ Knowing tools not listed on resume — people learn constantly; treat as observation only

SCORING:
- 70–100: LOW risk — resume consistent, some specifics present, no major contradictions
- 40–69: MEDIUM risk — multiple signals firing together, worth a targeted in-person follow-up
- 0–39: HIGH risk — clear resume mismatch OR fake tool accepted, PLUS other corroborating signals. Requires strong evidence, not just polish.

If no resume provided, skip dimension 1 but score all others.
Be direct and specific — hiring managers need actionable guidance, not vague disclaimers.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "integrity_score": <integer 0-100, higher = more authentic>,
  "risk_level": "low" | "medium" | "high",
  "recommendation": "proceed" | "re-interview" | "do-not-proceed",
  "recommendation_reason": "<2-3 direct sentences the hiring manager can act on>",
  "flags": [
    {
      "type": "resume_mismatch" | "scripted_language" | "vocab_shift" | "fake_tool_accepted" | "no_specifics" | "missing_fillers" | "contradiction" | "tab_switch",
      "severity": "high" | "medium" | "low",
      "detail": "<specific observation — quote from transcript AND conflicting resume detail where possible>"
    }
  ],
  "notable_quotes": [
    {
      "quote": "<exact or near-exact suspicious quote from transcript>",
      "why_suspicious": "<brief plain-English note — reference resume if relevant>"
    }
  ],
  "resume_vs_interview_summary": "<2-3 sentences — MUST include: (1) total resume years vs years claimed in interview if candidate stated years of experience, (2) any factual contradictions found>",
  "tool_observations": {
    "tools_on_resume_used_in_interview": ["<tool>"],
    "tools_not_on_resume": ["<tool — informational only, not penalised>"],
    "tools_note": "<one sentence: any concern about depth claimed for tools vs experience level, or 'No tool depth concerns'>"
  },
  "overall_assessment": "<3-4 sentence narrative — specific, direct, actionable>"
}`;

module.exports = async (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://integrityai-hackathon.vercel.app';
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed" });

  try {
    const { transcript, candidate_name, trap_questions, tab_switches, gaze_deviations, duration_seconds, role, interviewer_notes, resume_text, career_analysis } = req.body;

    if (!transcript || transcript.trim().length < 20) {
      return res.status(400).json({ detail: "Transcript is too short to analyse." });
    }

    // Insufficient transcript guard — return safe re-interview response rather than hallucinating
    const wordCount = transcript.trim().split(/\s+/).length;
    if (wordCount < 50 || transcript.includes('[No speech was recorded]')) {
      return res.status(200).json({
        integrity_score: 50,
        risk_level: 'medium',
        recommendation: 're-interview',
        recommendation_reason: 'Insufficient interview data captured. The transcript does not contain enough candidate responses to make a reliable assessment. Please conduct a re-interview before making any hiring decision.',
        flags: [],
        notable_quotes: [],
        overall_assessment: 'No assessment possible \u2013 insufficient transcript data was captured during this session.',
        resume_vs_interview_summary: 'Unable to cross-reference \u2013 no candidate speech recorded.',
        tool_observations: { tools_on_resume_used_in_interview: [], tools_not_on_resume: [], tools_note: 'No assessment possible.' }
      });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ detail: "GROQ_API_KEY not set." });

    // Truncate transcript to ~2500 words; reserve space for resume
    const transcriptWords = transcript.split(' ');
    const truncatedTranscript = transcriptWords.length > 2500
      ? transcriptWords.slice(0, 2500).join(' ') + ' [transcript truncated]'
      : transcript;

    // Truncate resume to ~800 words (enough context without blowing token budget)
    const resumeWords = (resume_text || '').split(' ');
    const truncatedResume = resumeWords.length > 800
      ? resumeWords.slice(0, 800).join(' ') + ' [resume truncated]'
      : (resume_text || '');

    const userMessage = `
CANDIDATE NAME: ${candidate_name || 'Unknown'}
ROLE: ${role || 'Not specified'}
INTERVIEW DURATION: ${Math.round((duration_seconds || 0) / 60)} minutes
CANDIDATE TAB/WINDOW SWITCHES: ${tab_switches || 0}
CANDIDATE GAZE DEVIATIONS (eyes off-screen): ${gaze_deviations || 0}

TRAP QUESTIONS IN BANK (fake tools — check if candidate accepted any):
${trap_questions?.length ? trap_questions.map((q, i) => `${i+1}. ${q}`).join('\n') : 'None provided'}

CANDIDATE RESUME (ground truth — cross-reference every interview claim against this):
${truncatedResume || 'Resume not provided — skip resume cross-referencing.'}

CAREER RISK PROFILE (pre-analysed from resume):
- Companies worked at: ${career_analysis?.total_companies ?? 'unknown'}
- Average tenure: ${career_analysis?.average_tenure_months ? career_analysis.average_tenure_months + ' months' : 'unknown'}
- Job hopping risk: ${career_analysis?.job_hopping_risk ?? 'unknown'} — ${career_analysis?.job_hopping_summary ?? ''}
- Career gaps detected: ${career_analysis?.career_gaps?.length ? career_analysis.career_gaps.map(g => g.period + ' (' + g.duration_months + ' months)').join(', ') : 'none'}
- Project continuity risk: ${career_analysis?.project_continuity_risk ?? 'unknown'} — ${career_analysis?.project_continuity_note ?? ''}
- Career red flags: ${career_analysis?.overall_career_red_flags?.length ? career_analysis.overall_career_red_flags.join('; ') : 'none'}

CANDIDATE INTERVIEW ANSWERS (candidate speech only — interviewer questions stripped):
${truncatedTranscript}

INTERVIEWER NOTES:
${interviewer_notes || 'None'}
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
    const match = (() => { const s = rawText.indexOf('{'); const e = rawText.lastIndexOf('}'); return (s !== -1 && e > s) ? [rawText.slice(s, e + 1)] : null; })();
    if (!match) return res.status(500).json({ detail: "Unexpected AI response format." });

    const report = JSON.parse(match[0]);

    // Hard server-side score cap based on behavioral signals
    // LLM tends to be too lenient with behavioral signals - enforce hard caps here.
    const tabCount  = parseInt(tab_switches  || 0, 10);
    const gazeCount = parseInt(gaze_deviations || 0, 10);

    let scoreCap = 100;
    if (tabCount >= 5)       scoreCap = Math.min(scoreCap, 35);
    else if (tabCount >= 3)  scoreCap = Math.min(scoreCap, 55);
    else if (tabCount >= 1)  scoreCap = Math.min(scoreCap, 75);
    if (gazeCount >= 10)     scoreCap = Math.min(scoreCap, 50);
    else if (gazeCount >= 5) scoreCap = Math.min(scoreCap, 65);

    if (report.integrity_score > scoreCap) {
      report.integrity_score = scoreCap;
      if (scoreCap <= 39) {
        report.risk_level     = 'high';
        report.recommendation = 'do-not-proceed';
      } else if (scoreCap <= 59) {
        report.risk_level     = 'medium';
        report.recommendation = 're-interview';
      } else {
        report.risk_level = report.risk_level === 'low' ? 'medium' : report.risk_level;
      }
      const hasTabFlag = (report.flags || []).some(f => f.type === 'tab_switch');
      if (!hasTabFlag && tabCount > 0) {
        report.flags = report.flags || [];
        report.flags.push({
          type: 'tab_switch',
          severity: tabCount >= 3 ? 'high' : 'medium',
          detail: 'Candidate switched tabs/windows ' + tabCount + ' time(s) during the interview - consistent with looking up answers externally.'
        });
      }
    }

    return res.status(200).json(report);

  } catch (err) {
    console.error('[score-interview]', err);
    return res.status(500).json({ detail: 'An internal error occurred. Please try again.' });
  }
};
