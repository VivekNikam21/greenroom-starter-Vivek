import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../db/index";
import { deals } from "../db/schema";
import { eq } from "drizzle-orm";
import { parseDealAction } from "../app/shows/[id]/actions";

const TARGET_SHOW_ID = "show_coastal_spell_dispute";

(async () => {
  const before = await db.query.deals.findFirst({
    where: eq(deals.showId, TARGET_SHOW_ID),
  });

  if (!before) {
    console.log(`Show ${TARGET_SHOW_ID} not found. Did you re-seed the DB?`);
    return;
  }

  console.log(`Target show: ${TARGET_SHOW_ID}`);
  console.log(`Deal prose: ${before.dealNotesFreetext}`);
  console.log(`parsedDealJson before: ${before.parsedDealJson ? "POPULATED" : "null"}`);
  console.log();

  if (!before.dealNotesFreetext) {
    console.log("This show has no deal notes; nothing to parse.");
    return;
  }

  console.log("Calling parseDealAction()...");
  const result = await parseDealAction(TARGET_SHOW_ID, before.dealNotesFreetext);

  if (!result.ok) {
    console.error("Action failed:", result.error);
    return;
  }

  console.log("✓ Action succeeded.");
  console.log(`  Deal type: ${result.parsed.dealType}`);
  console.log(`  Ambiguities: ${result.parsed.ambiguities.length}`);
  result.parsed.ambiguities.forEach((a) =>
    console.log(`    ⚠ [${a.severity}] ${a.clauseRef}`),
  );

  const after = await db.query.deals.findFirst({
    where: eq(deals.showId, TARGET_SHOW_ID),
  });
  console.log();
  console.log(`parsedDealJson after: ${after?.parsedDealJson ? "POPULATED ✓" : "STILL NULL ✗"}`);
  console.log(`parsedDealHash: ${after?.parsedDealHash ?? "—"}`);
})();