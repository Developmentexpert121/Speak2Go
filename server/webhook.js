/**
 * Signed delivery of a finished exam result to Speak2Go.
 *
 * The client chose webhooks with HMAC-SHA256 and asked for a timestamp in the
 * signature (12 Aug 2026). The callback target arrives as `callbackUrl` on the
 * Exam Object.
 *
 * THE SIGNATURE. We sign `${timestamp}.${rawBody}`, not the body alone. A
 * signature over the body alone is replayable forever: anyone who captures one
 * delivery can resend that exact request tomorrow and it still verifies. Tying
 * the timestamp into the signed string means the timestamp cannot be edited
 * without invalidating the signature, so the receiver can reject anything
 * older than its tolerance window and a captured request stops being useful
 * within minutes.
 *
 * THE RAW BODY. `rawBody` is serialized exactly once here and that same string
 * is both signed and sent. The receiver must verify against the raw bytes it
 * received, NOT against a re-serialized parsed object — JSON.parse followed by
 * JSON.stringify can reorder keys and change whitespace, which changes the
 * digest and fails every verification for no visible reason. This is the
 * single most common way HMAC webhook integrations break, so verifyRequest()
 * below is exported for Avinoam to use directly rather than reimplement.
 *
 * THE ALLOWLIST. `callbackUrl` is caller-supplied input, so an unrestricted
 * sender is a server-side request forgery primitive: submit an exam with a
 * callbackUrl pointing at an internal address and we will POST a signed
 * request to it from inside the network. Hosts must therefore be named in
 * WEBHOOK_ALLOWED_HOSTS, and delivery fails closed when that is unset — an
 * undelivered result is recoverable, a blind SSRF is not.
 */

const crypto = require("crypto");

const SIGNATURE_HEADER = "x-s2g-signature";
const TIMESTAMP_HEADER = "x-s2g-timestamp";
const DELIVERY_HEADER = "x-s2g-delivery";
const EVENT_HEADER = "x-s2g-event";

/** How far out of date a timestamp may be before the receiver rejects it. */
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Attempt schedule in ms. Five tries over ~2.5 minutes, then give up. */
const RETRY_DELAYS_MS = [1000, 5000, 20000, 60000];

function getSecret() {
  return process.env.WEBHOOK_SIGNING_SECRET || "";
}

/**
 * Hosts we are permitted to call back. Comma-separated, host only (no scheme,
 * no path). A leading "*." permits subdomains: "*.speak2go.net" matches
 * "api.speak2go.net" but not "speak2go.net.evil.com", because the check is a
 * suffix match on a dot boundary rather than a substring match.
 */
function allowedHosts() {
  return (process.env.WEBHOOK_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostIsAllowed(hostname, allowed = allowedHosts()) {
  const host = String(hostname || "").toLowerCase();
  return allowed.some((pattern) =>
    pattern.startsWith("*.")
      ? host === pattern.slice(2) || host.endsWith(pattern.slice(1))
      : host === pattern
  );
}

/**
 * Validates a caller-supplied callback URL before we ever connect to it.
 *
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
function validateCallbackUrl(rawUrl) {
  if (!rawUrl) return { ok: false, reason: "no callbackUrl supplied" };

  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: `callbackUrl is not a valid URL: ${rawUrl}` };
  }

  // http is tolerated only for loopback, so local integration testing works
  // without a certificate. Anything reachable off this machine must be https —
  // the payload carries a student's name, school and grades.
  const isLoopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    return { ok: false, reason: `callbackUrl must be https (got ${url.protocol}//)` };
  }

  const allowed = allowedHosts();
  if (!allowed.length) {
    return {
      ok: false,
      reason:
        "WEBHOOK_ALLOWED_HOSTS is not set, so no callback target is trusted. " +
        "Set it to the Speak2Go callback host before enabling delivery.",
    };
  }
  if (!hostIsAllowed(url.hostname, allowed)) {
    return { ok: false, reason: `callbackUrl host "${url.hostname}" is not in WEBHOOK_ALLOWED_HOSTS` };
  }

  return { ok: true, url };
}

/**
 * Builds the signature for a raw body at a given time.
 *
 * @returns {{ signature: string, timestamp: string, signedPayload: string }}
 */
function signPayload(rawBody, secret = getSecret(), timestamp = Math.floor(Date.now() / 1000)) {
  const ts = String(timestamp);
  const signedPayload = `${ts}.${rawBody}`;
  const signature = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return { signature: `sha256=${signature}`, timestamp: ts, signedPayload };
}

/**
 * Verifies an inbound signed request. Exported so the receiving side can use
 * exactly this code path rather than a near-miss reimplementation.
 *
 * @param {object} params
 * @param {string|Buffer} params.rawBody - the bytes as received, NOT re-serialized
 * @param {string} params.signatureHeader - value of x-s2g-signature
 * @param {string} params.timestampHeader - value of x-s2g-timestamp
 * @param {string} params.secret
 * @param {number} [params.toleranceSeconds]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyRequest({
  rawBody,
  signatureHeader,
  timestampHeader,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = Math.floor(Date.now() / 1000),
}) {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  if (!signatureHeader) return { ok: false, reason: `missing ${SIGNATURE_HEADER}` };
  if (!timestampHeader) return { ok: false, reason: `missing ${TIMESTAMP_HEADER}` };

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: "timestamp is not a number" };

  // Rejecting future timestamps as well as old ones: a clock far ahead would
  // otherwise mint a request that stays valid long past the window.
  if (Math.abs(now - ts) > toleranceSeconds) {
    return { ok: false, reason: `timestamp outside ${toleranceSeconds}s tolerance` };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestampHeader}.${body}`, "utf8")
    .digest("hex");

  const provided = String(signatureHeader).replace(/^sha256=/, "");

  // Length check first: timingSafeEqual throws on a length mismatch, and a
  // plain === anywhere in here would leak the digest one byte at a time.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "signature mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  return { ok: true };
}

/** 429 and 5xx are worth retrying; other 4xx mean the request itself is wrong. */
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs a payload to the callback URL, signed, with retries.
 *
 * Never throws. Delivery failure is reported in the return value so a caller
 * mid-way through finishing an exam cannot be derailed by it.
 *
 * @returns {Promise<{ delivered: boolean, attempts: number, status?: number,
 *   reason?: string, deliveryId: string }>}
 */
async function deliverResult({ examId, callbackUrl, payload, event = "exam.completed", fetchImpl = fetch }) {
  const deliveryId = `${examId}`;

  const target = validateCallbackUrl(callbackUrl);
  if (!target.ok) {
    console.warn(`  webhook not sent for ${examId}: ${target.reason}`);
    return { delivered: false, attempts: 0, reason: target.reason, deliveryId };
  }

  const secret = getSecret();
  if (!secret) {
    const reason = "WEBHOOK_SIGNING_SECRET is not set — refusing to send an unsigned result";
    console.warn(`  webhook not sent for ${examId}: ${reason}`);
    return { delivered: false, attempts: 0, reason, deliveryId };
  }

  // Serialized once. This exact string is what gets signed and what gets sent.
  const rawBody = JSON.stringify(payload);

  let lastReason = "";
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    // Re-signed per attempt so a retry 60s later is not rejected for being
    // outside the receiver's timestamp window.
    const { signature, timestamp } = signPayload(rawBody, secret);

    try {
      const res = await fetchImpl(target.url.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [TIMESTAMP_HEADER]: timestamp,
          // Stable across retries, so the receiver can discard a duplicate
          // caused by our retry rather than grading the same exam twice.
          [DELIVERY_HEADER]: deliveryId,
          [EVENT_HEADER]: event,
        },
        body: rawBody,
      });

      if (res.ok) {
        return { delivered: true, attempts: attempt, status: res.status, deliveryId };
      }

      lastReason = `HTTP ${res.status}`;
      if (!isRetryableStatus(res.status)) {
        return { delivered: false, attempts: attempt, status: res.status, reason: lastReason, deliveryId };
      }
    } catch (err) {
      lastReason = err.message;
    }

    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (delay === undefined) break;
    await sleep(delay);
  }

  console.warn(`  webhook delivery failed for ${examId} after retries: ${lastReason}`);
  return { delivered: false, attempts: RETRY_DELAYS_MS.length + 1, reason: lastReason, deliveryId };
}

module.exports = {
  deliverResult,
  signPayload,
  verifyRequest,
  validateCallbackUrl,
  hostIsAllowed,
  isRetryableStatus,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  DELIVERY_HEADER,
  EVENT_HEADER,
  DEFAULT_TOLERANCE_SECONDS,
};
