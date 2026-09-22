const PAUSE_THRESHOLD_SECONDS = parseFloat(process.env.PAUSE_THRESHOLD_SECONDS || "3");
const FILLER_WORDS = new Set(["um", "uh", "uhh", "umm", "erm", "ah", "hmm"]);

/**
 * Computes speech metrics from Deepgram's word-level output.
 * @param {object} sttResult - output of transcribeAudioFile()
 */
function computeAudioMetrics(sttResult) {
  const { words, durationSeconds, transcript } = sttResult;

  if (!words || words.length === 0) {
    return {
      wordCount: 0,
      speakingDurationSeconds: 0,
      totalDurationSeconds: durationSeconds || 0,
      wpm: 0,
      pauses: [],
      pauseCount: 0,
      longestPauseSeconds: 0,
      fillerWordCount: 0,
      fluencyLevel: 1,
      fluencyLabel: "Fluency level is Fragmented (1 of 4)",
      isEffectivelyEmpty: true,
      // Must be present here too — this branch previously omitted it, leaving
      // the flag `undefined` for empty files. Nothing broke only because
      // applyPenalties happens to test isEffectivelyEmpty first.
      isUnder20Seconds: (durationSeconds || 0) < 20,
    };
  }

  // 1. Pause detection: gap between end of word[i] and start of word[i+1]
  const pauses = [];
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= PAUSE_THRESHOLD_SECONDS) {
      pauses.push({
        afterWord: words[i].punctuated_word || words[i].word,
        gapSeconds: Number(gap.toFixed(2)),
        atTimestamp: Number(words[i].end.toFixed(2)),
      });
    }
  }

  // 2. Speaking duration = total duration minus silence gaps (a simple proxy)
  const totalPauseSeconds = pauses.reduce((sum, p) => sum + p.gapSeconds, 0);
  const speakingDurationSeconds = Math.max(durationSeconds - totalPauseSeconds, 0.01);

  // 3. Words per minute, based on actual speaking time (not dead air)
  const wordCount = words.length;
  const wpm = Math.round((wordCount / speakingDurationSeconds) * 60);

  // 4. Filler word count (relies on Deepgram filler_words:true output,
  //    with a lexical fallback in case a word slips through untagged)
  const fillerWordCount = words.filter((w) =>
    FILLER_WORDS.has((w.word || "").toLowerCase().replace(/[.,!?]/g, ""))
  ).length;

  // 5. Fluency level (4-of-4 scale) — heuristic combining pause frequency + fillers.
  //    Tune these thresholds against real graded exams once you have sample data.
  const pausesPerMinute = pauses.length / (speakingDurationSeconds / 60);
  const fillerRatio = fillerWordCount / wordCount;

  let fluencyLevel;
  if (pausesPerMinute <= 1 && fillerRatio < 0.03) {
    fluencyLevel = 4; // "almost no hesitations"
  } else if (pausesPerMinute <= 3 && fillerRatio < 0.06) {
    fluencyLevel = 3; // "some hesitations"
  } else if (pausesPerMinute <= 6 && fillerRatio < 0.12) {
    fluencyLevel = 2; // "many hesitations"
  } else {
    fluencyLevel = 1; // "mostly hesitant"
  }

  const fluencyLabels = {
    4: "Fluency level is Fluent (4 of 4)",
    3: "Fluency level is Functional (3 of 4)",
    2: "Fluency level is Halting (2 of 4)",
    1: "Fluency level is Fragmented (1 of 4)",
  };

  return {
    wordCount,
    speakingDurationSeconds: Number(speakingDurationSeconds.toFixed(2)),
    totalDurationSeconds: Number(durationSeconds.toFixed(2)),
    wpm,
    pauses,
    pauseCount: pauses.length,
    longestPauseSeconds: pauses.length
      ? Math.max(...pauses.map((p) => p.gapSeconds))
      : 0,
    fillerWordCount,
    fluencyLevel,
    fluencyLabel: fluencyLabels[fluencyLevel],
    isEffectivelyEmpty: transcript.trim().length === 0,
    isUnder20Seconds: durationSeconds < 20, // maps directly to your penalty rule
  };
}

module.exports = { computeAudioMetrics, PAUSE_THRESHOLD_SECONDS };
