// scripts/test-parse.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { parseDeal } from "../lib/dealParser";

// The actual Coastal Spell deal text from data/dispute-thread.md
const COASTAL_SPELL_DEAL = `$5,000 vs 80% of net after expenses, whichever greater. Expenses capped $2,500. Hospitality cap $500. +$1,000 bonus over $25k gross. Marketing recoup of $900 against gross.`;

// A clean Vs deal — should have zero ambiguities
const HAPPY_PATH_DEAL = `$3,500 guarantee vs 85% of net after capped expenses (whichever is greater). Expense cap $1,800 covering production, sound, lights only. Hospitality cap $400. +$500 if attendance > 550.`;

async function run(label: string, text: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`PARSING: ${label}`);
  console.log("=".repeat(60));
  console.log(`Input:  ${text}\n`);

  const t0 = Date.now();
  const result = await parseDeal(text);
  const ms = Date.now() - t0;

  console.log(`Parsed in ${ms}ms.\n`);
  console.log(`Deal type: ${result.dealType}`);
  console.log(`Guarantee: $${result.guarantee?.amount ?? "—"}`);
  console.log(
    `Percentage: ${result.percentage ? `${result.percentage.value * 100}% of ${result.percentage.basis}` : "—"}`,
  );
  console.log(`Recoups: ${result.recoups.length}`);
  result.recoups.forEach((r) =>
    console.log(`  - ${r.label}: $${r.amount} (${r.againstWhat})`),
  );
  console.log(`Ambiguities: ${result.ambiguities.length}`);
  result.ambiguities.forEach((a) =>
    console.log(`  ⚠ [${a.severity}] ${a.clauseRef} — ${a.description}`),
  );
  console.log(`\nFull JSON:\n${JSON.stringify(result, null, 2)}`);
}

(async () => {
  await run("Coastal Spell (should flag marketing recoup ambiguity)", COASTAL_SPELL_DEAL);
  await run("Happy path (should have ZERO ambiguities)", HAPPY_PATH_DEAL);
})();