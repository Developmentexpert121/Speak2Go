# Result callback — signature specification

How Speak2Go verifies that a result POSTed to its `callbackUrl` came from us
and has not been altered or replayed.

## The request

```
POST <callbackUrl>
content-type: application/json

x-s2g-signature: sha256=<64 lowercase hex chars>
x-s2g-timestamp: <unix seconds>
x-s2g-delivery:  <examId>
x-s2g-event:     exam.completed
```

## The signature

```
signed_string = timestamp + "." + raw_request_body
signature     = HMAC-SHA256(secret, signed_string)   // hex, lowercase
```

The timestamp is inside the signed string deliberately. Signing the body alone
would let anyone who captured one delivery replay it forever; because the
timestamp is signed it cannot be edited without breaking the signature, so the
receiver can safely reject anything older than the tolerance window.

## Verifying

1. Reject if the timestamp is more than **300 seconds** from now, **in either
   direction**. Rejecting future timestamps matters too: a clock running ahead
   would otherwise mint a request that stays valid long past the window.
2. Recompute the HMAC and compare with a **constant-time** comparison
   (`crypto.timingSafeEqual` in Node, `hash_equals` in PHP). Check the lengths
   match first, or `timingSafeEqual` throws on a truncated header.
3. The `sha256=` prefix is optional on the way in — both forms are accepted.

### The one that costs an afternoon

**Verify against the raw request body, not a re-serialised one.** Parsing the
JSON and re-stringifying it before hashing loses the original whitespace, and
then every signature fails with no visible reason. In Express:

```js
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
```

Hash `req.rawBody`, not `JSON.stringify(req.body)`.

## Test vector

Check your implementation against this before connecting anything. With this
test secret — not the real one — you must get exactly this signature:

```
secret     test_secret_do_not_use_in_production
timestamp  1755000000
body       {"examObject":{"examId":"exam_abc123"},"report":{"overallScore":72.5}}

expected   sha256=8bc7bb44c366f8a0775914075d4e0adc84b4e81247d8b3f7de890e8b1d624097
```

## Retries

Three retries on top of the first attempt — four requests at most — backing
off 1s / 5s / 20s. Configurable.

Only **429 and 5xx** are retried. A 400 or 401 means the request itself is
wrong, so repeating it just repeats the error.

Each retry is **signed fresh**, so a delayed retry still arrives inside the
5-minute window. `x-s2g-delivery` stays **constant** across retries: the same
value twice is our retry, not a second exam, and is safe to discard.

Please return a 2xx as soon as the payload is stored, rather than after
processing it. If processing is slow we will time out and retry something you
already have.
