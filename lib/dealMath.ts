/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * AS OF STEP 5 — EXTENDED.
 *
 * Original engine settled Flat and % of Gross only. This version adds:
 *   3. vs                  — guarantee vs % of net, whichever greater
 *   4. percentage_of_net   — pure % of net (Vs without the guarantee floor)
 *   5. door                — artist gets gross minus capped expenses
 *
 * Coverage: now settles ~89% of Crescent shows. The remaining 11% — Vs deals
 * with walkout pots (32 shows) or tier ratchets (25 shows) — are explicitly
 * DETECTED but NOT SETTLED. Engine returns supported:false with a clear
 * "settle in spreadsheet" reason. That's a deliberate cut: getting walkout
 * math wrong is worse than not attempting it.
 *
 * Settlement guards:
 *
 *   A. Ambiguity gate: any HIGH severity ambiguity that hasn't been resolved
 *      blocks settlement. UI prompts to resolve first.
 *   B. Recoup placement gate: any recoup with againstWhat="unknown" blocks
 *      settlement. Resolving the parent ambiguity propagates a placement,
 *      which unblocks the engine.
 *
 * Line provenance: every step carries a sourceClause so the UI can trace any
 * dollar in the breakdown back to the deal clause that produced it
 * (guarantee, percentage, expense_cap, recoup:<id>, bonus:<label>).
 *
 * Industry-standard deductions applied:
 *   - Ticket platform fees deducted before "net" (Vs, % of net, Door)
 *   - Comps with countsTowardGross=true added to gross at face value
 *     before percentage / settlement math
 *
 * What still doesn't work — documented as cuts in the memo:
 *   - Hospitality cap as a separate ceiling (rolls into expense bucket)
 *   - Recoups in % of gross / Door (rare combination)
 *   - Flat and % of gross paths don't deduct fees (inherited, out of scope)
 */

import type { Deal, Expense, TicketSale, Bonus } from "@/db/schema";
import type { ParsedDeal, Recoup } from "./dealParser";

export type SettlementStep = {
  label: string;
  value: number;
  note?: string;
  /** Which deal clause produced this line. */
  sourceClause?: string;
  /** Optional formula string for tooltips. */
  formula?: string;
};

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      totalToArtist: number;
      steps: SettlementStep[];
      finalFormula: string;
      bonusesApplied: { label: string; amount: number; reason: string }[];
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
      blockedReason?:
        | "deal_type_unsupported"
        | "deal_variant_unsupported"
        | "unresolved_ambiguity"
        | "unknown_recoup_placement"
        | "missing_data";
      blockingAmbiguityIds?: string[];
    };

interface CalcInput {
  deal: Deal;
  /** Optional. When provided, gives us recoups + ambiguity gating. */
  parsedDeal?: ParsedDeal | null;
  ticketSales: TicketSale[];
  expenses: Expense[];
  /** Comp tickets — used to add countsTowardGross comps to gross at face value. */
  comps?: { count: number; faceValue: number; countsTowardGross: boolean }[];
  venueCapacity?: number;
  ticketsSold?: number;
}

const FRIENDLY_NAME: Record<Deal["dealType"], string> = {
  flat: "Flat guarantee",
  percentage_of_gross: "Percentage of gross",
  percentage_of_net: "Percentage of net",
  vs: "Vs deal (guarantee vs %)",
  door: "Door deal",
};

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, parsedDeal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  // =================================================================
  // GUARDS — checked before any math runs
  // =================================================================
  if (parsedDeal) {
    if (parsedDeal.walkout) {
      return {
        supported: false,
        dealType: deal.dealType,
        reason:
          "This is a walkout-pot Vs deal. Walkout math (breakeven on guarantee + expenses, then artist takes incremental gross) isn't yet supported in-app. Settle this one in a spreadsheet.",
        blockedReason: "deal_variant_unsupported",
      };
    }
    if (parsedDeal.ratchet) {
      return {
        supported: false,
        dealType: deal.dealType,
        reason:
          "This is a tier-ratchet deal. The escalator percentage logic isn't yet supported in-app. Settle this one in a spreadsheet.",
        blockedReason: "deal_variant_unsupported",
      };
    }

    const unresolvedHigh = parsedDeal.ambiguities.filter(
      (a) => a.severity === "high" && !a.resolved,
    );
    if (unresolvedHigh.length > 0) {
      return {
        supported: false,
        dealType: deal.dealType,
        reason:
          unresolvedHigh.length === 1
            ? `1 high-severity ambiguity needs to be resolved before settling: "${unresolvedHigh[0].clauseRef}"`
            : `${unresolvedHigh.length} high-severity ambiguities need to be resolved before settling.`,
        blockedReason: "unresolved_ambiguity",
        blockingAmbiguityIds: unresolvedHigh.map((a) => a.id),
      };
    }

    const unknownRecoups = parsedDeal.recoups.filter(
      (r) => r.againstWhat === "unknown",
    );
    if (unknownRecoups.length > 0) {
      return {
        supported: false,
        dealType: deal.dealType,
        reason: `Recoup placement is unresolved for: ${unknownRecoups.map((r) => `"${r.label}"`).join(", ")}. Resolve the related deal ambiguity first.`,
        blockedReason: "unknown_recoup_placement",
      };
    }
  }

  // =================================================================
  // Baseline figures
  // =================================================================
  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);
  const tickets = ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);
  const recoups: Recoup[] = parsedDeal?.recoups ?? [];

  // Comps that count toward gross at face value. Industry standard: some
  // artists negotiate that press / sponsor / promo comps still count toward
  // their percentage. We add the face-value total to gross for math purposes,
  // but display it as its own step so the provenance is visible.
  const compsTowardGross = (input.comps ?? [])
    .filter((c) => c.countsTowardGross)
    .reduce((sum, c) => sum + c.count * c.faceValue, 0);

  // =================================================================
  // Deal type branches
  // =================================================================

  // ---------- Flat ----------
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
        blockedReason: "missing_data",
      };
    }
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice + compsTowardGross,
      tickets,
      capacity: venueCapacity,
    });
    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
      steps: [
        {
          label: "Flat guarantee",
          value: deal.guaranteeAmount,
          note: "No expense deductions. Guarantee is the floor.",
          sourceClause: "guarantee",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
          sourceClause: `bonus:${b.label}`,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
        : `flat guarantee = ${deal.guaranteeAmount}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- % of gross ----------
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
        blockedReason: "missing_data",
      };
    }
    const effectiveGross = grossBoxOffice + compsTowardGross;
    const payout = effectiveGross * deal.percentage;
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: effectiveGross,
      tickets,
      capacity: venueCapacity,
    });

    const steps: SettlementStep[] = [
      { label: "Gross box office", value: grossBoxOffice, sourceClause: "gross" },
    ];
    if (compsTowardGross > 0) {
      steps.push({
        label: "+ Comps counting toward gross",
        value: compsTowardGross,
        note: "Press / sponsor / promo comps the deal counts at face value.",
        sourceClause: "gross",
      });
    }
    steps.push({
      label: `× ${(deal.percentage * 100).toFixed(0)}%`,
      value: payout,
      note: "Percentage of gross — no expense deductions.",
      sourceClause: "percentage",
      formula: `gross × ${deal.percentage}`,
    });
    for (const b of bonusResult.applied) {
      steps.push({
        label: b.label,
        value: b.amount,
        note: b.reason,
        sourceClause: `bonus:${b.label}`,
      });
    }

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps,
      finalFormula: bonusResult.applied.length
        ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
    };
  }

  // ---------- Vs (guarantee vs % of net) ----------
  if (deal.dealType === "vs") {
    return calculateVsOrNetDeal(input, {
      includeGuaranteeFloor: true,
      recoups,
      grossBoxOffice,
      totalExpenses,
      tickets,
      totalFees,
      compsTowardGross,
    });
  }

  // ---------- % of net (no floor) ----------
  if (deal.dealType === "percentage_of_net") {
    return calculateVsOrNetDeal(input, {
      includeGuaranteeFloor: false,
      recoups,
      grossBoxOffice,
      totalExpenses,
      tickets,
      totalFees,
      compsTowardGross,
    });
  }

  // ---------- Door ----------
  if (deal.dealType === "door") {
    return calculateDoorDeal(input, {
      grossBoxOffice,
      totalExpenses,
      tickets,
      totalFees,
      compsTowardGross,
    });
  }

  return {
    supported: false,
    dealType: deal.dealType,
    reason: `Deal type "${deal.dealType}" is not recognized.`,
    blockedReason: "deal_type_unsupported",
  };
}

// =====================================================================
// Vs / % of net (shared logic)
// =====================================================================
function calculateVsOrNetDeal(
  input: CalcInput,
  ctx: {
    includeGuaranteeFloor: boolean;
    recoups: Recoup[];
    grossBoxOffice: number;
    totalExpenses: number;
    tickets: number;
    totalFees: number;
    compsTowardGross: number;
  },
): SettlementCalculation {
  const { deal, venueCapacity } = input;
  const {
    includeGuaranteeFloor,
    recoups,
    grossBoxOffice,
    totalExpenses,
    tickets,
    totalFees,
    compsTowardGross,
  } = ctx;

  if (deal.percentage == null) {
    return {
      supported: false,
      reason: `${FRIENDLY_NAME[deal.dealType]} deal is missing a percentage.`,
      dealType: deal.dealType,
      blockedReason: "missing_data",
    };
  }
  if (includeGuaranteeFloor && deal.guaranteeAmount == null) {
    return {
      supported: false,
      reason: "Vs deal is missing a guarantee amount.",
      dealType: deal.dealType,
      blockedReason: "missing_data",
    };
  }

  const expenseCap = deal.expenseCap ?? Infinity;
  const steps: SettlementStep[] = [];

  steps.push({ label: "Gross box office", value: grossBoxOffice, sourceClause: "gross" });

  if (compsTowardGross > 0) {
    steps.push({
      label: "+ Comps counting toward gross",
      value: compsTowardGross,
      note: "Press / sponsor / promo comps the deal counts at face value.",
      sourceClause: "gross",
    });
  }

  // Subtract ticket platform fees (CC fees, Eventbrite/etc.).
  // Industry standard: "net after expenses" means net of fees AND expenses.
  // The venue never actually saw fee revenue, so it can't be split with the artist.
  const grossPlusComps = grossBoxOffice + compsTowardGross;
  const grossAfterFees = grossPlusComps - totalFees;
  if (totalFees > 0) {
    steps.push({
      label: "− Ticket platform fees",
      value: -totalFees,
      note: "Fees the ticket platform takes — deducted before net.",
      sourceClause: "fees",
    });
  }

  const outsideRecoups = recoups.filter(
    (r) => r.againstWhat === "outside_expense_cap" || r.againstWhat === "gross",
  );
  const insideRecoups = recoups.filter((r) => r.againstWhat === "inside_expense_cap");

  let grossAfterRecoups = grossAfterFees;
  for (const r of outsideRecoups) {
    grossAfterRecoups -= r.amount;
    steps.push({
      label: `− ${r.label}`,
      value: -r.amount,
      note: `Deducted from gross before the expense cap.`,
      sourceClause: `recoup:${r.id}`,
    });
  }

  const insideRecoupTotal = insideRecoups.reduce((s, r) => s + r.amount, 0);
  const combinedDeductions = Math.min(totalExpenses + insideRecoupTotal, expenseCap);

  for (const r of insideRecoups) {
    steps.push({
      label: `− ${r.label}`,
      value: -r.amount,
      note: `Counts inside the $${expenseCap.toLocaleString()} expense cap.`,
      sourceClause: `recoup:${r.id}`,
    });
  }

  const expensePortion = combinedDeductions - insideRecoupTotal;
  steps.push({
    label: insideRecoups.length > 0 ? "− Other expenses (capped)" : "− Expenses (capped)",
    value: -expensePortion,
    note:
      totalExpenses + insideRecoupTotal > expenseCap
        ? `Actuals + inside-cap recoups ($${(totalExpenses + insideRecoupTotal).toFixed(0)}) exceed cap. Cap applies.`
        : "Within cap.",
    sourceClause: "expense_cap",
  });

  const netAfterAll = grossAfterRecoups - combinedDeductions;
  steps.push({
    label: "Net after deductions",
    value: netAfterAll,
    note: "Base for the percentage split",
    sourceClause: "gross",
  });

  const percentage = deal.percentage;
  const percentagePayout = netAfterAll * percentage;
  steps.push({
    label: `× ${(percentage * 100).toFixed(0)}% (artist share)`,
    value: percentagePayout,
    sourceClause: "percentage",
    formula: `${netAfterAll.toFixed(2)} × ${percentage}`,
  });

  let baseToArtist = percentagePayout;
  if (includeGuaranteeFloor && deal.guaranteeAmount != null) {
    if (deal.guaranteeAmount > percentagePayout) {
      baseToArtist = deal.guaranteeAmount;
      steps.push({
        label: "Guarantee floor wins",
        value: deal.guaranteeAmount,
        note: `Percentage payout ($${percentagePayout.toFixed(2)}) < guarantee ($${deal.guaranteeAmount.toFixed(2)})`,
        sourceClause: "guarantee",
      });
    } else {
      steps.push({
        label: "Percentage beats guarantee",
        value: percentagePayout,
        note: `Percentage payout ($${percentagePayout.toFixed(2)}) ≥ guarantee ($${deal.guaranteeAmount.toFixed(2)})`,
        sourceClause: "guarantee",
      });
    }
  }

  const bonusResult = applyBonuses(parseBonuses(deal), {
    gross: grossPlusComps,
    tickets,
    capacity: venueCapacity,
  });
  for (const b of bonusResult.applied) {
    steps.push({
      label: `+ ${b.label}`,
      value: b.amount,
      note: b.reason,
      sourceClause: `bonus:${b.label}`,
    });
  }

  const totalToArtist = baseToArtist + bonusResult.totalApplied;

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice: grossPlusComps - totalFees,
    totalExpenses,
    totalToArtist,
    steps,
    finalFormula: includeGuaranteeFloor
      ? `max(guarantee, % × net) + bonuses = ${totalToArtist.toFixed(2)}`
      : `% × net + bonuses = ${totalToArtist.toFixed(2)}`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
  };
}

// =====================================================================
// Door deal
// =====================================================================
function calculateDoorDeal(
  input: CalcInput,
  ctx: {
    grossBoxOffice: number;
    totalExpenses: number;
    tickets: number;
    totalFees: number;
    compsTowardGross: number;
  },
): SettlementCalculation {
  const { deal, venueCapacity } = input;
  const { grossBoxOffice, totalExpenses, tickets, totalFees, compsTowardGross } = ctx;

  const expenseCap = deal.expenseCap ?? Infinity;
  const expenseDeduction = Math.min(totalExpenses, expenseCap);
  const grossPlusComps = grossBoxOffice + compsTowardGross;
  const grossAfterFees = grossPlusComps - totalFees;
  const baseToArtist = grossAfterFees - expenseDeduction;

  const steps: SettlementStep[] = [
    { label: "Gross box office", value: grossBoxOffice, sourceClause: "gross" },
  ];

  if (compsTowardGross > 0) {
    steps.push({
      label: "+ Comps counting toward gross",
      value: compsTowardGross,
      note: "Press / sponsor / promo comps the deal counts at face value.",
      sourceClause: "gross",
    });
  }

  if (totalFees > 0) {
    steps.push({
      label: "− Ticket platform fees",
      value: -totalFees,
      note: "Fees the ticket platform takes — deducted before the artist split.",
      sourceClause: "fees",
    });
  }

  steps.push({
    label: "− Expenses (capped)",
    value: -expenseDeduction,
    note:
      totalExpenses > expenseCap
        ? `Actuals ($${totalExpenses.toFixed(0)}) exceed cap. Cap applies.`
        : "Within cap.",
    sourceClause: "expense_cap",
  });

  const bonusResult = applyBonuses(parseBonuses(deal), {
    gross: grossPlusComps,
    tickets,
    capacity: venueCapacity,
  });
  for (const b of bonusResult.applied) {
    steps.push({
      label: `+ ${b.label}`,
      value: b.amount,
      note: b.reason,
      sourceClause: `bonus:${b.label}`,
    });
  }

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice: grossPlusComps - totalFees,
    totalExpenses,
    totalToArtist: baseToArtist + bonusResult.totalApplied,
    steps,
    finalFormula: `gross − fees − capped_expenses${bonusResult.applied.length ? " + bonuses" : ""} = ${(baseToArtist + bonusResult.totalApplied).toFixed(2)}`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
  };
}

// =====================================================================
// Bonus evaluator (unchanged from original)
// =====================================================================
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      (ctx.gross >= b.threshold ? applied : notTriggered).push({
        label: b.label,
        amount: b.amount,
        reason: `Gross ${ctx.gross.toLocaleString()} ${ctx.gross >= b.threshold ? "≥" : "<"} ${b.threshold.toLocaleString()}`,
      });
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
              : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      (ctx.tickets >= b.threshold ? applied : notTriggered).push({
        label: b.label,
        amount: b.amount,
        reason: `${ctx.tickets} ${ctx.tickets >= b.threshold ? "≥" : "<"} ${b.threshold}`,
      });
    } else if (b.type === "tier_ratchet") {
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchets need explicit modeling — not yet handled",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}