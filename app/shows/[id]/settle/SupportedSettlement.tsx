"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { Check, X, AlertCircle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { calculateSettlement } from "@/lib/dealMath";

type LineState = "pending" | "agreed" | "disputed";

type Calc = Extract<
  ReturnType<typeof calculateSettlement>,
  { supported: true }
>;

interface ExistingSettlementSummary {
  status?: string | null;
  totalToArtist?: number | null;
}

interface Props {
  calc: Calc;
  existingSettlement: ExistingSettlementSummary | null;
}

export function SupportedSettlement({ calc, existingSettlement }: Props) {
  // Per-line sign-off state, keyed by step index.
  // In v2 this gets persisted to a `settlement_line_signoffs` table or a JSON
  // column on settlements. For the prototype, client state demonstrates the UX.
  const [lineStates, setLineStates] = useState<Record<number, LineState>>({});

  const setState = (index: number, target: LineState) => {
    setLineStates((prev) => ({
      ...prev,
      // Clicking the same state again unsets it (back to pending).
      [index]: prev[index] === target ? "pending" : target,
    }));
  };

  const agreedCount = Object.values(lineStates).filter(
    (s) => s === "agreed",
  ).length;
  const disputedCount = Object.values(lineStates).filter(
    (s) => s === "disputed",
  ).length;
  const totalLines = calc.steps.length;
  const pendingCount = totalLines - agreedCount - disputedCount;
  const allAgreed = agreedCount === totalLines && disputedCount === 0;
  const anyDisputed = disputedCount > 0;

  return (
    <>
      {/* Hero number */}
      <div className="text-center py-10 mb-2">
        <div className="eyebrow text-[10px] text-ink-400 mb-3">
          Total to artist
        </div>
        <div
          className="text-[72px] font-mono tabular font-bold text-ink-900 leading-none"
          style={{ letterSpacing: "-0.03em" }}
        >
          {formatMoney(calc.totalToArtist)}
        </div>
        {existingSettlement && (
          <div className="mt-3">
            {existingSettlement.status === "paid" ? (
              <PlainBadge variant="brand">Paid</PlainBadge>
            ) : existingSettlement.status === "signed" ||
              existingSettlement.status === "finalized" ? (
              <PlainBadge variant="brand">Signed</PlainBadge>
            ) : existingSettlement.status === "disputed" ? (
              <PlainBadge variant="rose">Disputed</PlainBadge>
            ) : null}
          </div>
        )}
        {existingSettlement?.totalToArtist != null &&
          existingSettlement.totalToArtist !== calc.totalToArtist && (
            <div className="text-[12px] text-ink-400 mt-2">
              Originally settled at{" "}
              <span className="font-mono tabular text-ink-600">
                {formatMoney(existingSettlement.totalToArtist)}
              </span>
            </div>
          )}
      </div>

      {/* Worksheet with per-line sign-off */}
      <Card accent="brand">
        <CardHeader>
          <div>
            <CardTitle>Settlement worksheet</CardTitle>
            <CardDescription className="font-mono">
              {calc.finalFormula}
            </CardDescription>
          </div>
          <div className="text-[11px] text-ink-500">
            {agreedCount > 0 || disputedCount > 0 ? (
              <span>
                <span className="text-emerald-700 font-medium">
                  {agreedCount} agreed
                </span>
                {disputedCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-rose-700 font-medium">
                      {disputedCount} disputed
                    </span>
                  </>
                )}
                {pendingCount > 0 && (
                  <>
                    {" · "}
                    {pendingCount} pending
                  </>
                )}
              </span>
            ) : (
              <span>{totalLines} lines · sign off on each below</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-ink-100/80">
          <SummaryRow
            label="Gross box office"
            value={formatMoney(calc.grossBoxOffice)}
          />
          <SummaryRow
            label="Net box office"
            value={formatMoney(calc.netBoxOffice)}
          />
          <SummaryRow
            label="Total expenses (passed through)"
            value={formatMoney(calc.totalExpenses)}
          />
          <div className="pt-3" />
          {calc.steps.map((step, i) => (
            <SignoffRow
              key={i}
              label={step.label}
              value={formatMoney(step.value)}
              note={step.note}
              sourceClause={step.sourceClause}
              state={lineStates[i] ?? "pending"}
              onAgree={() => setState(i, "agreed")}
              onDispute={() => setState(i, "disputed")}
            />
          ))}
          <div className="pt-3" />
          <div className="flex items-baseline justify-between py-3 font-semibold">
            <span className="text-[13px] text-ink-900">Total to artist</span>
            <span className="text-[18px] font-mono tabular text-ink-900">
              {formatMoney(calc.totalToArtist)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Readiness banner */}
      {anyDisputed && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-5 flex gap-3">
          <AlertCircle className="h-4 w-4 text-rose-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-rose-800">
              {disputedCount} line item{disputedCount === 1 ? "" : "s"} disputed
            </div>
            <p className="text-[12.5px] text-ink-700 mt-1 max-w-2xl leading-relaxed">
              This settlement cannot advance to{" "}
              <em className="not-italic font-mono text-[11.5px] bg-ink-100 px-1 py-0.5 rounded">
                paid
              </em>{" "}
              until every disputed line is either resolved or explicitly
              accepted. Sealing a settlement with open disputes is what
              created the historical 2am sign-off problem — fixed
              structurally here.
            </p>
          </div>
        </div>
      )}

      {allAgreed && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-5 flex gap-3">
          <Check className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-emerald-800">
              All {totalLines} lines agreed
            </div>
            <p className="text-[12.5px] text-ink-700 mt-1 max-w-2xl leading-relaxed">
              Every step of the math has been signed off individually. This is
              the structural fix to the historical &ldquo;OK. Good night.&rdquo;
              pattern. The artist team has now engaged with each line, not
              just the bottom number.
            </p>
          </div>
        </div>
      )}

      {/* Bonuses not triggered */}
      {calc.bonusesNotTriggered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bonuses not triggered</CardTitle>
            <CardDescription>
              Structured bonuses on this deal that didn&apos;t hit. Shown for
              transparency — useful when the agent asks &quot;what about that
              gross threshold bonus?&quot;
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-ink-100/80">
            {calc.bonusesNotTriggered.map((b, i) => (
              <div
                key={i}
                className="py-3 flex items-baseline justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-[13px] text-ink-600">{b.label}</div>
                  <div className="text-[11.5px] text-ink-400 mt-0.5">
                    {b.reason}
                  </div>
                </div>
                <div className="text-[12.5px] text-ink-300 font-mono tabular line-through">
                  {formatMoney(b.amount)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

// =====================================================================
// Simple row (for summary lines like Gross box office, no sign-off needed)
// =====================================================================
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <div className="text-[13px] text-ink-600">{label}</div>
      <div className="text-[13.5px] text-ink-900 font-mono tabular">
        {value}
      </div>
    </div>
  );
}

// =====================================================================
// Per-line sign-off row — the heart of Step 7
// =====================================================================
function SignoffRow({
  label,
  value,
  note,
  sourceClause,
  state,
  onAgree,
  onDispute,
}: {
  label: string;
  value: string;
  note?: string;
  sourceClause?: string;
  state: LineState;
  onAgree: () => void;
  onDispute: () => void;
}) {
  const borderClass =
    state === "agreed"
      ? "border-l-[3px] border-emerald-400 pl-3 -ml-3 bg-emerald-50/30"
      : state === "disputed"
        ? "border-l-[3px] border-rose-400 pl-3 -ml-3 bg-rose-50/30"
        : "border-l-[3px] border-transparent pl-3 -ml-3";

  return (
    <div className={`py-3 transition-colors ${borderClass}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[13px] text-ink-700">{label}</div>
            {sourceClause && (
              <span className="text-[9.5px] text-ink-400 font-mono uppercase tracking-wider bg-ink-50 px-1.5 py-0.5 rounded">
                {sourceClause}
              </span>
            )}
          </div>
          {note && (
            <div className="text-[11.5px] text-ink-400 mt-0.5 max-w-md leading-snug">
              {note}
            </div>
          )}
        </div>
        <div className="text-[13.5px] text-ink-900 font-mono tabular shrink-0">
          {value}
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={onAgree}
            className={`p-1.5 rounded transition-colors ${
              state === "agreed"
                ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300"
                : "text-ink-300 hover:bg-emerald-50 hover:text-emerald-600"
            }`}
            title={state === "agreed" ? "Click to unset" : "Agree"}
            aria-label="Agree with this line"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDispute}
            className={`p-1.5 rounded transition-colors ${
              state === "disputed"
                ? "bg-rose-100 text-rose-700 ring-1 ring-rose-300"
                : "text-ink-300 hover:bg-rose-50 hover:text-rose-600"
            }`}
            title={state === "disputed" ? "Click to unset" : "Dispute"}
            aria-label="Dispute this line"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
