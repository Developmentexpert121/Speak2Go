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

| Level | CEFR | Level code | Status |
|---|---|---|---|
| 5 points | B2 | `5_UNITS_CEFR_B2` | supported |
| 4 points | B1 | `4_UNITS_CEFR_B1` | supported |

3-point Boost (A2) is **out of scope**. It appeared in an early draft of the
specification and was carried here for a while as "blocked, awaiting rubric",
which was wrong: the client confirmed on 12 Aug 2026 that Boost is a different
exam with its own rubrics and belongs to a separate project. It is not a gap
in this one, so it has been removed rather than left showing as pending work.

The level codes above are the spec document's spelling. The earlier
`5_UNITS_B2` / `4_UNITS_B1` forms are still accepted on the way in and
normalised, so an older caller is not rejected over a missing `CEFR_`.

---

## Setup

### 1. Prerequisites

**Node 18 or newer** (developed on v20). Check what you have:

```bash
node -v      # must be >= 18
npm -v
```

Node 18 is the floor because the project uses Express 5 and the built-in
`node:test` runner. Nothing else needs installing — no database, no Docker,
no Redis. Phase 1 keeps everything in memory on purpose.

### 2. Clone and install

```bash
git clone https://github.com/kfirSpeak2go/COBE_Exam_Tester.git
cd COBE_Exam_Tester
npm install
```

`npm install` pulls roughly 66 MB into `node_modules` and **also downloads a
private copy of Chromium** (a few hundred MB more, into `~/.cache/puppeteer`).
That is Puppeteer, which renders the PDF reports. The first install is slow
because of it — this is expected, not a hang. If you never need PDFs you can
skip it with `PUPPETEER_SKIP_DOWNLOAD=1 npm install`, and everything except
`report.pdf` still works.

### 3. Configure the environment

```bash
cp .env.example .env
```

Then open `.env` and fill it in. Every variable is documented in the file
itself; these are the ones that matter:

| Variable | Needed for | Notes |
|---|---|---|
| `DEEPGRAM_API_KEY` | any real run | speech-to-text — **billable** |
| `OPENAI_API_KEY` | any real run | rubric scoring — **billable** |
| `STUDENT_ID_SALT` | real student data | see warning below |
| `OPENAI_MODEL` | optional | defaults to `gpt-4o-mini` |
| `PORT` | optional | defaults to `3000` |
| `SPEAK2GO_API_URL` / `_TOKEN` | optional | only for pulling recordings from the platform |
| `WEBHOOK_SIGNING_SECRET` | posting results back | no secret, nothing is sent — see below |
| `WEBHOOK_ALLOWED_HOSTS` | posting results back | SSRF guard, empty means no deliveries |
| `WEBHOOK_MAX_RETRIES` | optional | defaults to `3`, on top of the first attempt |
| `AWS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | uploading report HTML | must be an IAM key, not a console login |
| `S3_REPORT_BUCKET` / `AWS_REGION` | uploading report HTML | default `oral-exams-s2g` in `us-east-1` |

Generate the salt once:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **`STUDENT_ID_SALT` must never change once set.** It hashes the national ID
> into the anonymised `student_id` the spec requires. Changing it silently
> reissues every identifier and breaks the link between a student and all
> their past reports. It looks like a password, but treat it like a database
> key — do not "rotate" it as routine hygiene.

`.env` is gitignored and must stay that way. It holds live billable keys.

#### Delivering the result back to Speak2Go

Pass a `callbackUrl` alongside the Exam Object when creating an exam and the
finished Report Object is POSTed there. It is sent next to the Exam Object
rather than inside it: it is transport configuration for a single request, not
a property of the exam. Two headers carry the proof:

```
x-s2g-signature: sha256=<hex>
x-s2g-timestamp: <unix seconds>
```

The signature is `HMAC-SHA256(secret, "{timestamp}.{rawBody}")`. The timestamp
is inside the signed string on purpose — an attacker who captures a valid
request cannot slide it forward to defeat the 5-minute freshness window,
because moving it invalidates the signature.

**Verify against the raw request body.** A receiver that checks
`JSON.stringify(req.body)` will reject any pretty-printed payload, because the
whitespace is gone by then. In Express that means
`express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`.
`server/webhook.js` exports `verifyRequest()` ready to use on the receiving
side, and there is a unit test pinning exactly this trap.

Both `WEBHOOK_SIGNING_SECRET` and `WEBHOOK_ALLOWED_HOSTS` must be set. The
sender fails closed: with no secret it refuses to send rather than send
unsigned, and with no allowlist it refuses to send at all. The allowlist is
what stops a caller-supplied `callbackUrl` from pointing this server at
`169.254.169.254` or anything else inside the network. Non-2xx responses are
retried only for 429 and 5xx — a 400 or 401 means the request itself is wrong,
so repeating it just repeats the error. Retries default to 3 on top of the
first attempt, backing off 1s / 5s / 20s, and are re-signed each time so a
delayed retry is not rejected as stale. `x-s2g-delivery` stays constant across
them, so the receiver can discard the duplicate our own retry created. A
failed delivery is recorded on the job and never fails the exam run.

#### Uploading the report HTML

With AWS credentials present, each report's HTML is written to
`{prefix}/{yyyy}/{mm}/{examId}/report.html` in the bucket and the Exam
Object's `reportHtmlUrl` points there — a presigned URL, unless
`S3_PUBLIC_BASE_URL` says the bucket is fronted by CloudFront. Objects are
uploaded private and server-side encrypted; no public ACL is set.

Without credentials the HTML is kept in memory and served from this process
instead, so a missing credential degrades the URL rather than failing the run.
`GET /api/health` reports which of the two is in effect.

PDFs are deliberately **not** uploaded — the client generates those on demand
from the HTML. The HTML is written with no external references at all (styles
inline, no images, fonts or scripts), which is what lets it be opened straight
from S3 and printed without a server to resolve assets against.

### 4. Verify the install — without spending anything

Run these in order. Neither costs a cent or needs an API key:

```bash
npm run test:unit        # 54 tests, offline. All should pass.
npm run test:dashboard   # writes test/sample_dashboard.html + .pdf
```

If the unit tests pass, the scoring logic is sound. If the dashboard renders,
Puppeteer and the PDF path work too. Open `test/sample_dashboard.html` in a
browser to see what a finished report looks like.

### 5. Start the server

```bash
npm start        # http://localhost:3000
npm run dev      # same, with --watch for auto-restart
```

Then confirm it is wired up correctly:

```bash
curl http://localhost:3000/api/health
```

`deepgramKey` and `openaiKey` should both be `true`. If either is `false`, the
key is missing from `.env` and real runs will fail — the server warns about
this on boot rather than letting you find out mid-run.

`recordingsFetch:false` is normal and fine; it just means the optional
Speak2Go platform credentials are not set, so the UI will ask you to upload
audio manually instead of fetching it.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `npm install` appears to hang | Puppeteer downloading Chromium. Let it finish. |
| Server boots with a keys warning | `.env` missing or not filled in. |
| `OpenAI request failed using model="…"` | Bad `OPENAI_MODEL`, or the key lacks access to it. The error prints the model string it tried. |
| PDF endpoint 404s | Report evicted — reports live in memory and are lost on restart. |
| 422 when starting a run | Unsupported level. Only the two in **Levels** can be graded. |
| Result never reaches your callback | Check `GET /api/health` → `resultCallback`. Delivery fails closed without both a signing secret and an allowlisted host. |

---

## Testing

### Unit tests — free, offline, no API keys

```bash
npm run test:unit
```

86 tests, no network calls, nothing billable. This is the suite to run before
every commit. It covers the parts where a bug silently changes someone's grade:
score aggregation, coverage deductions, time-based deductions, the penalty
layer, and HTML escaping — plus the two places a bug would be invisible rather
than wrong: the shape of the Report Object handed to Speak2Go, and the webhook
signature and callback allowlist.

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
far too long to hold an HTTP request open. Pass a `callbackUrl` in the same
form and the finished result is POSTed there instead of waiting to be polled —
see **Delivering the result back to Speak2Go** above.

All output is camelCase, at the client's request (12 Aug 2026). The spec
document writes these fields in snake_case; the rename happens in
`buildReportObject.js` and the two spec-object builders, and everything
upstream of them — the scoring engine, the rubric config, the penalty rules —
keeps its original spelling. That boundary is deliberate. Three families of
identifier look like snake_case fields but must never move: rubric
sub-criterion ids (`sc1_relevancy`), level codes (`5_UNITS_CEFR_B2`), and
Speak2Go's own Mongo columns (`IDNumber`, `SemelMosad`), which are inputs
rather than outputs. A unit test walks the whole report tree asserting no key
contains an underscore, and a second one asserts the rubric ids still do.

Recordings are addressed as `(userEmail, idDetection)` rather than by URL,
because the S3 bucket is private and the platform resolves the key itself after
authorising the caller.

---

## Layout

```
server/      Express API, job store, exam runner, report store,
             signed webhook delivery, S3 report upload
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

**Part A is choose-one.** The student is shown two questions and answers one,
so Part A's 25 points go to whichever answer scores higher — not 12.5 to each.
Both answers are still transcribed, scored and printed with a full breakdown,
because the client wants feedback on both; the one that did not count is
badged `feedback only — not counted` in the report and carries
`countsTowardFinal: false` in the Report Object.

Two consequences are easy to get wrong and are handled explicitly:

- Each Part A question carries `points: 25`, so a naive sum marks Part A out
  of 50. Use `sumBlueprintPoints()`, which counts a choice group once.
- The partial-coverage deduction is skipped for Part A. That rule exists for
  sets where every sub-question is required; here, answering one of two is
  compliance. It lands on Topic Development, which is half the grade, so
  letting it fire would quietly cost the student 12.5 points for following the
  instructions.

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

- **No database writes.** Phase 1 is evaluation only; results are not synced back.
- **Reports are held in memory** and are evicted on restart, unless S3 upload is configured — the uploaded HTML survives independently of this process.
- **Part C reference clips are not transcribed automatically.** The clip transcript is passed in manually; only 4 of 33 reference lessons carry usable Part C text.
- **Report language is English only.** The rubric and the spec document are in English; whether teachers want a Hebrew or bilingual report is still an open question with the client.
- **The blueprint endpoint is hardcoded** to the standard 5-slot layout. The code handles the split-Part-B shape, but no lesson selector drives it.
- **`isUnder20Seconds` measures wall-clock duration**, while the rule says "20 seconds *of speech*". Both readings agreed on all 22 sample recordings, but they can diverge on an answer with long silences.
