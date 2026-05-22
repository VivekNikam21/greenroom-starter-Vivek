import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../db/index";
import { shows, deals, ticketSales, expenses, comps } from "../db/schema";
import { eq } from "drizzle-orm";
import { calculateSettlement } from "../lib/dealMath";
import type { ParsedDeal } from "../lib/dealParser";

async function runForShow(showId: string) {
  const showRow = await db.query.shows.findFirst({
    where: eq(shows.id, showId),
  });
  if (!showRow) {
    console.log(`[${showId}] Show not found.`);
    return;
  }

  const dealRow = await db.query.deals.findFirst({
    where: eq(deals.showId, showId),
  });
  if (!dealRow) {
    console.log(`[${showId}] No deal found.`);
    return;
  }

  const tsRows = await db.select().from(ticketSales).where(eq(ticketSales.showId, showId));
  const expRows = await db.select().from(expenses).where(eq(expenses.showId, showId));
  const compRows = await db.select().from(comps).where(eq(comps.showId, showId));

  const parsedDeal: ParsedDeal | null = dealRow.parsedDealJson
    ? (JSON.parse(dealRow.parsedDealJson) as ParsedDeal)
    : null;

  console.log("\n" + "=".repeat(70));
  console.log(`SHOW: ${showId}  (${dealRow.dealType})`);
  console.log("=".repeat(70));
  console.log(`Deal prose: ${dealRow.dealNotesFreetext?.slice(0, 120)}...`);
  console.log(`Parsed: ${parsedDeal ? "yes" : "no"}`);
  console.log(`Fees: $${tsRows.reduce((s, t) => s + t.fees, 0).toFixed(2)}`);
  console.log(`Comps toward gross: ${compRows.filter((c) => c.countsTowardGross).reduce((s, c) => s + c.count * c.faceValue, 0)}`);

  const result = calculateSettlement({
    deal: dealRow,
    parsedDeal,
    ticketSales: tsRows,
    expenses: expRows,
    comps: compRows,
  });

  if (!result.supported) {
    console.log(`\n❌ NOT SETTLED — reason: ${result.blockedReason}`);
    console.log(`   ${result.reason}`);
    if (result.blockingAmbiguityIds?.length) {
      console.log(`   Blocking ambiguities: ${result.blockingAmbiguityIds.join(", ")}`);
    }
    return;
  }

  console.log(`\n✓ SETTLED`);
  console.log(`  Gross box office: $${result.grossBoxOffice.toFixed(2)}`);
  console.log(`  Total expenses:   $${result.totalExpenses.toFixed(2)}`);
  console.log(`  Final to artist:  $${result.totalToArtist.toFixed(2)}`);
  console.log(`\n  Steps:`);
  for (const s of result.steps) {
    const sign = s.value < 0 ? "" : "+";
    console.log(
      `    ${s.label.padEnd(40)} ${sign}$${s.value.toFixed(2).padStart(10)}   [${s.sourceClause ?? "-"}]`,
    );
    if (s.note) console.log(`        ${s.note}`);
  }
  console.log(`\n  Formula: ${result.finalFormula}`);
}

(async () => {
  await runForShow("show_coastal_spell_dispute");

  const doorShow = await db.query.deals.findFirst({
    where: eq(deals.dealType, "door"),
  });
  if (doorShow) await runForShow(doorShow.showId);

  const netShow = await db.query.deals.findFirst({
    where: eq(deals.dealType, "percentage_of_net"),
  });
  if (netShow) await runForShow(netShow.showId);

  const vsShows = await db.select().from(deals).where(eq(deals.dealType, "vs"));
  const vanilla = vsShows.find(
    (d) =>
      d.dealNotesFreetext &&
      !/walkout|ratchet|recoup/i.test(d.dealNotesFreetext) &&
      d.parsedDealJson,
  );
  if (vanilla) await runForShow(vanilla.showId);
})();