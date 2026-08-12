const test = require("node:test");
const assert = require("node:assert");

const {
  signPayload,
  verifyRequest,
  validateCallbackUrl,
  hostIsAllowed,
  isRetryableStatus,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  DELIVERY_HEADER,
} = require("../../server/webhook");

const SECRET = "test_secret_do_not_use_in_production";

/** Runs fn with the given env vars set, restoring whatever was there before. */
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("a freshly signed payload verifies", () => {
  const body = JSON.stringify({ overallScore: 72 });
  const { signature, timestamp } = signPayload(body, SECRET, 1000);

  const result = verifyRequest({
    rawBody: body,
    signatureHeader: signature,
    timestampHeader: timestamp,
    secret: SECRET,
    now: 1000,
  });

  assert.deepEqual(result, { ok: true });
});

test("the signature covers the timestamp, not just the body", () => {
  // The whole point of including a timestamp: an attacker who replays a
  // captured body cannot slide the timestamp forward to defeat the freshness
  // window, because doing so invalidates the signature.
  const body = JSON.stringify({ overallScore: 72 });
  const { signature } = signPayload(body, SECRET, 1000);

  const result = verifyRequest({
    rawBody: body,
    signatureHeader: signature,
    timestampHeader: "9999", // moved forward to look fresh
    secret: SECRET,
    now: 9999,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /signature mismatch/);
});

test("an old but correctly-signed request is rejected as stale", () => {
  const body = JSON.stringify({ overallScore: 72 });
  const { signature, timestamp } = signPayload(body, SECRET, 1000);

  const result = verifyRequest({
    rawBody: body,
    signatureHeader: signature,
    timestampHeader: timestamp,
    secret: SECRET,
    now: 1000 + 301, // one second past the 300s tolerance
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /tolerance/);
});

test("a timestamp far in the future is rejected too", () => {
  const body = "{}";
  const { signature, timestamp } = signPayload(body, SECRET, 100000);

  const result = verifyRequest({
    rawBody: body,
    signatureHeader: signature,
    timestampHeader: timestamp,
    secret: SECRET,
    now: 1000,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /tolerance/);
});

test("any change to the body breaks verification", () => {
  const body = JSON.stringify({ overallScore: 72 });
  const { signature, timestamp } = signPayload(body, SECRET, 1000);

  const result = verifyRequest({
    rawBody: JSON.stringify({ overallScore: 99 }),
    signatureHeader: signature,
    timestampHeader: timestamp,
    secret: SECRET,
    now: 1000,
  });

  assert.equal(result.ok, false);
});

test("re-serializing the body breaks verification — receivers must use raw bytes", () => {
  // This is the trap worth having a test for. Key order survives a
  // parse/stringify round trip in V8 for string keys, but whitespace does not,
  // and a receiver that verifies against JSON.stringify(req.body) will fail
  // for any sender that pretty-prints. Documented here so the requirement is
  // not lost.
  const body = JSON.stringify({ overallScore: 72, level: "5_UNITS_CEFR_B2" }, null, 2);
  const { signature, timestamp } = signPayload(body, SECRET, 1000);

  const reSerialized = JSON.stringify(JSON.parse(body));
  assert.notEqual(reSerialized, body, "test is meaningless if the two strings match");

  const result = verifyRequest({
    rawBody: reSerialized,
    signatureHeader: signature,
    timestampHeader: timestamp,
    secret: SECRET,
    now: 1000,
  });

  assert.equal(result.ok, false);
});

test("a wrong secret does not verify", () => {
  const body = "{}";
  const { signature, timestamp } = signPayload(body, SECRET, 1000);

  const result = verifyRequest({
    rawBody: body,
    signatureHeader: signature,
    timestampHeader: timestamp,
    secret: "some_other_secret",
    now: 1000,
  });

  assert.equal(result.ok, false);
});

test("missing headers are reported rather than throwing", () => {
  assert.equal(
    verifyRequest({ rawBody: "{}", timestampHeader: "1", secret: SECRET, now: 1 }).ok,
    false
  );
  assert.equal(
    verifyRequest({ rawBody: "{}", signatureHeader: "sha256=x", secret: SECRET, now: 1 }).ok,
    false
  );
  assert.equal(verifyRequest({ rawBody: "{}", secret: "", now: 1 }).ok, false);
});

test("a signature of the wrong length is rejected without throwing", () => {
  // timingSafeEqual throws on mismatched lengths, so the length check has to
  // come first or a truncated header crashes the receiver.
  const result = verifyRequest({
    rawBody: "{}",
    signatureHeader: "sha256=abc",
    timestampHeader: "1000",
    secret: SECRET,
    now: 1000,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature mismatch/);
});

test("the sha256= prefix is optional on the way in", () => {
  const body = "{}";
  const { signature, timestamp } = signPayload(body, SECRET, 1000);

  const result = verifyRequest({
    rawBody: body,
    signatureHeader: signature.replace(/^sha256=/, ""),
    timestampHeader: timestamp,
    secret: SECRET,
    now: 1000,
  });

  assert.deepEqual(result, { ok: true });
});

test("host allowlist matches exactly, and wildcards only on a dot boundary", () => {
  const allowed = ["api.speak2go.net", "*.internal.speak2go.net"];

  assert.equal(hostIsAllowed("api.speak2go.net", allowed), true);
  assert.equal(hostIsAllowed("API.Speak2Go.NET", allowed), true, "host compare is case-insensitive");
  assert.equal(hostIsAllowed("hooks.internal.speak2go.net", allowed), true);
  assert.equal(hostIsAllowed("internal.speak2go.net", allowed), true, "*. also matches the bare domain");

  // The attack a naive endsWith() would allow.
  assert.equal(hostIsAllowed("api.speak2go.net.evil.com", allowed), false);
  assert.equal(hostIsAllowed("evil-api.speak2go.net", allowed), false);
  assert.equal(hostIsAllowed("speak2go.net", allowed), false);
});

test("callbackUrl validation fails closed when no allowlist is configured", () => {
  withEnv({ WEBHOOK_ALLOWED_HOSTS: undefined }, () => {
    const result = validateCallbackUrl("https://api.speak2go.net/hook");
    assert.equal(result.ok, false);
    assert.match(result.reason, /WEBHOOK_ALLOWED_HOSTS/);
  });
});

test("callbackUrl must be https and on the allowlist", () => {
  withEnv({ WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net" }, () => {
    assert.equal(validateCallbackUrl("https://api.speak2go.net/hook").ok, true);

    // The SSRF case: a caller-supplied URL aimed at something internal.
    assert.equal(validateCallbackUrl("https://169.254.169.254/latest/meta-data/").ok, false);
    assert.equal(validateCallbackUrl("https://evil.example.com/hook").ok, false);

    // Plain http off-machine would put student names and grades on the wire.
    assert.equal(validateCallbackUrl("http://api.speak2go.net/hook").ok, false);

    assert.equal(validateCallbackUrl("not a url").ok, false);
    assert.equal(validateCallbackUrl(null).ok, false);
    assert.equal(validateCallbackUrl("file:///etc/passwd").ok, false);
  });
});

test("loopback http is allowed so local integration testing works", () => {
  withEnv({ WEBHOOK_ALLOWED_HOSTS: "localhost" }, () => {
    assert.equal(validateCallbackUrl("http://localhost:4000/hook").ok, true);
  });
});

test("only 429 and 5xx are retried", () => {
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(429), true);
  // A 400 or 401 means the request is wrong; retrying it just repeats the error.
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(200), false);
});

test("deliverResult signs what it sends and reports success", async () => {
  const { deliverResult } = require("../../server/webhook");

  await withEnv(
    { WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net", WEBHOOK_SIGNING_SECRET: SECRET },
    async () => {
      let seen = null;
      const fakeFetch = async (url, opts) => {
        seen = { url, opts };
        return { ok: true, status: 200 };
      };

      const payload = { report: { overallScore: 61 } };
      const result = await deliverResult({
        examId: "exam_abc",
        callbackUrl: "https://api.speak2go.net/hook",
        payload,
        fetchImpl: fakeFetch,
      });

      assert.equal(result.delivered, true);
      assert.equal(result.attempts, 1);

      // The bytes on the wire must be exactly what was signed.
      const verified = verifyRequest({
        rawBody: seen.opts.body,
        signatureHeader: seen.opts.headers[SIGNATURE_HEADER],
        timestampHeader: seen.opts.headers[TIMESTAMP_HEADER],
        secret: SECRET,
      });
      assert.deepEqual(verified, { ok: true });

      assert.equal(seen.opts.headers[DELIVERY_HEADER], "exam_abc");
      assert.equal(JSON.parse(seen.opts.body).report.overallScore, 61);
    }
  );
});

test("deliverResult refuses to send unsigned when no secret is set", async () => {
  const { deliverResult } = require("../../server/webhook");

  await withEnv(
    { WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net", WEBHOOK_SIGNING_SECRET: undefined },
    async () => {
      let called = false;
      const result = await deliverResult({
        examId: "exam_abc",
        callbackUrl: "https://api.speak2go.net/hook",
        payload: {},
        fetchImpl: async () => {
          called = true;
          return { ok: true, status: 200 };
        },
      });

      assert.equal(result.delivered, false);
      assert.equal(called, false, "nothing should reach the network without a secret");
      assert.match(result.reason, /WEBHOOK_SIGNING_SECRET/);
    }
  );
});

test("deliverResult does not retry a 4xx", async () => {
  const { deliverResult } = require("../../server/webhook");

  await withEnv(
    { WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net", WEBHOOK_SIGNING_SECRET: SECRET },
    async () => {
      let calls = 0;
      const result = await deliverResult({
        examId: "exam_abc",
        callbackUrl: "https://api.speak2go.net/hook",
        payload: {},
        fetchImpl: async () => {
          calls += 1;
          return { ok: false, status: 401 };
        },
      });

      assert.equal(result.delivered, false);
      assert.equal(calls, 1);
      assert.equal(result.status, 401);
    }
  );
});

test("a 5xx is retried three times by default — four requests in total", async () => {
  const { deliverResult } = require("../../server/webhook");

  await withEnv(
    {
      WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net",
      WEBHOOK_SIGNING_SECRET: SECRET,
      WEBHOOK_MAX_RETRIES: undefined, // exercise the default
    },
    async () => {
      let calls = 0;
      const result = await deliverResult({
        examId: "exam_abc",
        callbackUrl: "https://api.speak2go.net/hook",
        payload: {},
        fetchImpl: async () => {
          calls += 1;
          return { ok: false, status: 503 };
        },
        sleepImpl: async () => {}, // skip the real backoff
      });

      assert.equal(result.delivered, false);
      assert.equal(calls, 4, "1 initial attempt + 3 retries");
      assert.equal(result.attempts, 4);
    }
  );
});

test("the retry count is configurable", async () => {
  const { deliverResult } = require("../../server/webhook");

  for (const [configured, expectedCalls] of [
    ["0", 1],
    ["1", 2],
    ["6", 7], // past the end of the backoff schedule — must not run off it
  ]) {
    await withEnv(
      {
        WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net",
        WEBHOOK_SIGNING_SECRET: SECRET,
        WEBHOOK_MAX_RETRIES: configured,
      },
      async () => {
        let calls = 0;
        const result = await deliverResult({
          examId: "exam_abc",
          callbackUrl: "https://api.speak2go.net/hook",
          payload: {},
          fetchImpl: async () => {
            calls += 1;
            return { ok: false, status: 500 };
          },
          sleepImpl: async () => {},
        });
        assert.equal(calls, expectedCalls, `WEBHOOK_MAX_RETRIES=${configured}`);
        assert.equal(result.attempts, expectedCalls);
      }
    );
  }
});

test("a garbled retry count falls back to the default rather than disabling retries", () => {
  const { maxRetries, DEFAULT_MAX_RETRIES } = require("../../server/webhook");

  withEnv({ WEBHOOK_MAX_RETRIES: "not a number" }, () => {
    assert.equal(maxRetries(), DEFAULT_MAX_RETRIES);
  });
  withEnv({ WEBHOOK_MAX_RETRIES: "-2" }, () => {
    assert.equal(maxRetries(), DEFAULT_MAX_RETRIES);
  });
  // An explicit 0 is a real choice and must be honoured — it is the only way
  // to say "deliver once, never retry".
  withEnv({ WEBHOOK_MAX_RETRIES: "0" }, () => {
    assert.equal(maxRetries(), 0);
  });
});

test("a retry is re-signed, so a delivery delayed past the window still verifies", async () => {
  // Each attempt gets a fresh timestamp and signature. Without that, a retry
  // 60s later would carry the original timestamp and the receiver would reject
  // it as stale — the retries would be guaranteed to fail.
  const { deliverResult } = require("../../server/webhook");

  await withEnv(
    { WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net", WEBHOOK_SIGNING_SECRET: SECRET, WEBHOOK_MAX_RETRIES: "1" },
    async () => {
      const seen = [];
      await deliverResult({
        examId: "exam_abc",
        callbackUrl: "https://api.speak2go.net/hook",
        payload: { report: { overallScore: 61 } },
        fetchImpl: async (url, opts) => {
          seen.push(opts);
          return { ok: false, status: 500 };
        },
        sleepImpl: async () => {},
      });

      assert.equal(seen.length, 2);
      for (const opts of seen) {
        const verified = verifyRequest({
          rawBody: opts.body,
          signatureHeader: opts.headers[SIGNATURE_HEADER],
          timestampHeader: opts.headers[TIMESTAMP_HEADER],
          secret: SECRET,
        });
        assert.deepEqual(verified, { ok: true }, "every attempt must verify on its own");
      }
      // Same exam, same delivery id — that is what lets the receiver discard
      // the duplicate our own retry created.
      assert.equal(seen[0].headers[DELIVERY_HEADER], seen[1].headers[DELIVERY_HEADER]);
    }
  );
});

test("a blocked callbackUrl never reaches the network", async () => {
  const { deliverResult } = require("../../server/webhook");

  await withEnv(
    { WEBHOOK_ALLOWED_HOSTS: "api.speak2go.net", WEBHOOK_SIGNING_SECRET: SECRET },
    async () => {
      let called = false;
      const result = await deliverResult({
        examId: "exam_abc",
        callbackUrl: "https://169.254.169.254/latest/meta-data/",
        payload: {},
        fetchImpl: async () => {
          called = true;
          return { ok: true, status: 200 };
        },
      });

      assert.equal(result.delivered, false);
      assert.equal(called, false);
    }
  );
});
