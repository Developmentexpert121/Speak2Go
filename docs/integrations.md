# Integrations

## Recordings bucket (`s2g-recordings`, read-only)

**Every file is named `.mp3` and none of them are.** Sampling the objects
showed WebM and Ogg containers — what a browser's `MediaRecorder` produces.

This works only because nothing branches on the extension: the raw bytes go to
Deepgram, which detects the container itself. Do not "fix" the naming by
deriving a mime type from the key, and do not pick a decoder by extension.
Either would break every object in the bucket while looking like housekeeping.

Recordings are addressed by S3 key rather than URL. They are sensitive, so
they are read with `GetObjectCommand` exactly as the Speak2Go app does, rather
than by passing links around.

A key that cannot be fetched costs that question, not the run: it is recorded
on the job and the question is left unanswered rather than aborting four other
answers that graded fine.

## Report bucket (`oral-exams-s2g`, read/write)

Reports are written to `{prefix}/{yyyy}/{mm}/{examId}/report.html`, private
and server-side encrypted, with no public ACL.

Without credentials the HTML is held in memory and served from this process
instead, so a missing credential degrades the URL rather than failing a run.
`GET /api/health` reports which of the two is in effect.

PDFs are deliberately not uploaded — the client generates those on demand from
the HTML.

## Playback links

The report links to `app.speak2go.com`, not to S3.

A presigned S3 link expires (7 days is the AWS maximum) and a report is a
document that may be opened months later, so it would become a dead link. The
alternative — a public bucket — is worse: the object keys contain students'
national ID numbers, so a public bucket would expose minors' voice recordings
and their identifiers together, and the keys are guessable.

**Speak2Go mints the playback token, not this service.** They own the decision
about who may hear a recording, they can revoke a link once issued, and the
signing key stays in one place. When a question arrives carrying
`audioPlaybackUrl` it is used verbatim; the constructed link is the fallback.

A supplied URL is checked for an `http(s)` scheme first. It arrives on the
inbound payload and is written straight into an `href`, so a `javascript:`
value would be an XSS hole opened by whatever calls us.

## Result callback

See [webhook-signature.md](webhook-signature.md) for the full specification.

The design in one line: sign `{timestamp}.{rawBody}` with HMAC-SHA256, so a
captured request cannot be replayed with the clock moved forward.

It **fails closed in three directions**, all deliberate:

- no signing secret → refuses to send, rather than sending unsigned
- no host allowlist → refuses to send at all
- a non-retryable 4xx → stops immediately

`callbackUrl` is caller-supplied, which makes an unrestricted sender a
server-side request forgery primitive: submit an exam with a callback pointing
at `169.254.169.254` and this service would POST a signed request to it from
inside the network. The allowlist matches on a dot boundary, so
`api.speak2go.net.evil.com` does not pass.

A failed delivery never fails the exam. The result is recorded on the job.

## Student identifiers

The Israeli national ID is hashed with a salt into the anonymised `studentId`,
and the raw value is not retained.

`STUDENT_ID_SALT` must stay constant for the life of a deployment. Changing it
reissues every identifier and silently breaks the link between a student and
all their past reports. It looks like a password; treat it like a database key,
not something to rotate as routine hygiene.
