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