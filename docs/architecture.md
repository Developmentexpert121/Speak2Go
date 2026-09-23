# Architecture

How the service is put together, and why it is put together that way. Code
comments are kept to the short "why" at each decision point; the reasoning
behind those decisions lives here.

## Layers

Follows Speak2Go's Node service conventions.

| Layer | Responsibility |
|---|---|
| `routes/` | HTTP only: parse, call one service, respond |
| `services/` | All logic. No `req`/`res` — arguments in, result out |
| `validators/` | Turn a request body into plain arguments, or throw |
| `middleware/` | Error handling, async wrapping |
| `db/` | The only place that reads or writes stored state |
| `generators/` | Produce documents |
| `integrations/` | Everything that talks to another system |
| `jobs/` | Long-running work started by a service |
| `config/` | All environment reading |
| `utils/` | Pure helpers |

`app.js` builds the Express app without starting it, so a test can mount it
without a port being claimed as a side effect of an import. `server.js` is the
process entry point and does nothing but configure and listen.

## Why `db/` has no database

Phase 1 is evaluation only, and the client asked for no database writes. The
exam stores are therefore an in-memory `Map` (`jobRepository`) and a file
directory (`referenceMaterialRepository`), both behind named functions rather
than raw access. When a real database arrives, these are the files that
change and nothing else has to.

Reports live in memory and are evicted oldest-first past fifty. A PDF is a
real file, so eviction unlinks it — dropping the map entry alone would leak
disk for the life of the process. "Not found" and "expired" are therefore the
same condition to a caller, and carry the same message.

## Errors

Every error becomes a response in exactly one place: `middleware/errorHandler`.

Services throw `AppError`, which carries the status it should be reported as.
That is what lets a service stay free of `res`: it says what went wrong and
how serious it is, and the HTTP layer decides the wording.

Anything thrown that is *not* an `AppError` is treated as a bug: logged in
full, and returned as a bare `500`. An unexpected stack can carry file paths,
API keys or a student's transcript, none of which belongs in an HTTP response.

Before this was centralised, four route handlers each chose their own status
and message shape, so the same class of failure could surface as a 400 from
one endpoint and a 500 from another.

## Configuration

Read from the environment in `config/index.js` and nowhere else.

Values are read once at startup, which is what a deployed service wants: a
process should not change behaviour halfway through because something edited
its environment. `config.reload()` recomputes in place for tests that need to
prove behaviour under a different environment — the fail-closed webhook checks
are only meaningful if "no secret configured" can actually be exercised. It
mutates rather than replaces, because every module holds a reference.

This used to be scattered. Each module read `process.env` with its own
default, and the defaults had drifted: the scoring client defaulted
`OPENAI_MODEL` to `gpt-4o` while the health check reported `gpt-4o-mini`. With
the variable unset, exams were graded by one model while the service reported
another, at roughly fifteen times the cost. Nothing threw — a divergence like
that is only ever caught by comparing the values, which `tests/unit/config.test.js`
now does.

## The report pipeline

```
evaluateFullExam → recommendations → reportService (the payload)
                                   → generators (HTML, PDF, dashboard)
                                   → S3 upload
```

`reportRenderingService` orchestrates; `reportRepository` only stores. The
HTML is mandatory. The dashboard, the PDF and the upload are not: a failure in
any of them is recorded and stepped over, because the exam has already been
graded by that point and losing a completed evaluation to a PDF renderer is a
worse outcome than a report without a download link.

### Why the report is one self-contained file

Styles are inlined, the logo and favicon are data URIs, and there are no
external references of any kind. The report is opened straight from S3 and
printed by a headless browser, neither of which has a server to resolve a
relative path against — a linked stylesheet or logo would break in exactly the
two places the report is actually read.

The CSS lives in `templates/reports/report.css` so it can be edited as CSS. It
is inlined at render time, not linked.

## Prompts

Both LLM prompts are `.txt` templates under `src/prompts/` with a thin loader,
in the same spirit as `rubrics.json`.

The trade-off: a typo in a placeholder name no longer breaks the build. It
ships a prompt containing a literal `{{TRANSCRIPT}}`, the model answers anyway
and plausibly, and the grade is wrong with nothing to indicate why. Hence the
tests asserting no `{{TOKEN}}` survives rendering.

Optional blocks — prior answers, the Part C clip transcript — are omitted
entirely when absent rather than rendered as an empty heading, which would
invite the model to fill it in.
