const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRecordingUrl } = require("../../src/report/recordingUrl");
const { buildReportObject } = require("../../src/report/buildReportObject");

/**
 * The client specified this link format on 13 Aug 2026 and ruled out the two
 * alternatives explicitly: no time-limited links, and no public recordings
 * bucket. A report may be opened months after it was generated, so a presigned
 * URL inside it would be a dead link by then.
 */

test("the playback link matches the format the client specified", () => {
  assert.equal(
    buildRecordingUrl({ reportId: "exam_abc123", questionId: "1a" }),
    "https://app.speak2go.com/#/recordings/play?r=exam_abc123&q=1a"
  );
});

test("ids are encoded, not interpolated raw", () => {
  // questionId is now a Speak2Go-supplied value, so it is untrusted input to a
  // query string. An unencoded "&" would silently truncate the link.
  const url = buildRecordingUrl({ reportId: "r&1", questionId: "q=2 x" });
  assert.equal(url, "https://app.speak2go.com/#/recordings/play?r=r%261&q=q%3D2%20x");
});

test("a missing id yields no link rather than one pointing at 'undefined'", () => {
  assert.equal(buildRecordingUrl({ reportId: null, questionId: "1a" }), null);
  assert.equal(buildRecordingUrl({ reportId: "exam_abc", questionId: "" }), null);
});

test("the base url is overridable so staging does not link into production", () => {
  const saved = process.env.SPEAK2GO_APP_BASE_URL;
  process.env.SPEAK2GO_APP_BASE_URL = "https://staging.speak2go.com/";
  try {
    assert.equal(
      buildRecordingUrl({ reportId: "e1", questionId: "1a" }),
      "https://staging.speak2go.com/#/recordings/play?r=e1&q=1a"
    );
  } finally {
    if (saved === undefined) delete process.env.SPEAK2GO_APP_BASE_URL;
    else process.env.SPEAK2GO_APP_BASE_URL = saved;
  }
});

test("the report carries the S3 key and the playback link, never a presigned url", () => {
  const report = buildReportObject(
    {
      level: "5_UNITS_B2",
      overall_score: 50,
      points_earned: 50,
      points_possible: 100,
      exam_layout: [],
      question_results: [
        {
          question_id: "1a",
          audio_file_key: "recordings/2026/abc/1a.mp3",
          criterion_breakdown: [],
          deductions: [],
          audio_metrics: {},
        },
      ],
    },
    "",
    { reportId: "exam_abc123" }
  );

  const q = report.questions[0];
  assert.equal(q.audioFileKey, "recordings/2026/abc/1a.mp3");
  assert.equal(q.recordingUrl, "https://app.speak2go.com/#/recordings/play?r=exam_abc123&q=1a");

  // The whole report must not contain an S3 signature. If one ever appears
  // here it means a presigned URL leaked into a document that outlives it.
  assert.equal(JSON.stringify(report).includes("X-Amz-Signature"), false);
});

test("without a reportId the link is omitted rather than half-built", () => {
  const report = buildReportObject(
    {
      level: "5_UNITS_B2",
      overall_score: 0,
      points_earned: 0,
      points_possible: 100,
      exam_layout: [],
      question_results: [
        { question_id: "1a", criterion_breakdown: [], deductions: [], audio_metrics: {} },
      ],
    },
    ""
  );
  assert.equal(report.questions[0].recordingUrl, null);
});
