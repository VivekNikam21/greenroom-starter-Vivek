"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseDeal, type ParsedDeal } from "@/lib/dealParser";
import { hashDealText } from "@/lib/llmCache";

export type ParseDealActionResult =
  | { ok: true; parsed: ParsedDeal }
  | { ok: false; error: string };

/**
 * Parse a deal's prose into structured form + ambiguity flags, and persist it
 * to the deal row. Triggered from the show page's "Parse deal terms" button.
 *
 * Why this lives as a server action:
 * - The Anthropic API key never leaves the server
 * - `parseDeal()` uses an on-disk cache that's a server-side concern
 * - `revalidatePath` flips the SSR data on the show page after the write
 */
export async function parseDealAction(
  showId: string,
  dealText: string,
): Promise<ParseDealActionResult> {
  try {
    if (!dealText || dealText.trim().length < 10) {
      return { ok: false, error: "Deal text is too short to parse." };
    }

    const parsed = await parseDeal(dealText);
    const hash = hashDealText(dealText);

    await db
      .update(deals)
      .set({
        parsedDealJson: JSON.stringify(parsed),
        parsedDealHash: hash,
      })
      .where(eq(deals.showId, showId));

      // revalidatePath only works inside a Next.js request context.
    // When this action is called from a one-off script (no request),
    // the call throws — which is fine; we just don't need cache
    // invalidation outside the app.
    try {
      revalidatePath(`/shows/${showId}`);
    } catch {
      // intentionally swallow — script context, not request context
    }

    return { ok: true, parsed };
  } catch (e) {
    console.error("[parseDealAction]", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export type ResolveAmbiguityActionResult =
  | { ok: true; parsed: ParsedDeal }
  | { ok: false; error: string };

/**
 * Mark a specific ambiguity as resolved by selecting one of its plausible readings.
 *
 * When the ambiguity is about a recoup's placement, this also propagates the
 * resolution to the matching recoup — flipping `againstWhat` from "unknown"
 * to either "outside_expense_cap" or "inside_expense_cap" based on the
 * chosen reading's language. This keeps the downstream settlement engine
 * unblocked: it can refuse to settle until ambiguities are resolved and then
 * compute cleanly once they are.
 */
export async function resolveAmbiguityAction(
  showId: string,
  ambiguityId: string,
  readingId: string,
  source: "agent_email" | "manual_override" = "manual_override",
  note?: string,
): Promise<ResolveAmbiguityActionResult> {
  try {
    const row = await db.query.deals.findFirst({
      where: eq(deals.showId, showId),
    });
    if (!row?.parsedDealJson) {
      return { ok: false, error: "Deal has not been parsed yet." };
    }

    const parsed = JSON.parse(row.parsedDealJson) as ParsedDeal;
    const amb = parsed.ambiguities.find((a) => a.id === ambiguityId);
    if (!amb) return { ok: false, error: `Ambiguity ${ambiguityId} not found.` };

    const reading = amb.plausibleReadings.find((r) => r.id === readingId);
    if (!reading) return { ok: false, error: `Reading ${readingId} not found.` };

    amb.resolved = {
      readingId,
      resolvedAt: Date.now(),
      source,
      note,
    };

    // If this ambiguity governs a recoup placement, propagate to the recoup.
    // Heuristic: parse the reading's summary for "outside"/"separate" vs
    // "inside"/"within"/"part of" keywords.
    if (/recoup/i.test(amb.clauseRef)) {
      const matchingRecoup = parsed.recoups.find(
        (r) =>
          amb.clauseRef.toLowerCase().includes(r.label.toLowerCase()) ||
          amb.clauseRef.toLowerCase().includes(r.category),
      );
      if (matchingRecoup && matchingRecoup.againstWhat === "unknown") {
        const s = reading.summary.toLowerCase();
        if (/separate|outside|deducted from gross|before.*cap/.test(s)) {
          matchingRecoup.againstWhat = "outside_expense_cap";
        } else if (/inside|part of.*cap|counts.*cap|within|inside the/.test(s)) {
          matchingRecoup.againstWhat = "inside_expense_cap";
        }
      }
    }

    await db
      .update(deals)
      .set({ parsedDealJson: JSON.stringify(parsed) })
      .where(eq(deals.showId, showId));

    try {
      revalidatePath(`/shows/${showId}`);
    } catch {
      // not in request context
    }

    return { ok: true, parsed };
  } catch (e) {
    console.error("[resolveAmbiguityAction]", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: msg };
  }
}