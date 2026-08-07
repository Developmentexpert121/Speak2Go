# COBE_Exam_Tester

Automated evaluation of the Israeli Ministry of Education **COBE oral English
exam**. A student's recorded answers go in; a scored, explained report comes
out — as JSON, HTML, or PDF.

Originally developed by Himali for Speak2Go.

---

## What it actually does

Seven stages. Only one of them involves model judgement, and it is deliberately
boxed in:

| # | Stage | What happens | Deterministic? |
|---|-------|--------------|----------------|
| 1 | Audio intake | Answer uploaded, or pulled from the Speak2Go platform | — |
| 2 | Speech-to-text | Deepgram `nova-2`, with word-level timings | external |
| 3 | Speech metrics | Words per minute, long pauses, filler words, fluency level | **yes** |
| 4 | Rubric scoring | Model picks one of four fixed levels per sub-criterion | **no** |
| 5 | Aggregation | Sub-criteria → criteria → question score | **yes** |
| 6 | Penalties | Time bands, coverage, content flags | **yes** |
| 7 | Report | Scored out of 100, rendered to HTML/PDF | **yes** |

Stage 4 is the only place the model has a say, and it cannot invent a number —
it must choose **25, 54, 75, or 100** for each sub-criterion. Everything that
happens to the score afterwards is arithmetic you can check by hand.

That split is the whole design. A grade that gets disputed has to be
explainable, and "the model felt it was a 63" is not an explanation.

### The rubric

Four criteria, applied identically at every supported level:

| Criterion | Weight | Sub-criteria |
|---|---|---|
| Topic Development | 50% | relevancy, prompt understanding, answer logic, answer development |
| Vocabulary | 20% | vocabulary range |
| Delivery | 15% | speech quality, fluency |
| Language | 15% | correct grammar, English only |

For the two Delivery sub-criteria the model is told to weight the **measured**
speech metrics from stage 3 over its own impression of the transcript — it
should not be guessing at pace from text when the audio was actually timed.

### Exam layout

An exam is **always marked out of 100**, whether or not the student attempted
every question. An unanswered question scores 0 rather than shrinking the
denominator — otherwise answering less would raise your average.

| Question | Part | Points |
|---|---|---|
| 1a, 1b | A — Personal Response | 12.5 each |
| 2 | B — Project Presentation | 25 |
| 3, 4 | C — Audio-Visual Response | 25 each |

Some 2023-era lessons split Part B into two questions instead of one. The
blueprint handles both shapes and still totals 100.

### Levels

| Level | CEFR | Status |
|---|---|---|
| 5 points | B2 | supported |
| 4 points | B1 | supported |
| 3 points (Boost) | A2 | **blocked — no rubric supplied** |

Boost is in the specification but no Boost rubric exists in any document
supplied so far. The MoE Table of Specs and the scoring sheet both cover COBE
only, referencing Boost as She'elon 16387 without reproducing its criteria.
Rather than quietly dropping the level from the dropdown, the API returns it
with `supported:false` and the reason attached — a guessed rubric would
produce grades that look official and are not.

---

## Setup

Requires **Node 18+**.

```bash
git clone https://github.com/kfirSpeak2go/COBE_Exam_Tester.git
cd COBE_Exam_Tester
npm install
cp .env.example .env      # then fill in the keys
```

You need two API keys to run anything against real audio: **Deepgram** (speech-
to-text) and **OpenAI** (rubric scoring). Both are billable. See `.env.example`
— every variable is documented there.

For real student data you also need `STUDENT_ID_SALT`. It hashes the national
ID into the anonymised `student_id` the spec requires, and **must not change
once set** — changing it re-issues every identifier and breaks the link to past
reports.

```bash
npm start        # http://localhost:3000
npm run dev      # same, with --watch
```

The server warns on boot if the keys are missing rather than failing later
mid-run.

---

## Testing

### Unit tests — free, offline, no API keys

```bash
npm run test:unit
```

54 tests, no network calls, nothing billable. This is the suite to run before
every commit. It covers the parts where a bug silently changes someone's grade:
score aggregation, coverage deductions, time-based deductions, the penalty
layer, and HTML escaping.

### Renderer checks — free, offline, no API keys

These build a report from hand-written mock data, so you can check layout and
formatting without spending a cent on audio:

```bash
npm run test:report            # simple report → HTML + PDF
npm run test:dashboard         # full analytical dashboard → HTML + PDF
node test/run_dashboard.js --html   # HTML only, skips Chromium
```

The mock deliberately includes the awkward cases — a question zeroed by a
penalty, a partly-answered question set, and a question never attempted — so
the layout gets exercised rather than just the happy path.

### Live pipeline tests — these cost money

Each of these calls Deepgram and OpenAI for real:

```bash
npm run test:stt         # speech-to-text only, on one file
npm run test:pipeline    # one question, end to end
npm run test:full-exam   # a complete exam
```

### Bulk-grading a folder of samples

```bash
node test/run_client_sample.js                 # everything
node test/run_client_sample.js 209937101       # one student
SAMPLE_DIR=/path/to/folder node test/run_client_sample.js
```

Expects one sub-folder per exam part (`Part A Q1`, `Part A Q2`, `Part B`,
`Part C Q1`, `Part C Q2`). It de-duplicates identical recordings by checksum,
and grades only the questions a student actually recorded — the rest fall
through as unattempted.

Output is written to `test/client_sample_results.json`, which is **gitignored
on purpose**: the sample files are named by student e-mail whose local part is
the national ID, so that file carries real identifiers next to transcripts and
grades. Filtered runs write to a separate filename so re-checking one student
cannot overwrite a full run.

---

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Keys loaded, model in use, which levels are gradeable |
| GET | `/api/blueprint` | Question slots to render, with default question text |
| GET | `/api/recordings` | Available recordings, grouped by student and lesson |
| POST | `/api/recordings/fetch` | Pull one recording — body `{ userEmail, idDetection }` |
| POST | `/api/exams` | Start a run (multipart). Returns `examId` immediately |
| GET | `/api/exams/:examId` | Poll progress and results |
| GET | `/api/exams/:examId/report.html` | Formal report, for the teacher |
| GET | `/api/exams/:examId/dashboard.html` | Full analytical dashboard |
| GET | `/api/exams/:examId/report.pdf` | The same report as a PDF download |
| GET | `/api/exams` | Recent runs |

Runs are asynchronous: `POST /api/exams` returns an `examId` straight away and
the client polls. A full five-question exam takes a couple of minutes, which is
far too long to hold an HTTP request open.

Recordings are addressed as `(userEmail, idDetection)` rather than by URL,
because the S3 bucket is private and the platform resolves the key itself after
authorising the caller.

---

## Layout

```
server/      Express API, job store, exam runner, in-memory report store
public/      Operator dashboard (vanilla JS, no build step)
src/
  config/    Exam blueprint and the rubric JSON
  services/  Deepgram STT, speech metrics, OpenAI rubric scoring
  utils/     Score aggregation and the deterministic penalty rules
  report/    Report object, HTML renderers, PDF via Puppeteer
  storage/   File-backed persistence
test/        Unit tests + manual harnesses
```

---

## Scoring rules worth knowing

**Deductions do not stack.** If several apply to one answer, the largest is
used — not the sum. This follows the Ministry rubric's "0% for the entire
section" wording; compounding them would push scores below zero.

**Automatic zeroes** apply for an empty file, an answer under 20 seconds of
speech, foul language, or an answer given in a language other than English.
Holiday and celebration names in another language are explicitly allowed and
do not trigger the language rule.

**The `unintelligible` flag is cross-checked against the rubric.** This one
needs explaining, because it was a real bug.

The scoring model can flag an answer as incomprehensible, which zeroes it. In
testing against the client's own samples, the same audio scored **49.50 on one
run and 0.00 on the next** — the flag flipped, and a student lost an entire
answer to it. The model was using the flag to mean "this answer is weak"
rather than "I cannot understand this", double-penalising weaknesses the rubric
had already marked down.

Three changes fixed it:

1. The prompt now states the flag is about *comprehensibility, not quality*,
   and must not fire for an answer that is merely short, thin, off-topic or
   badly organised.
2. A `seed` is sent alongside `temperature: 0`. Neither guarantees determinism
   — OpenAI documents `seed` as best-effort — so this is a second line of
   defence, not the fix.
3. **The real safeguard:** the flag is only honoured if the rubric independently
   scored the answer below **39.5**. That number is derived, not chosen by
   feel — the rubric's levels are 25/54/75/100, so 39.5 is the midpoint between
   the bottom level and the next one up. Above it, the rubric is saying the
   answer was comprehensible enough to score, and the flag is suppressed.

A suppressed flag is not discarded. It is recorded with its reason, the score
that survived it, and the ceiling that saved it, and surfaces in the report
object as `suppressed_flags` — so a contested grade can always be explained.

After the fix, two full runs over 22 real recordings produced **zero** of the
flips that caused the bug. Around ±4 points of run-to-run variation remains,
which is inherent to the model.

---

## Known limitations

- **Boost / 3-point (A2) cannot be graded** — no rubric supplied. Blocked by the client.
- **No database writes.** Phase 1 is evaluation only; results are not synced back.
- **Reports are held in memory** and are evicted on restart.
- **Part C reference clips are not transcribed automatically.** The clip transcript is passed in manually; only 4 of 33 reference lessons carry usable Part C text.
- **No webhook callbacks yet** — clients poll.
- **The blueprint endpoint is hardcoded** to the standard 5-slot layout. The code handles the split-Part-B shape, but no lesson selector drives it.
- **`isUnder20Seconds` measures wall-clock duration**, while the rule says "20 seconds *of speech*". Both readings agreed on all 22 sample recordings, but they can diverge on an answer with long silences.
