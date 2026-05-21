// lib/dealParser.ts
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

// ============================================================
// Types — the structured representation of a deal.
// ============================================================

export type DealType =
  | "flat"
  | "vs"
  | "percentage_of_gross"
  | "percentage_of_net"
  | "door";

export type Recoup = {
  id: string;
  category:
    | "marketing"
    | "production"
    | "hospitality_overage"
    | "prior_advance"
    | "damages"
    | "other";
  label: string;
  amount: number;
  /**
   * Where the recoup gets applied in the math.
   *  - "gross": deducted from gross before percentage is applied
   *  - "inside_expense_cap": counts toward the expense cap
   *  - "outside_expense_cap": in addition to the expense cap
   *  - "unknown": the prose was ambiguous; an AmbiguityFlag should be attached
   */
  againstWhat:
    | "gross"
    | "inside_expense_cap"
    | "outside_expense_cap"
    | "unknown";
};

export type Bonus =
  | {
      id: string;
      type: "gross_threshold";
      label: string;
      threshold: number;
      amount: number;
    }
  | {
      id: string;
      type: "attendance_threshold";
      label: string;
      threshold: number;
      amount: number;
    }
  | { id: string; type: "sellout"; label: string; amount: number };

export type AmbiguityFlag = {
  id: string;
  /** A short verbatim-ish quote of the clause in the original prose */
  clauseRef: string;
  severity: "high" | "medium" | "low";
  description: string;
  plausibleReadings: Array<{
    id: string;
    summary: string;
    /** Which side this reading favors, and roughly by how much */
    impact: string;
  }>;
  /** Pre-drafted clarification text the booker can send the agent */
  suggestedClarification: string;
  /** Set after the booker resolves with the agent */
  resolved?: {
    readingId: string;
    resolvedAt: number;
    source: "agent_email" | "manual_override";
    note?: string;
  };
};

export type ParsedDeal = {
  dealType: DealType;
  guarantee?: { amount: number };
  percentage?: { value: number; basis: "gross" | "net" };
  expenseCap?: { amount: number; includes: string[] };
  hospitalityCap?: { amount: number };
  recoups: Recoup[];
  bonuses: Bonus[];
  walkout?: {
    breakevenAt: "guarantee_plus_expenses" | "amount";
    amount?: number;
    artistPercentage: number;
  };
  ratchet?: {
    basis: "capacity_percent" | "tickets_sold" | "gross";
    tiers: Array<{ from: number; to: number | null; percentage: number }>;
  };
  ambiguities: AmbiguityFlag[];
  // Metadata
  sourceText: string;
  modelVersion: string;
  parsedAt: number;
};

// ============================================================
// The prompt — the heart of the product.
// ============================================================

const SYSTEM_PROMPT = `You extract structured deal terms from prose deal notes for music venue settlements, AND you flag ambiguous clauses that could be interpreted in multiple ways.

OUTPUT: Respond with a single JSON object matching the ParsedDeal schema. No prose before or after. No markdown fences. Just the JSON.

DEAL STRUCTURE TO EXTRACT:
- dealType: one of "flat", "vs", "percentage_of_gross", "percentage_of_net", "door"
- guarantee: { amount: number } when a fixed dollar guarantee is named
- percentage: { value: number (decimal 0-1, not percent), basis: "gross" | "net" }
- expenseCap: { amount: number, includes: string[] } — categories the cap covers. Only include categories EXPLICITLY named in the prose. Leave [] otherwise.
- hospitalityCap: { amount: number } when present
- recoups: [{ id, category, label, amount, againstWhat }] — venue costs that come off the top before artist payment
- bonuses: [{ id, type, threshold?, amount, label }]
- walkout: { breakevenAt, amount?, artistPercentage } | null — for walkout-pot deals
- ratchet: { basis, tiers: [{ from, to, percentage }] } | null — for escalator deals
- ambiguities: AmbiguityFlag[]

AMBIGUITY DETECTION (this is the most important part):
Flag every clause where TWO reasonable interpretations exist. Common patterns:

1) Recoup placement. "Marketing recoup of $X against gross" can mean (a) deducted from gross BEFORE percentage applied, OR (b) counted INSIDE the expense cap. The phrase "against gross" is doing double duty. ALWAYS flag this — it's the most common dispute source.

2) Expense basis. "80% of net after expenses" can mean "after the CAPPED expenses (artist gets the bigger number when actuals exceed cap)" vs "after the ACTUAL expenses". Flag if the deal doesn't make this explicit.

3) Sellout. "If sold out" — does this mean 100% of capacity or the industry-standard 95%? Flag if unspecified.

4) Comp counting. "Net of comps" or "before comps" — which comp categories? Flag if it doesn't specify.

5) Walkout breakeven. "After breakeven" — breakeven on guarantee alone, or guarantee plus expenses? Flag if not specified.

Each AmbiguityFlag needs:
- description: 1-2 sentences explaining what's unclear
- plausibleReadings: 2+ readings with id, summary (one sentence), impact (which side it favors and roughly how much in dollars when possible)
- suggestedClarification: a 1-2 sentence question the booker could send the agent to resolve

When in doubt about ambiguity, FLAG IT. False positives are cheap; false negatives cost the venue real money.

EXAMPLE OUTPUT (for a Vs deal with a marketing recoup):
{
  "dealType": "vs",
  "guarantee": { "amount": 5000 },
  "percentage": { "value": 0.80, "basis": "net" },
  "expenseCap": { "amount": 2500, "includes": [] },
  "hospitalityCap": { "amount": 500 },
  "recoups": [
    { "id": "r1", "category": "marketing", "label": "Marketing recoup", "amount": 900, "againstWhat": "unknown" }
  ],
  "bonuses": [
    { "id": "b1", "type": "gross_threshold", "label": "$1,000 bonus over $25k gross", "threshold": 25000, "amount": 1000 }
  ],
  "ambiguities": [
    {
      "id": "amb1",
      "clauseRef": "Marketing recoup of $900 against gross",
      "severity": "high",
      "description": "The phrase 'against gross' could mean (a) the $900 is deducted from gross BEFORE the 80% is applied, or (b) the $900 counts inside the $2,500 expense cap. These produce different artist payouts.",
      "plausibleReadings": [
        { "id": "p1", "summary": "Recoup is separate from expense cap, deducted from gross before percentage applied", "impact": "Venue-favorable. Artist gets ~$720 less on a typical Coastal-Spell-sized gross." },
        { "id": "p2", "summary": "Recoup is part of the $2,500 expense cap", "impact": "Artist-favorable. Cap acts as ceiling on all venue charges including marketing." }
      ],
      "suggestedClarification": "To confirm before show day: is the $900 marketing recoup deducted from gross before we apply 80%, or does it count inside the $2,500 expense cap?"
    }
  ]
}`;

// ============================================================
// The parser function.
// ============================================================

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local at the repo root.",
    );
  }
  return new Anthropic({ apiKey });
}

export async function parseDeal(dealText: string): Promise<ParsedDeal> {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Parse this deal:\n\n${dealText}` }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model did not return a text response.");
  }

  // Be defensive: strip markdown fences if the model adds them despite instructions
  let json = textBlock.text.trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: Omit<ParsedDeal, "sourceText" | "modelVersion" | "parsedAt">;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      `Model returned invalid JSON. Raw output:\n${textBlock.text}`,
    );
  }

  return {
    ...parsed,
    sourceText: dealText,
    modelVersion: MODEL,
    parsedAt: Date.now(),
  };
}