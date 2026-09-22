const path = require("path");
const express = require("express");

const routes = require("./routes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express app without starting it.
 *
 * Separate from server.js so the app can be required by a test and driven
 * through supertest, or mounted by something else, without a port being
 * claimed as a side effect of an import.
 */
function createApp() {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use("/api", routes);

  // Last, and in this order: anything unmatched becomes a 404 error, and every
  // error — thrown anywhere in a route or service — is turned into a response
  // in exactly one place.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
