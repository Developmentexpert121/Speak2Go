# Scoring rules

Every rule here changes a student's grade. Most of them fail *silently* when
broken — a wrong mark renders as a perfectly normal report — so each one has
tests, and this document records why it exists.

## The shape of a score

An exam is always marked out of 100, whether or not the student attempted
every question. An unanswered question earns 0 of its points rather than
shrinking the denominator; otherwise answering less would raise the average.

The model chooses one of four fixed levels per sub-criterion — **25, 54, 75 or
100** — and cannot invent a number. Everything after that is arithmetic. That
split is the whole design: a disputed grade has to be explainable, and "the
model felt it was a 63" is not an explanation.

Those four levels map 1:1 onto the report's four stars. It is a lookup, not a
rounding: 54 is the second band, not "two and a bit stars". Anything off the
four bands shows the number alone rather than inventing a star count.

## Part A is choose-one

The student is shown two questions and answers **one**. It is worth the whole
25 points.

Both answers are scored, because the client asked for feedback on each, but
only the higher counts toward the grade. The one that did not count is badged
in the report — without that, a reader sees two Part A scores and cannot tell
which produced the mark.

Two consequences, each of which silently changes grades if got wrong:

- **Each question carries the full 25, not 12.5.** Summing the group marks
  Part A out of 50, so `sumBlueprintPoints()` counts a choice group once.
- **The partial-coverage deduction must not fire.** That rule exists for sets
  where every sub-question is required. On a choose-one part, answering
  exactly one *is* compliance. Before this was fixed, a student who followed
  the instructions lost 25% of Topic Development — half the grade — costing
  roughly 12.5 marks, and nothing in the report indicated why.

The unchosen question is also not "unattempted with 25 points forfeited": it
was never meant to be answered, and those points were earned on the other one.
But a Part A where *neither* was answered still forfeits 25, once.

## Deductions do not stack

If several apply to one answer, the **largest** is used — not the sum. This
follows the Ministry rubric's "0% for the entire section" wording; compounding
them would push scores below zero.

## Automatic zeroes

An empty file, an answer under 20 seconds of speech, foul language, or an
answer given in a language other than English. Holiday and celebration names
in another language are explicitly allowed and do not trigger the language
rule.

## The `unintelligible` flag is cross-checked

This one caused a real bug. The scoring model can flag an answer as
incomprehensible, which zeroes it. Against the client's own samples, the same
audio scored **49.50 on one run and 0.00 on the next** — the flag flipped and
a student lost an entire answer to it.

The model was using the flag to mean "this answer is weak" rather than "this
answer cannot be understood". Weakness is already priced in by the rubric, so
the flag was deducting twice for the same thing. It is now ignored when the
rubric scores disagree with it, and the suppression is recorded on the result
so an appeal can see what happened.

`temperature: 0` and a fixed `seed` narrow the sampling but are not a
determinism guarantee. The cross-check is the actual safeguard.

## Part C is scored against its own clip

Part C's two questions can reference different clips. The scorer judges
relevance against whatever reference material it is handed, so giving question
4 the transcript belonging to question 3 makes a perfectly good answer read as
off-topic — a low Topic Development score, with nothing anywhere saying the
wrong clip was used.

`videoTranscription` therefore rides on the question, not the part. Parts A
and B get none rather than inheriting Part C's.

## Structure comes from `questionType`, never the id

`questionId` is a randomly generated hash. All structural logic reads
`questionType` (`a1`, `b`, `c2`).

Parsing the id worked while the ids were ours (`1a`, `1b`, `2`) and silently
stops working against real Speak2Go data: every question falls into its own
group, Part B is never recognised, and two scoring rules quietly stop firing.
Against hashes, Part A was marked out of 50 and the Part B time rule never
applied.

Grouping is not simply "same part". Parts A and B group; **Part C does not**.
Part A is a choose-one group, Part B is a set whose halves must both be
answered, but Part C's two questions are independent — grouping them fires the
coverage rule on a student who answered both, which is exactly backwards.

## Casing

Output is camelCase. The spec document writes snake_case, and the translation
happens only at the boundary — `reportService.js` and `specObjectsService.js`.

A blanket rename would also catch three families of identifier that only
*look* like fields and must never move:

- rubric sub-criterion ids (`sc1_relevancy`), matched by string against
  `rubrics.json` and the model's reply;
- level codes (`5_UNITS_B2`);
- Speak2Go's own Mongo columns (`IDNumber`, `SemelMosad`), which are inputs.

Two tests hold this from both sides: one walks the report tree asserting no
key contains an underscore, the other asserts the rubric ids still do.
