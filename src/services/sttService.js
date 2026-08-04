const { createClient } = require("@deepgram/sdk");
const fs = require("fs");

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Transcribes a local audio file using Deepgram (nova-2 model),
 * requesting word-level timestamps, filler words, and smart formatting.
 *
 * @param {string} filePath - path to a local audio file (wav/mp3/m4a...)
 * @returns {Promise<object>} normalized transcription result
 */
async function transcribeAudioFile(filePath) {
  const audioBuffer = fs.readFileSync(filePath);

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: "nova-2",
      language: "en",
      smart_format: true,
      punctuate: true,
      filler_words: true,   // flags "um", "uh", etc. in the transcript
      utterances: true,     // groups words into utterances w/ start/end
      diarize: false,       // single speaker (the student) expected
    }
  );

  if (error) {
    throw new Error(`Deepgram transcription failed: ${error.message}`);
  }

  const channel = result.results.channels[0];
  const alt = channel.alternatives[0];

  return {
    transcript: alt.transcript,
    confidence: alt.confidence,
    words: alt.words, // [{ word, start, end, confidence, punctuated_word }, ...]
    utterances: result.results.utterances || [],
    durationSeconds: result.metadata.duration,
  };
}

module.exports = { transcribeAudioFile };
