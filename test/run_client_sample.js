require("dotenv").config();

/**
 * MANUAL TEST — the client's "Simulation 2 2024 COBE FP" sample folder.
 *
 * The folder holds one sub-folder per exam part, each containing loose mp3s
 * named "<email>.<question name>.mp3". It is NOT a set of complete exams:
 * the students differ from part to part and Part B is empty, so this script
 * groups the files by student e-mail and grades whatever each one actually
 * submitted. Slots with no recording are omitted from the question list, so
 * evaluateFullExam reports them under `unattempted_questions` and forfeits
 * their points against the fixed 100-point total — which is exactly what a
 * real partial attempt should do.
 *
 * Usage:
 *   node test/run_client_sample.js                  # every student
 *   node test/run_client_sample.js 0219902194       # one student (substring match)
 *   node test/run_client_sample.js --dry            # inventory only, no API calls
 *
 * Costs one Deepgram + one OpenAI call per recording, plus one OpenAI call
 * per student for the recommendations. --dry first if you just want the map.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { evaluateFullExam } = require("../src/pipeline/evaluateFullExam");
const { buildReportObject } = require("../src/report/buildReportObject");
const { generateRecommendations } = require("../src/report/generateRecommendations");
const { COBE_BLUEPRINT } = require("../src/config/examBlueprint");
const { DEFAULT_QUESTION_TEXTS, DEFAULT_PART_C_TRANSCRIPT } = require("../server/defaults");

const SAMPLE_DIR =
  process.env.SAMPLE_DIR ||
  path.join(__dirname, "..", "..", "Simulation 2 2024 COBE FP");

/** Folder name -> blueprint question_id. Part B has no files but is listed
 *  so a future drop into that folder is picked up without a code change. */
const FOLDER_TO_QUESTION = {
  "Part A Q1": "1a",
  "Part A Q2": "1b",
  "Part B": "2",
  "Part C Q1": "3",
  "Part C Q2": "4",
};

const LEVEL = "5_UNITS_B2";

/* ── inventory ─────────────────────────────────────────── */

/**
 * Walks the sample folder and returns { [email]: { [question_id]: filePath } }.
 *
 * Two files in the drop are byte-identical copies with a " (1)" suffix, the
 * usual double-download artefact. Keeping both would mean grading the same
 * answer twice, so files are de-duplicated by content hash per (student,
 * question) and the shortest name wins.
 */
function buildInventory() {
  const byStudent = {};
  const duplicates = [];

  for (const [folder, questionId] of Object.entries(FOLDER_TO_QUESTION)) {
    const dir = path.join(SAMPLE_DIR, folder);
    if (!fs.existsSync(dir)) continue;

    const seenHashes = new Map(); // `${email}|${hash}` -> keptPath

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".mp3"))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));

    for (const file of files) {
      const full = path.join(dir, file);
      const email = file.split(".")[0];
      const hash = crypto.createHash("md5").update(fs.readFileSync(full)).digest("hex");
      const key = `${email}|${hash}`;

      if (seenHashes.has(key)) {
        duplicates.push({ kept: path.basename(seenHashes.get(key)), dropped: file });
        continue;
      }
      seenHashes.set(key, full);

      byStudent[email] = byStudent[email] || {};
      byStudent[email][questionId] = full;
    }
  }

  return { byStudent, duplicates };
}

/* ── grading ───────────────────────────────────────────── */

function buildQuestions(answers) {
  // Only the slots this student actually recorded. Everything else falls
  // through to unattempted_questions and forfeits its points.
  return COBE_BLUEPRINT.filter((bp) => answers[bp.question_id]).map((bp) => ({
    question_id: bp.question_id,
    description: bp.description,
    part: bp.part,
    weight: bp.points,
    question_text: DEFAULT_QUESTION_TEXTS[bp.question_id] || "",
    audioFilePath: answers[bp.question_id],
    // Part C is scored against the clip the student watched; A and B have no
    // ground truth to compare against and evaluateQuestion ignores the field.
    referenceMaterial: bp.part === "C" ? DEFAULT_PART_C_TRANSCRIPT : null,
  }));
}

async function gradeStudent(email, answers) {
  const questions = buildQuestions(answers);
  const started = Date.now();

  const exam = await evaluateFullExam({ questions, level: LEVEL });
  const recommendations = await generateRecommendations(exam);
  const report = buildReportObject(exam, recommendations);

  return { email, exam, report, elapsedMs: Date.now() - started };
}

/* ── output ────────────────────────────────────────────── */

const pad = (s, n) => String(s).padEnd(n);
const num = (n, d = 2) => Number(n).toFixed(d);

function printInventory(byStudent, duplicates) {
  const ids = COBE_BLUEPRINT.map((b) => b.question_id);
  console.log(`\nSample folder: ${SAMPLE_DIR}\n`);
  console.log(pad("student", 26) + ids.map((i) => pad(i, 5)).join("") + " submitted");
  console.log("-".repeat(26 + ids.length * 5 + 10));

  for (const email of Object.keys(byStudent).sort()) {
    const a = byStudent[email];
    const n = ids.filter((i) => a[i]).length;
    console.log(
      pad(email, 26) + ids.map((i) => pad(a[i] ? "Y" : "·", 5)).join("") + ` ${n}/${ids.length}`
    );
  }

  const totalFiles = Object.values(byStudent).reduce((s, a) => s + Object.keys(a).length, 0);
  console.log(
    `\n${Object.keys(byStudent).length} students, ${totalFiles} recordings after de-duplication.`
  );
  for (const d of duplicates) console.log(`  duplicate dropped: ${d.dropped}`);
}

function printResults(results) {
  console.log("\n\n=== RESULTS ===\n");
  console.log(
    pad("student", 26) +
      pad("score", 8) +
      pad("earned", 9) +
      pad("answered", 10) +
      pad("forfeited", 11) +
      "per-question"
  );
  console.log("-".repeat(100));

  for (const r of results) {
    if (r.error) {
      console.log(pad(r.email, 26) + "ERROR  " + r.error);
      continue;
    }
    const forfeited = r.exam.unattempted_questions.reduce((s, u) => s + u.points_forfeited, 0);
    const per = r.exam.question_results
      .map((q) => `${q.question_id}:${num(q.final_question_score, 1)}`)
      .join(" ");
    console.log(
      pad(r.email, 26) +
        pad(num(r.exam.overall_score), 8) +
        pad(`${num(r.exam.points_earned)}/${r.exam.points_possible}`, 9) +
        pad(`${r.exam.question_results.length}/5`, 10) +
        pad(num(forfeited, 1), 11) +
        per
    );
  }
}

function printDetail(results) {
  console.log("\n\n=== PER-ANSWER DETAIL ===");
  for (const r of results) {
    if (r.error) continue;
    console.log(`\n${r.email}  —  ${num(r.exam.overall_score)}/100`);
    for (const q of r.exam.question_results) {
      const m = q.audio_metrics || {};
      const ded = (q.deductions || []).map((d) => `−${d.deductionPct}% ${d.reason}`).join("; ");
      console.log(
        `  ${pad(q.question_id, 4)}raw ${pad(num(q.raw_score, 1), 7)}final ${pad(
          num(q.final_question_score, 1),
          8
        )}${pad(`${num(m.totalDurationSeconds, 1)}s`, 8)}${pad(`${m.wpm ?? 0} wpm`, 10)}${
          ded || ""
        }`
      );
      if (q.transcript) console.log(`        "${q.transcript.slice(0, 120).replace(/\s+/g, " ")}…"`);
      else console.log(`        (no transcript)`);
    }
    for (const u of r.exam.unattempted_questions) {
      console.log(`  ${pad(u.question_id, 4)}NOT SUBMITTED — forfeits ${u.points_forfeited} pts`);
    }
  }
}

/* ── main ──────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const filter = args.find((a) => !a.startsWith("--"));

  if (!fs.existsSync(SAMPLE_DIR)) {
    console.error(`Sample folder not found: ${SAMPLE_DIR}`);
    console.error(`Set SAMPLE_DIR=/path/to/folder to point somewhere else.`);
    process.exit(1);
  }

  const { byStudent, duplicates } = buildInventory();
  printInventory(byStudent, duplicates);

  if (dry) return;

  const emails = Object.keys(byStudent)
    .sort()
    .filter((e) => !filter || e.includes(filter));

  if (!emails.length) {
    console.error(`\nNo student matched "${filter}".`);
    process.exit(1);
  }

  console.log(`\nGrading ${emails.length} student(s)…\n`);

  const results = [];
  for (const email of emails) {
    const answers = byStudent[email];
    process.stdout.write(`  ${pad(email, 26)} ${Object.keys(answers).length} answer(s) … `);
    try {
      const r = await gradeStudent(email, answers);
      console.log(`${num(r.exam.overall_score)}/100  (${(r.elapsedMs / 1000).toFixed(1)}s)`);
      results.push(r);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      results.push({ email, error: err.message });
    }
  }

  printResults(results);
  printDetail(results);

  // A filtered run must not overwrite the full run's output — re-grading one
  // student to check something should never cost you the other fourteen.
  const outPath = path.join(
    __dirname,
    filter ? `client_sample_results.${filter}.json` : "client_sample_results.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n\nFull output written to ${outPath}`);
}

main().catch((err) => {
  console.error("run_client_sample failed:", err);
  process.exit(1);
});
