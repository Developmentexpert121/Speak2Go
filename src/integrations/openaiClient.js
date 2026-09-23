const OpenAI = require("openai");

const config = require("../config");
const { buildRubricPrompt, SCORING_SYSTEM } = require("../prompts/rubricScoring");

const MODEL = config.openai.model;

let client;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}

/**
 * One chat completion. Exported so every OpenAI call in the service goes
 * through a single client and a single model setting.
 */
async function createChatCompletion({ messages, temperature = 0, seed, responseFormat }) {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages,
    temperature,
    ...(seed !== undefined ? { seed } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });
  return response.choices[0].message.content;
}

/**
 * Calls the LLM to evaluate one question's transcript against the rubric.
 */
async function scoreQuestionAgainstRubric({ questionText, transcript, audioMetrics, criteria, priorContext, referenceMaterial }) {
  const prompt = buildRubricPrompt({ questionText, transcript, audioMetrics, criteria, priorContext, referenceMaterial });

  let response;
  try {
    response = await getClient().chat.completions.create({
      model: MODEL,
      temperature: 0,
      // temperature:0 narrows sampling but is not a determinism guarantee —
      // the same audio has come back 49.50 on one run and 0.00 on the next.
      // A fixed seed asks the API for reproducible sampling on top of that.
      // Best-effort (OpenAI documents it as such), so it is a second line of
      // defence, not the fix: the real safeguard is the rubric cross-check in
      // applyPenalties, which stops a flag flip from costing a whole answer.
      seed: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SCORING_SYSTEM },
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

module.exports = { scoreQuestionAgainstRubric, createChatCompletion, MODEL };
