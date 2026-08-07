/**
 * Student recording retrieval.
 *
 * Replaces the earlier s3.js, which fetched `s3Url` directly over plain HTTPS.
 * That approach cannot work, and not because credentials are missing — it is
 * the wrong door. Reading the live app source settled it:
 *
 *   - Recordings are NOT in their own collection. They are embedded in the
 *     student document as `users.freeSpeechArray[]`, upserted by
 *     `services/usersDb.js:updateFreeSpeech()` keyed on `idDetection`.
 *
 *   - The bucket (`s2g-recordings`) is private. The only read path is
 *     `GET /api/v1/upload/getRecording?userEmail=&idDetection=`
 *     (routes/upload.js:274), which authenticates the caller, authorizes
 *     against `SemelMosad`, looks up the freeSpeechArray entry to recover the
 *     real S3 `key`, and streams the object back as audio/mp3.
 *
 * So the unit of retrieval is (userEmail, idDetection) — never a URL. That
 * also means access is per-school: a teacher token only reaches students whose
 * SemelMosad matches. Handing us a bucket key would bypass that check, so the
 * endpoint is the correct integration point regardless.
 *
 * Until the client issues a service token, listing works (from their exported
 * sample) and fetching returns a precise 502 naming what is missing.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");

const { computeTimeBasedDeduction } = require("../src/utils/timeBasedDeduction");

const REFERENCE_FILE = path.join(__dirname, "..", "db_reference", "sample_recordings.json");

/** Where the Speak2Go app lives, and the token that authenticates us to it. */
const APP_BASE_URL = process.env.SPEAK2GO_API_URL || "";
const APP_TOKEN = process.env.SPEAK2GO_API_TOKEN || "";
const RECORDING_PATH = "/api/v1/upload/getRecording";

/** True when we can actually pull audio rather than just list it. */
function canFetchRecordings() {
  return Boolean(APP_BASE_URL && APP_TOKEN);
}

/**
 * Normalize one freeSpeechArray entry.
 *
 * `duration` is the interesting field: it is recorded at capture time and
 * stored on the entry, so the spec 4.C time-based deduction band is knowable
 * BEFORE any audio is downloaded or transcribed. The UI uses this to warn that
 * an answer will be penalised while the operator can still swap it out.
 */
function normalize(r, i) {
  const duration = r.duration != null && r.duration !== "" ? Number(r.duration) : null;
  return {
    index: i,
    // the client's export really does spell it "userEmai"
    userEmail: r.userEmai ?? r.userEmail ?? null,
    lessonId: r.lessonId ?? null,
    idDetection: r.idDetection ?? null,
    questionText: r.questionText ?? "",
    duration,
    recordTime: r.recordTime ?? null,
    // Advisory only — the authoritative deduction is computed by the pipeline
    // from the transcript's measured speech duration, not from this field.
    timeBand: duration != null ? computeTimeBasedDeduction(duration) : null,
  };
}

function listSampleRecordings() {
  if (!fs.existsSync(REFERENCE_FILE)) return [];
  return JSON.parse(fs.readFileSync(REFERENCE_FILE, "utf-8")).map(normalize);
}

/**
 * Group recordings the way the data is actually shaped: by student, then by
 * lesson. The old grouping was lesson-first, which scattered one student's
 * answers across the list — but an exam run is always one student's set of
 * answers to one lesson, so student->lesson is the unit you actually pick.
 */
function listByStudent() {
  const students = new Map();

  for (const rec of listSampleRecordings()) {
    const email = rec.userEmail || "(unknown)";
    if (!students.has(email)) students.set(email, new Map());
    const lessons = students.get(email);
    if (!lessons.has(rec.lessonId)) lessons.set(rec.lessonId, []);
    lessons.get(rec.lessonId).push(rec);
  }

  return [...students.entries()]
    .map(([userEmail, lessons]) => ({
      userEmail,
      lessons: [...lessons.entries()]
        .map(([lessonId, recordings]) => ({
          lessonId,
          recordingCount: recordings.length,
          // Chronological order is the best available proxy for question
          // order: the platform gives us no per-answer sequence number.
          recordings: recordings.sort((a, b) =>
            String(a.recordTime).localeCompare(String(b.recordTime))
          ),
        }))
        .sort((a, b) => b.recordingCount - a.recordingCount),
    }))
    .sort((a, b) => a.userEmail.localeCompare(b.userEmail));
}

/**
 * Fetch one recording to a local temp file.
 *
 * @param {object} params
 * @param {string} params.userEmail
 * @param {string} params.idDetection
 * @returns {Promise<string>} local file path
 */
function downloadRecording({ userEmail, idDetection }) {
  return new Promise((resolve, reject) => {
    if (!userEmail || !idDetection) {
      return reject(new Error("Both userEmail and idDetection are required to fetch a recording."));
    }
    if (!canFetchRecordings()) {
      return reject(
        new Error(
          "Cannot fetch recordings yet. The audio sits in the private s2g-recordings bucket " +
            "and is only readable through the Speak2Go app endpoint " +
            `${RECORDING_PATH}, which requires authentication. Set SPEAK2GO_API_URL and ` +
            "SPEAK2GO_API_TOKEN in .env to enable this path. Until then, upload the audio manually."
        )
      );
    }

    const url = new URL(APP_BASE_URL);
    url.pathname = RECORDING_PATH;
    url.searchParams.set("userEmail", userEmail);
    url.searchParams.set("idDetection", idDetection);

    const client = url.protocol === "http:" ? http : https;
    const tmpPath = path.join(
      os.tmpdir(),
      `s2g_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`
    );

    client
      .get(
        url,
        { headers: { Authorization: `Bearer ${APP_TOKEN}` } },
        (res) => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            res.resume();
            return reject(
              new Error(
                "Speak2Go rejected our token (HTTP " +
                  res.statusCode +
                  "). The endpoint authorizes by role: admin/account-manager can read any " +
                  "student, a teacher only students sharing their SemelMosad. The service " +
                  "account needs one of those roles."
              )
            );
          }
          if (res.statusCode >= 400) {
            res.resume();
            return reject(
              new Error(
                `Recording fetch failed with HTTP ${res.statusCode}. The app returns 500 with ` +
                  `"Cant find combination of email + id detection" when the freeSpeechArray ` +
                  `entry is missing, so check the idDetection is current.`
              )
            );
          }

          const file = fs.createWriteStream(tmpPath);
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve(tmpPath)));
          file.on("error", reject);
        }
      )
      .on("error", (err) => reject(new Error(`Recording fetch failed: ${err.message}`)));
  });
}

module.exports = {
  canFetchRecordings,
  listSampleRecordings,
  listByStudent,
  downloadRecording,
  RECORDING_PATH,
};
