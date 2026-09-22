const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../../src/app");

/**
 * Drives the real Express app over a real socket, with no API keys set.
 *
 * These tests exist to cover what the unit tests cannot: that the layers are
 * actually wired together. A unit test calls a service directly and passes
 * whether or not a route reaches it, whether or not a validator runs, and
 * whether or not the error handler is mounted in the right order.
 *
 * They also pin the contract of a failure. Every error in this service now
 * becomes a response in exactly one place, so "a 422 with {error: string}"
 * is a promise the HTTP layer makes, not an accident of whichever route
 * happened to catch first.
 */

let server;
let baseUrl;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server?.close());

const get = async (path) => {
  const res = await fetch(baseUrl + path);
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("the app boots and reports its health without any credentials", async () => {
  const { status, body } = await get("/api/health");

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  // Both gradeable levels, in Speak2Go's own spelling.
  assert.deepEqual(
    body.levels.map((l) => l.level),
    ["5_UNITS_B2", "4_UNITS_B1"]
  );
});

test("the blueprint route reaches the service and returns 100 points", async () => {
  const { status, body } = await get("/api/blueprint?level=5_UNITS_B2");

  assert.equal(status, 200);
  assert.equal(body.totalPoints, 100);
  assert.equal(body.cefrLevel, "B2");
  assert.ok(body.slots.length > 0);
});

test("a superseded level code is normalised rather than rejected", async () => {
  // An older caller must not break over a naming change.
  const { status, body } = await get("/api/blueprint?level=5_UNITS_CEFR_B2");
  assert.equal(status, 200);
  assert.equal(body.level, "5_UNITS_B2");
});

test("an ungradeable level is a 422 from the central error handler", async () => {
  const { status, body } = await get("/api/blueprint?level=3_UNITS_BOOST");

  assert.equal(status, 422);
  assert.match(body.error, /cannot be graded/);
});

test("an unknown exam is a 404, not a 500", async () => {
  const { status, body } = await get("/api/exams/does-not-exist");
  assert.equal(status, 404);
  assert.equal(body.error, "Unknown examId");
});

test("an unmatched route still produces a JSON error", async () => {
  // Without the notFound handler this would be Express's HTML error page,
  // which a JSON client cannot read.
  const { status, body } = await get("/api/no-such-thing");
  assert.equal(status, 404);
  assert.match(body.error, /No route for GET/);
});

test("a validator rejects a bad request before any service runs", async () => {
  const res = await fetch(`${baseUrl}/api/recordings/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  // Both missing fields named at once, rather than one error per round trip.
  assert.match(body.error, /userEmail/);
  assert.match(body.error, /idDetection/);
});

test("starting an exam with no audio is refused", async () => {
  const form = new FormData();
  form.append("level", "5_UNITS_B2");

  const res = await fetch(`${baseUrl}/api/exams`, { method: "POST", body: form });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.match(body.error, /No audio supplied/);
});

test("an error response never leaks a stack trace", async () => {
  const { body } = await get("/api/exams/does-not-exist");
  assert.equal("stack" in body, false);
  assert.deepEqual(Object.keys(body), ["error"]);
});
