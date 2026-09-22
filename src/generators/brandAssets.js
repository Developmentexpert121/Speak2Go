/**
 * Brand assets, inlined as data URIs.
 *
 * The report has NO external references by design — it is stored in S3 and
 * opened directly, and printed to PDF by a headless browser with no server to
 * resolve relative paths against. A logo referenced by URL would show as a
 * broken image in exactly the two places the report is actually read.
 *
 * Read once at require time. The logo is ~21KB, so ~28KB of base64 per
 * report; small enough that caching it is simpler than streaming it.
 */

const fs = require("fs");
const path = require("path");

function dataUri(file) {
  const buf = fs.readFileSync(path.join(__dirname, "assets", file));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// Supplied by the client on 19 Aug 2026 (לוגו רוחב_רקע שקוף.png — the
// transparent-background wide lockup).
const LOGO_DATA_URI = dataUri("speak2go-logo.png");

// Derived from the lockup's bubble-and-headset mark. The client said he would
// send a favicon and sent only the logo, so this is an interim crop — swap the
// file when the real one arrives, nothing else needs to change.
const FAVICON_DATA_URI = dataUri("speak2go-favicon.png");

module.exports = { LOGO_DATA_URI, FAVICON_DATA_URI };
