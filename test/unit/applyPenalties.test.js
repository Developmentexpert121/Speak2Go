const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  applyPenalties,
  UNINTELLIGIBLE_RAW_SCORE_CEILING,
} = require(path.join(__dirname, "..", "..", "src", "utils", "applyPenalties.js"));

const OK_AUDIO = { isEffectivelyEmpty: false, isUnder20Seconds: false };
const NO_FLAGS = { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" };

const run = (rawScore, flags = {}, audioMetrics = OK_AUDIO) =>
  applyPenalties({
    rawScore,
    audioMetrics,
    transcript: "some answer",
    contentFlags: { ...NO_FLAGS, ...flags },
  });

/* ── the rubric cross-check on `unintelligible` ────────── */

test("unintelligible is honoured when the rubric agrees the answer is bottom-band", () => {
  const { finalScore, deductions, suppressedFlags } = run(22, {
    unintelligible: true,
    flag_reasoning: "word salad",
  });

  assert.equal(finalScore, 0);
  assert.equal(deductions.length, 1);
  assert.match(deductions[0].reason, /Unintelligible language/);
  assert.equal(suppressedFlags.length, 0);
});

test("unintelligible is suppressed when the rubric scored the answer mid-range", () => {
  // The exact case from the client's Simulation 2 sample: the evaluator
  // flagged answers the rubric had scored 48.0 and 52.1, zeroing them.
  for (const rawScore of [48.0, 52.1]) {
    const { finalScore, deductions, suppressedFlags } = run(rawScore, {
      unintelligible: true,
      flag_reasoning: "lacks coherence and depth",
    });

    assert.equal(finalScore, rawScore, `raw ${rawScore} should survive the flag`);
    assert.equal(deductions.length, 0);
    assert.equal(suppressedFlags.length, 1);
    assert.equal(suppressedFlags[0].flag, "unintelligible");
    assert.equal(suppressedFlags[0].rawScore, rawScore);
  }
});

test("the ceiling sits between the rubric's bottom two levels, and is exclusive", () => {
  // Levels are 25/54/75/100, so the midpoint is 39.5. At the ceiling the
  // rubric is no longer closer to "bottom band" and the flag must not apply.
  assert.equal(UNINTELLIGIBLE_RAW_SCORE_CEILING, 39.5);

  assert.equal(run(39.49, { unintelligible: true }).finalScore, 0);
  assert.equal(run(39.5, { unintelligible: true }).finalScore, 39.5);
});

test("a suppressed flag records why, so a contested grade can be explained", () => {
  const { suppressedFlags } = run(48, { unintelligible: true, flag_reasoning: "off topic" });

  assert.equal(suppressedFlags[0].reason, "off topic");
  assert.equal(suppressedFlags[0].ceiling, UNINTELLIGIBLE_RAW_SCORE_CEILING);
  assert.match(suppressedFlags[0].explanation, /rubric score stands/);
});

/* ── the observational flags stay unconditional ────────── */

test("foul language zeroes an otherwise excellent answer", () => {
  const { finalScore, deductions, suppressedFlags } = run(95, {
    foul_language: true,
    flag_reasoning: "explicit slur",
  });

  assert.equal(finalScore, 0);
  assert.match(deductions[0].reason, /Foul language/);
  assert.equal(suppressedFlags.length, 0);
});

test("a fluent answer in the wrong language still scores zero", () => {
  const { finalScore, deductions } = run(88, { non_english: true, flag_reasoning: "answered in Hebrew" });

  assert.equal(finalScore, 0);
  assert.match(deductions[0].reason, /not in English/);
});

/* ── audio rules, unchanged ────────────────────────────── */

test("empty and under-20s zero the answer, and empty takes precedence", () => {
  const empty = run(0, {}, { isEffectivelyEmpty: true, isUnder20Seconds: true });
  assert.equal(empty.deductions.length, 1);
  assert.equal(empty.deductions[0].reason, "Empty file");

  const short = run(70, {}, { isEffectivelyEmpty: false, isUnder20Seconds: true });
  assert.equal(short.finalScore, 0);
  assert.equal(short.deductions[0].reason, "Answer under 20 seconds of speech");
});

test("deductions do not stack — the worst applicable one is used", () => {
  const { finalScore, deductions } = run(20, {
    unintelligible: true,
    foul_language: true,
  }, { isEffectivelyEmpty: false, isUnder20Seconds: true });

  assert.equal(deductions.length, 3);
  assert.equal(finalScore, 0); // 20 × (1 − 100/100), not compounded below zero
});

test("a clean answer keeps its raw score exactly", () => {
  const { finalScore, deductions, suppressedFlags } = run(73.17);

  assert.equal(finalScore, 73.17);
  assert.equal(deductions.length, 0);
  assert.equal(suppressedFlags.length, 0);
});
