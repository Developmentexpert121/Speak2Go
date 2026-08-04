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
      overall_score: 72.5,
      question_scores: [
        {
          question_id: "1a",
          // description and deduction reasons are model-generated text that
          // can quote the student's own transcript
          description: `Part A </td></tr><script>alert(1)</script>`,
          raw_score: 80,
          final_question_score: 80,
          criterion_breakdown: [],
        },
      ],
      deductions_table: [
        {
          question_id: "1a",
          reason: `Foul language detected — <img src=x onerror=alert(document.cookie)>`,
          deductionPct: 100,
        },
      ],
      teacher_recommendations: `Work on <b>fluency</b> & pacing`,
    },
    { studentName: `<script>steal()</script>`, examLevel: "5 Point COBE (B2)" }
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

test("report HTML renders a question whose score is missing without throwing", () => {
  const html = renderReportHtml({
    overall_score: undefined,
    question_scores: [{ question_id: "2", description: "Part B", criterion_breakdown: [] }],
    deductions_table: [],
    teacher_recommendations: null,
  });
  assert.equal(html.includes("—"), true);
});
