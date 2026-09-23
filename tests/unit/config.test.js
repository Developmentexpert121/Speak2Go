const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../../src/config");
const { MODEL } = require("../../src/integrations/openaiClient");
const { getHealth } = require("../../src/services/healthService");

/**
 * Configuration is read in one place. These tests exist because the previous
 * arrangement — every module reading process.env with its own default — had
 * already drifted: the scoring client defaulted OPENAI_MODEL to "gpt-4o"
 * while the health check and the recommendation writer defaulted it to
 * "gpt-4o-mini". With the variable unset, exams were graded by one model
 * while the service reported another, at roughly fifteen times the cost.
 *
 * Nothing threw. That is the point: a divergence like this is only ever
 * caught by comparing the values, so they are compared here.
 */

test("every consumer reports the same OpenAI model", () => {
  assert.equal(MODEL, config.openai.model);
  assert.equal(getHealth().model, config.openai.model);
});

test("the model default is the cheap one, not the expensive one", () => {
  const saved = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL;
  try {
    config.reload();
    assert.equal(config.openai.model, "gpt-4o-mini");
  } finally {
    if (saved === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = saved;
    config.reload();
  }
});

test("reload picks up a changed environment without replacing the object", () => {
  // Modules hold a reference to this object, so reload must mutate in place;
  // swapping it would leave every importer pointing at stale values.
  const before = config;
  const saved = process.env.PORT;
  process.env.PORT = "4321";
  try {
    config.reload();
    assert.equal(config.PORT, 4321);
    assert.equal(config, before, "reload must not replace the exported object");
  } finally {
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
    config.reload();
  }
});

test("reload survives being called twice", () => {
  // It deletes its own keys to rebuild; deleting `reload` too would make the
  // second call throw.
  config.reload();
  config.reload();
  assert.equal(typeof config.reload, "function");
});

test("reload is not enumerable, so a config dump stays serialisable", () => {
  assert.equal(Object.keys(config).includes("reload"), false);
  assert.doesNotThrow(() => JSON.stringify(config));
});
