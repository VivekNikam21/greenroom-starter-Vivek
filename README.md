# Soundcheck — Greenroom Case Study Submission

**Author:** Vivek Nikam
**Loom walkthrough:** [https://www.loom.com/share/b4817a4c8e3049a7bc74fcc2d43ce675](https://www.loom.com/share/b4817a4c8e3049a7bc74fcc2d43ce675)
**Product memo:** [Soundcheck — Product Memo (Notion)](https://melted-brow-a30.notion.site/Soundcheck-Product-Memo-368d61a1d80e80bfb0c0ef81ceb59e1a)
**Code:** this repo (forked from `samay-cbh/greenroom-starter`)

---

## What this is

Soundcheck is a product slice built for The Crescent — the venue persona described in the case study brief. The name comes from the venue practice itself: soundcheck is when you catch problems before the audience is in the room. The product applies the same idea to settlement disputes — catch them at the booking stage, with time to fix things, instead of at 2am after the show.

The slice is one artifact (the Settlement Statement) wired around two coupled AI surfaces:

- **Parse-and-Flag** runs at deal capture. An LLM reads the deal-notes prose, produces a structured deal representation, and flags ambiguous clauses with severity scores, plausible readings, and dollar-impact estimates.
- **Show-Your-Work Settlement** runs post-show. The engine settles Vs, % of Net, and Door deals with line-level provenance back to specific deal clauses, and the artist team signs off per-line instead of with a single text blob.

The two surfaces are coupled: the settlement engine refuses to run on a deal with unresolved high-severity ambiguities. AI lives at the inputs only. The math, the state machine, and the sign-off model are deliberately deterministic.

For the full design argument — what got cut, why, how I'd validate, and what I'd ship next — see the memo linked above.

---

## Demo paths

Three shows anchor the walkthrough. Each highlights a different aspect of the slice.

| Show | URL | What it demonstrates |
| --- | --- | --- |
| **Coastal Spell** (canonical dispute) | `/shows/show_coastal_spell_dispute` | High-severity ambiguity on a marketing recoup; clarification email auto-drafted to the *current* agent of record (Tom Neary at Wasserman, not the historical WME contact); settlement blocked until resolved; resolution propagates structurally |
| **Nevada Sundown** (walkout) | `/shows/show_0346` | Parser correctly identifies the walkout variant; engine refuses to settle ("won't settle this variant — by design"); existing sign-off on file reads "OK. Good night." — exactly the pattern the per-line sign-off mechanism replaces |
| **Blue Dial** (vanilla Vs) | `/shows/show_0185` | Clean Vs settlement with full source-clause provenance and per-line sign-off UI |

The Coastal Spell flow is the primary demo. The settled amount of **$12,284.80** matches the agent's calculation from the historical dispute thread; the original tool produced $11,565, which is where the $720 dispute came from.

---

## Where AI is, and where it deliberately isn't

| Surface | AI? |
| --- | --- |
| Prose-to-structured parsing | Yes (Claude Sonnet 4.6) |
| Ambiguity detection + clarification email drafting | Yes |
| Recoup-placement propagation on resolution | No (keyword heuristic) |
| Settlement math | No (pure functions) |
| State machine (paid requires zero open disputes) | No (rule) |
| Per-line sign-off | No (structured UX) |

Two model calls at the inputs layer; everything downstream is deterministic. The reasoning is in the memo.

---

## Run locally

The demo works with **zero API key** — all LLM responses for the demo shows are cached in `data/parsed-deals/*.json` and committed to the repo.

```bash
# 1. Install
npm install

# 2. Reset the database (deterministic seed, ~537 shows over 24 months)
npm run db:reset

# 3. Start dev server
npm run dev

# 4. Open
open http://localhost:3000/shows
```

Then click into any of the three demo shows above. Click "Parse deal terms" to invoke the parser — for the demo shows, this hits the cache and returns instantly. No API call.

If you want to parse a deal that isn't cached, set `ANTHROPIC_API_KEY` in `.env.local`. The parser uses model `claude-sonnet-4-6` and caches results to disk by hash of the deal text, so any repeat parse is free.

**Windows note:** `npm run db:reset` uses `rm -f`, which doesn't work in standard `cmd`. Use git bash, or substitute: `del data\greenroom.db && npx drizzle-kit push && npm run db:seed`.

---

## What changed in the codebase

The starter repo provided the schema, the seed, and a basic settlement engine for Flat and % of Gross deals. Everything else was built for this submission.

**New files**
- `lib/dealParser.ts` — Claude-backed parser; LLM cache integration; ambiguity detection prompt
- `lib/llmCache.ts` — disk-based cache layer keyed by hash of deal prose
- `app/shows/[id]/DealInterpretation.tsx` — client component for parser output, ambiguity cards, "Use this" resolution, clarification email modal
- `app/shows/[id]/actions.ts` — server actions: `parseDealAction` and `resolveAmbiguityAction` (with structured propagation)
- `app/shows/[id]/settle/SupportedSettlement.tsx` — client component for per-line sign-off
- `scripts/test-parse.ts`, `scripts/test-settle.ts` — development test harnesses

**Extended files**
- `lib/dealMath.ts` — added Vs / % of Net / Door deal types; introduced `sourceClause` provenance on every step; added settlement guards (`unresolved_ambiguity`, `unknown_recoup_placement`, `deal_variant_unsupported`)
- `db/schema.ts` — added `parsedDealJson` and `parsedDealHash` columns to the `deals` table
- `app/shows/[id]/page.tsx` — integrated Deal Interpretation card into the deal page layout
- `app/shows/[id]/settle/page.tsx` — three-way dispatch between `BlockedByAmbiguity`, `BlockedByDealVariant`, and `SupportedSettlement` render paths

---

## What's intentionally cut

Listed in full in the memo. Briefly:

- **Walkout pots and tier ratchets** (57 shows total): detected by the parser, refused by the engine. Walkout math has multiple competing industry conventions; refusing is safer than being subtly wrong on artist money.
- **Hospitality cap as a separate ceiling**: rolls into the general expense bucket for v0.
- **Recoups in % of Gross and Door deals**: rare in practice, deferred.
- **Persisted per-line sign-off state**: client state only. The state machine logic is real; cross-session persistence is a v2 mechanical add.
- **Agent-facing UI**: clarification email is a `mailto:` link with copy-to-clipboard.
- **Fee deductions on Flat and % of Gross paths**: the inherited engine for those deal types didn't deduct ticket platform fees. My slice extended Vs, % of Net, and Door; backfilling the legacy paths is a v2 task.

---

## Suggested reading order

For a 20-minute review:

1. **Watch the Loom** (≈9 min) — the demo end-to-end, with the design reasoning narrated.
2. **Read the memo** (≈5 min) — the full design argument, validation plan, cuts, and trade-offs. Linked at the top of this README.
3. **Clone and run the demo** (≈3 min setup) — Coastal Spell is the primary demo show.
4. **Skim the codebase** (≈3 min) — `lib/dealParser.ts` for the prompt and ambiguity types; `lib/dealMath.ts` for the engine guards and source-clause provenance.

---

## Notes on the data

The seed is deterministic (`makeRng(42)`) — every `npm run db:reset` produces identical data. Three findings from the seed shaped the product direction; they're queryable.

- **Sign-off captures consent without specificity.** 24 settlements have `status = "disputed"`. All 24 have non-empty sign-off text: 22 read as overt approval ("OK. Good night.", "👍", "Looks good — TM."), 2 read as the neutral acknowledgement "Sign off." None capture the specific objection that surfaced later. Broaden "disputed" to include settlements marked "paid" but with disputed recoup line items still open, and the count grows to 47.
- **Structured deal data drifts from prose.** 18 deals contain prose like *"Performance bonuses per the deal memo (see email thread)"* with `bonuses_json` empty. Two of those 18 are bookings for 2026 — the gap produces future shows, not just historical ones. Separately, show_0005's structured `dealType` says `percentage_of_net` but its prose describes a Vs deal with a $3,500 floor — roughly a $2,000 silent leak to the artist on that one show.
- **Ambiguity at deal signing becomes dispute at settlement.** The Coastal Spell case in the seed traces a $720 dispute back to one ambiguous phrase in the original deal email. The dispute is one of the 24.

The verification scripts in `scripts/` will reproduce these numbers against your local database.

---

## Original starter setup (preserved from the upstream repo)

The setup instructions below come from the upstream case-study starter and are preserved for completeness. If you're cloning fresh, the "Run locally" section above is the shorter happy path.

[paste original starter README content here if you want to preserve it for the upstream contributors — otherwise it can be removed since the relevant steps are above]
