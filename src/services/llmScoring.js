const OpenAI = require("openai");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
let client;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * Builds the evaluation prompt for a single question.
 * Audio metrics are injected as objective evidence so the LLM doesn't
 * have to "guess" fluency/pace from text alone.
 */
function buildPrompt({ questionText, transcript, audioMetrics, criteria, priorContext, referenceMaterial }) {
  const rubricForPrompt = criteria.map((c) => ({
    criterion_name: c.criterion_name,
    sub_criteria: c.sub_criteria.map((sc) => ({
      id: sc.id,
      name: sc.name,
      levels: sc.levels, // { "100": "...", "75": "...", "54": "...", "25": "..." }
    })),
  }));

  // Prior answers in the same question set (e.g. 1a before 1b) are given as
  // READ-ONLY context — they inform coherence/relevance judgments on THIS
  // answer, but must never be re-scored or have their content credited to
  // this question's score.
  const contextBlock = (priorContext && priorContext.length)
    ? `
PRIOR ANSWERS IN THIS QUESTION SET (context only — do not score these, they are already graded separately):
${priorContext.map((p) => `Q${p.question_id} ("${p.question_text}"): """${p.transcript}"""`).join("\n")}

Use this only to judge whether the CURRENT answer is consistent, non-repetitive, and appropriately builds on or complements what came before. Do not credit this answer for content that only appears in a prior answer.
`
    : "";

  // Part C only: the transcript of the video/audio clip the student watched
  // before answering.  When present, the LLM uses it as ground truth to judge
  // whether the student correctly identified and discussed the clip's content.
  const refBlock = referenceMaterial
    ? `
PART C REFERENCE CLIP TRANSCRIPT (the material the student was asked to watch/listen to — use this as ground truth for Topic Development, content accuracy, and relevance):
"""${referenceMaterial}"""
`
    : "";

  return `You are an examiner scoring a student's spoken English answer for the Israeli Ministry of Education COBE oral exam, following the official rubric EXACTLY.

QUESTION ASKED:
"""${questionText}"""
${contextBlock}${refBlock}
STUDENT TRANSCRIPT (from speech-to-text) — this is the ONLY answer being scored:
"""${transcript}"""

OBJECTIVE SPEECH METRICS (measured from the audio, treat as ground truth for delivery/fluency judgments):
- Words per minute: ${audioMetrics.wpm}
- Number of pauses over ${process.env.PAUSE_THRESHOLD_SECONDS || 3}s: ${audioMetrics.pauseCount}
- Longest pause: ${audioMetrics.longestPauseSeconds}s
- Filler word count: ${audioMetrics.fillerWordCount} (out of ${audioMetrics.wordCount} words)
- Pre-computed fluency level: ${audioMetrics.fluencyLabel}

RUBRIC (for each sub-criterion, choose exactly ONE level: 100, 75, 54, or 25):
${JSON.stringify(rubricForPrompt, null, 2)}

INSTRUCTIONS:
- For "Fluency" and "Speech quality" sub-criteria, weight the OBJECTIVE SPEECH METRICS heavily rather than re-guessing from the text.
- For all other sub-criteria, judge from the transcript content only.
- Pick the single closest level per sub-criterion. Do not average or invent scores.
- Additionally, check the transcript for three specific issues that trigger automatic deductions regardless of rubric score (per Ministry of Education policy):
  1. foul_language: true if the transcript contains cursing, swearing, or explicit foul language
  2. non_english: true if the answer is substantially in a language other than English (religious holidays and national celebration names in another language are allowed and should NOT trigger this)
  3. unintelligible: true if the transcript is largely incoherent, garbled, or nonsensical (not the same as merely short or low-scoring — an answer can be short and still perfectly intelligible)
- Return ONLY valid JSON, no markdown, no commentary, in exactly this shape:

{
  "content_flags": {
    "foul_language": false,
    "non_english": false,
    "unintelligible": false,
    "flag_reasoning": "<one short sentence, empty string if all flags false>"
  },
  "sub_criteria_scores": [
    { "id": "sc1_relevancy", "selected_level": 100, "justification": "<one short sentence>" },
    ...
  ]
}`;
}

/**
 * Calls the LLM to evaluate one question's transcript against the rubric.
 */
async function scoreQuestionAgainstRubric({ questionText, transcript, audioMetrics, criteria, priorContext, referenceMaterial }) {
  const prompt = buildPrompt({ questionText, transcript, audioMetrics, criteria, priorContext, referenceMaterial });

  let response;
  try {
    response = await getClient().chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a strict, consistent rubric-based exam evaluator. Always return valid JSON only." },
        { role: "user", content: prompt },
      ],
    });
  } catch (err) {
    // Surface the actual model string being used and the full API error detail,
    // since the SDK's default error message alone (e.g. "400 invalid model ID")
    // doesn't tell you *which* model string it tried.
    const detail = err.error ? JSON.stringify(err.error) : err.message;
    throw new Error(`OpenAI request failed using model="${MODEL}": ${detail}`);
  }

  const raw = response.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`LLM did not return valid JSON: ${raw}`);
  }

  return {
    subCriteriaScores: parsed.sub_criteria_scores, // [{ id, selected_level, justification }, ...]
    contentFlags: parsed.content_flags || { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" },
  };
}

module.exports = { scoreQuestionAgainstRubric };
