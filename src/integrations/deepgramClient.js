const { createClient } = require("@deepgram/sdk");
const fs = require("fs");

const config = require("../config");

/**
 * The SDK client, built on first use rather than at import.
 *
 * Constructing it at module load threw "A deepgram API key is required" the
 * moment anything imported this file without the key set — which meant the
 * whole Express app could not even be required in an environment without
 * credentials, so integration tests could not boot it. Deferring the
 * construction keeps the failure where it belongs: on the call that actually
 * needs to transcribe something.
 */
let client;
function getClient() {
  if (!client) client = createClient(config.deepgram.apiKey);
  return client;
}

/**
 * Transcribes a local audio file using Deepgram (nova-2 model),
 * requesting word-level timestamps, filler words, and smart formatting.
 *
 * @param {string} filePath - path to a local audio file (wav/mp3/m4a...)
 * @returns {Promise<object>} normalized transcription result
 */
async function transcribeAudioFile(filePath) {
  const audioBuffer = fs.readFileSync(filePath);

  const { result, error } = await getClient().listen.prerecorded.transcribeFile(
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
