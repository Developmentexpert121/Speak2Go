# COBE Exam Tester — working notes for AI tools

Automated grading for the Israeli Ministry of Education's COBE spoken English
exam. Audio in, a scored report out.

## Layout

Follows Speak2Go's Node service conventions.

```
src/
  routes/        HTTP only — parse, call one service, respond
  services/      all logic; no req/res, arguments in and results out
  db/            the only place that reads or writes stored state
  generators/    produce documents (report HTML, PDF, dashboard)
  validators/    turn a request body into plain arguments, or throw
  integrations/  everything that talks to another system
  middleware/    error handling, async wrapping
  jobs/          long-running work started by a service
  config/        all environment reading, in one place
  utils/         pure helpers
  app.js         builds the Express app
server.js        starts it
tests/unit, tests/integration
docs/
```

`db/` holds memory- and file-backed stores rather than a database: the client
asked for no database writes, so it is the data-access layer for a service
that has no DB.

## Commands

```bash
npm test              # 123 unit + 9 integration, no network, nothing billable
npm run test:unit
npm run test:integration
npm start
npm run test:report   # render a sample report; costs one LLM call
```

Anything under `tests/run_*.js` other than `test:report` calls Deepgram and
OpenAI for real and costs money.

## Things that will bite you

**Scoring rules fail silently.** A wrong grade still renders as a perfectly
normal report. The unit tests are the only thing standing between a refactor
and a student getting the wrong mark, so run them before and after any change
under `services/`, `utils/` or `config/examBlueprint.js`.

**Part A is choose-one.** Two questions are offered, the student answers one,
and it is worth the whole 25 points. Both are scored for feedback; only the
higher counts. The partial-answer deduction must never fire on it — that bug
cost students about 12.5 marks each before it was found.

**Three families of identifier look like fields but are not.** Rubric
sub-criterion ids (`sc1_relevancy`), level codes (`5_UNITS_B2`) and Speak2Go's
own Mongo columns (`IDNumber`, `SemelMosad`) must keep their spelling. Output
keys are camelCase; the translation happens only in `services/reportService.js`
and `services/specObjectsService.js`.

**questionId is a hash.** All structural logic reads `questionType`
(`a1`, `b`, `c2`), never the id. Parsing the id worked once and silently stops
working against real Speak2Go data.

**Recording filenames lie.** Every object in `s2g-recordings` ends `.mp3` and
is actually WebM or Ogg. Nothing may branch on the extension; the bytes go to
Deepgram, which detects the container.

**The report must stay self-contained.** Inline CSS, logo as a data URI, no
external references. It is opened straight from S3 and printed by a headless
browser with nothing to resolve relative paths against.

**Never commit anything under `tests/` that came from real audio.**
`real_report.*` and `client_sample_results*.json` carry a real student's
transcript and national ID. They are gitignored — check `git status` for
additions, not just modifications, after any rename.

## Secrets

All configuration is environment variables, read in `src/config/index.js`.
See `.env.example`. Nothing is hardcoded and nothing is committed.
