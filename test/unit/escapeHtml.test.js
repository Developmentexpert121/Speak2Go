const test = require("node:test");
const assert = require("node:assert/strict");
const { esc, num } = require("../../src/report/escapeHtml");
const { renderReportHtml } = require("../../src/report/renderReportHtml");

test("esc neutralises the HTML metacharacters", () => {
  assert.equal(esc(`<script>`), "&lt;script&gt;");
  assert.equal(esc(`a & b`), "a &amp; b");
  assert.equal(esc(`"quoted"`), "&quot;quoted&quot;");
  assert.equal(esc(`it's`), "it&#39;s");
});

test("esc renders null and undefined as empty, not as the words", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("num never throws on a missing or non-numeric score", () => {
  assert.equal(num(72.849), "72.8");
  assert.equal(num(undefined), "—");
  assert.equal(num(null), "—");
  assert.equal(num(NaN), "—");
});

test("report HTML escapes hostile content from every untrusted field", () => {
  const html = renderReportHtml(
    {
      overallScore: 72.5,
      partScores: [
        { part: "A", label: `Part A <script>alert("part")</script>`, questionIds: ["1a"], pointsEarned: 20, pointsPossible: 25 },
      ],
      questions: [
        {
          questionId: "1a",
          // typeDescription and deduction reasons are model-generated text
          // that can quote the student's own transcript
          typeDescription: `Part A </td></tr><script>alert(1)</script>`,
          // The transcript is the most dangerous field in the report: it is a
          // verbatim recording of whatever the student chose to say, and a
          // student who says "script alert" gets it written into the page.
          questionText: `Tell me about <iframe src=evil></iframe>`,
          answerTranscript: `I said <script>alert("transcript")</script> out loud`,
          rawScore: 80,
          finalQuestionScore: 80,
          deduction: 0,
          criterionBreakdown: [],
          speechMetrics: {},
        },
      ],
      deductionsTable: [
        {
          questionId: "1a",
          reason: `Foul language detected — <img src=x onerror=alert(document.cookie)>`,
          deduction: 100,
        },
      ],
      teacherRecommendations: `Work on <b>fluency</b> & pacing`,
    },
    {
      studentName: `<script>steal()</script>`,
      examLevel: "5 Point COBE (B2)",
      schoolName: `<svg onload=alert(1)>`,
    }
  );

  // No injected markup survives as a real tag. Note that checking for the
  // bare substring "onerror=" would give a false failure — it appears inside
  // the fully-escaped &lt;img ...&gt; text, where it is inert. What matters is
  // that no unescaped tag opener precedes it.
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes("<script>steal()</script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("</td></tr><script>"), false);

  // The only tags in the output are the ones the template itself emits.
  const injectedTags = html.match(/<(script|img|iframe|svg|object|embed)\b/gi) || [];
  assert.deepEqual(injectedTags, []);

  // ...while still displaying the text itself, escaped
  assert.equal(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
  assert.equal(html.includes("&lt;b&gt;fluency&lt;/b&gt; &amp; pacing"), true);
  assert.equal(html.includes("&lt;img src=x onerror=alert(document.cookie)&gt;"), true);
});

test("an unanswered question is named, not left as a silent zero", () => {
  // The Details table shows a skipped part as 0 / 25, which reads exactly like
  // an answer that was given and scored zero. Those mean different things to a
  // teacher, so the forfeited questions have to be spelled out.
  const html = renderReportHtml({
    overallScore: 50,
    questions: [],
    deductionsTable: [],
    unattemptedQuestions: [
      { questionId: "4", description: "Part C - Personal Opinion", pointsForfeited: 25 },
    ],
  });

  assert.equal(html.includes("Not Attempted"), true);
  assert.equal(html.includes("Part C - Personal Opinion"), true);
  assert.equal(html.includes("−25"), true);
});

test("the Not Attempted section is omitted when the exam was answered in full", () => {
  const html = renderReportHtml({
    overallScore: 50,
    questions: [],
    deductionsTable: [],
    unattemptedQuestions: [],
  });
  assert.equal(html.includes("Not Attempted"), false);
});

test("report HTML renders a question whose score is missing without throwing", () => {
  const html = renderReportHtml({
    overallScore: undefined,
    questions: [{ questionId: "2", typeDescription: "Part B", criterionBreakdown: [] }],
    deductionsTable: [],
    teacherRecommendations: null,
  });
  assert.equal(html.includes("—"), true);
});
