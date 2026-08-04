require("dotenv").config();
const OpenAI = require("openai");

async function main() {
  console.log("OPENAI_MODEL from .env:", JSON.stringify(process.env.OPENAI_MODEL));
  console.log("OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);
  console.log("OPENAI_API_KEY prefix:", (process.env.OPENAI_API_KEY || "").slice(0, 7) + "...");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const models = await client.models.list();
    const gptModels = models.data
      .map((m) => m.id)
      .filter((id) => id.includes("gpt"))
      .sort();
    console.log("\nGPT models available to this key:");
    console.log(gptModels.join("\n"));
  } catch (err) {
    console.error("\nCould not list models — this usually means the API key itself is invalid:");
    console.error(err.message);
  }
}

main();
