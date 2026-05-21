"use client";

import { useState, useTransition } from "react";
import { parseDealAction } from "./actions";
import type { ParsedDeal } from "@/lib/dealParser";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Field,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  AlertTriangle,
  Info,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { formatMoney } from "@/lib/format";

interface DealInterpretationProps {
  showId: string;
  dealText: string | null;
  initialParsed: ParsedDeal | null;
}

const severityStyles = {
  high: {
    container: "border-rose-200 bg-rose-50",
    icon: "text-rose-600",
    pill: "text-rose-700 bg-rose-100 border-rose-200",
  },
  medium: {
    container: "border-amber-200 bg-amber-50",
    icon: "text-amber-600",
    pill: "text-amber-700 bg-amber-100 border-amber-200",
  },
  low: {
    container: "border-slate-200 bg-slate-50",
    icon: "text-slate-500",
    pill: "text-slate-600 bg-slate-100 border-slate-200",
  },
};

export function DealInterpretation({
  showId,
  dealText,
  initialParsed,
}: DealInterpretationProps) {
  const [parsed, setParsed] = useState<ParsedDeal | null>(initialParsed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleParse = () => {
    if (!dealText) return;
    setError(null);
    startTransition(async () => {
      const result = await parseDealAction(showId, dealText);
      if (result.ok) {
        setParsed(result.parsed);
      } else {
        setError(result.error);
      }
    });
  };

  // -----------------------------------------------------------------
  // Empty state — deal hasn't been parsed yet
  // -----------------------------------------------------------------
  if (!parsed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deal interpretation</CardTitle>
          <CardDescription>
            Have AI read the prose deal terms above and flag any clauses that
            could be interpreted in more than one way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-start gap-3">
            <Button
              onClick={handleParse}
              disabled={!dealText || isPending}
              className="gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading the deal email…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Parse deal terms
                </>
              )}
            </Button>
            {!dealText && (
              <p className="text-sm text-muted-foreground">
                No deal notes yet — add them above first.
              </p>
            )}
            {error && (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // -----------------------------------------------------------------
  // Parsed state — show structured fields + ambiguity flags
  // -----------------------------------------------------------------
  const ambs = parsed.ambiguities ?? [];
  const hasHigh = ambs.some((a) => a.severity === "high");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Deal interpretation</CardTitle>
            <CardDescription>
              Structured representation of the prose, with any ambiguous
              clauses flagged.
            </CardDescription>
          </div>
          {ambs.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              No ambiguities
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border ${
                hasHigh
                  ? "text-rose-700 bg-rose-50 border-rose-200"
                  : "text-amber-700 bg-amber-50 border-amber-200"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {ambs.length} flag{ambs.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Structured fields */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Deal type" mono value={parsed.dealType} />
          <Field
            label="Guarantee"
            mono
            value={
              parsed.guarantee ? formatMoney(parsed.guarantee.amount) : "—"
            }
          />
          <Field
            label="Percentage"
            mono
            value={
              parsed.percentage
                ? `${(parsed.percentage.value * 100).toFixed(0)}% of ${parsed.percentage.basis}`
                : "—"
            }
          />
          <Field
            label="Expense cap"
            mono
            value={
              parsed.expenseCap ? formatMoney(parsed.expenseCap.amount) : "—"
            }
          />
        </div>

        {/* Recoups */}
        {parsed.recoups.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Recoups
            </div>
            <ul className="space-y-1.5">
              {parsed.recoups.map((r) => (
                <li key={r.id} className="text-sm flex items-center gap-2">
                  <span className="font-medium">{r.label}</span>
                  <span>{formatMoney(r.amount)}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.againstWhat === "unknown"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {r.againstWhat === "unknown"
                      ? "placement unresolved"
                      : r.againstWhat.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bonuses */}
        {parsed.bonuses.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Bonuses
            </div>
            <ul className="space-y-1 text-sm">
              {parsed.bonuses.map((b) => (
                <li key={b.id}>{b.label}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Ambiguity flags */}
        {ambs.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Ambiguities to resolve
            </div>
            <div className="space-y-3">
              {ambs.map((a) => {
                const s = severityStyles[a.severity];
                return (
                  <div
                    key={a.id}
                    className={`rounded-lg border p-4 ${s.container}`}
                  >
                    <div className="flex items-start gap-3">
                      {a.severity === "high" ? (
                        <AlertTriangle
                          className={`h-5 w-5 mt-0.5 ${s.icon}`}
                        />
                      ) : (
                        <Info className={`h-5 w-5 mt-0.5 ${s.icon}`} />
                      )}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded border ${s.pill}`}
                          >
                            {a.severity}
                          </span>
                          <span className="text-sm font-medium italic">
                            &ldquo;{a.clauseRef}&rdquo;
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">
                          {a.description}
                        </p>
                        <div className="space-y-1.5 mt-2">
                          {a.plausibleReadings.map((p, i) => (
                            <div
                              key={p.id}
                              className="text-sm bg-white/60 rounded border border-slate-200 px-3 py-2"
                            >
                              <div className="font-medium text-slate-800">
                                Reading {i + 1}: {p.summary}
                              </div>
                              <div className="text-xs text-slate-600 mt-0.5">
                                {p.impact}
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* The "Draft clarification" button comes in Step 4 */}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Re-parse button — small, secondary */}
        <div className="pt-2 border-t border-slate-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleParse}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Re-parsing…
              </>
            ) : (
              <>Re-parse deal</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}