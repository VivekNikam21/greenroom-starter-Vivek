"use client";

import { useState, useTransition } from "react";
import {
  parseDealAction,
  resolveAmbiguityAction,
} from "./actions";
import type { ParsedDeal, AmbiguityFlag } from "@/lib/dealParser";
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
  Mail,
  Copy,
  X,
} from "lucide-react";
import { formatMoney } from "@/lib/format";

interface DealInterpretationProps {
  showId: string;
  dealText: string | null;
  initialParsed: ParsedDeal | null;
  agentName?: string | null;
  agentEmail?: string | null;
  artistName?: string | null;
  showDate?: string | null;
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

// ====================================================================
// Email composition helper
// ====================================================================
function composeClarificationEmail(
  amb: AmbiguityFlag,
  ctx: { agentName?: string | null; artistName?: string | null; showDate?: string | null },
) {
  const greeting = ctx.agentName ? `Hi ${ctx.agentName.split(" ")[0]},` : "Hi,";
  const showRef = [ctx.artistName, ctx.showDate].filter(Boolean).join(" · ");

  const subject = `Clarifying the ${ctx.artistName ?? "show"} deal — ${amb.clauseRef.slice(0, 50)}${amb.clauseRef.length > 50 ? "…" : ""}`;

  const body = `${greeting}

Before we settle ${showRef ? showRef + ", " : ""}I want to make sure we read the deal the same way.

You wrote: "${amb.clauseRef}"

${amb.suggestedClarification}

For clarity, the two readings I'm weighing are:
  Reading 1: ${amb.plausibleReadings[0]?.summary ?? ""}
  Reading 2: ${amb.plausibleReadings[1]?.summary ?? ""}

A quick "Reading 1" or "Reading 2" reply works — I'll mark it in our records so we're aligned at the table on show night.

Thanks,
Mariana
The Crescent`;

  return { subject, body };
}

// ====================================================================
// Email modal (inline, no dependency)
// ====================================================================
function ClarificationModal({
  onClose,
  to,
  subject: initialSubject,
  body: initialBody,
}: {
  onClose: () => void;
  to: string;
  subject: string;
  body: string;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [copied, setCopied] = useState(false);

  const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: select the textarea
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 className="font-medium text-lg">Draft clarification email</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Edit before sending. We won&apos;t actually send this — copy or open in your mail app.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              To
            </label>
            <div className="mt-1 text-sm font-mono bg-slate-50 rounded px-3 py-2 border border-slate-200">
              {to || <span className="text-slate-400">— no agent email on file —</span>}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full text-sm bg-white rounded px-3 py-2 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="mt-1 w-full text-sm font-sans bg-white rounded px-3 py-2 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 leading-relaxed"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t bg-slate-50 rounded-b-xl">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={handleCopy} className="gap-2">
            <Copy className="h-4 w-4" />
            {copied ? "Copied!" : "Copy"}
          </Button>
          <a href={mailto}>
            <Button variant="brand" className="gap-2">
              <Mail className="h-4 w-4" />
              Open in mail
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Ambiguity card (one per flagged ambiguity)
// ====================================================================
function AmbiguityCard({
  ambiguity,
  onResolve,
  onDraftEmail,
  isResolvingId,
}: {
  ambiguity: AmbiguityFlag;
  onResolve: (ambiguityId: string, readingId: string) => void;
  onDraftEmail: (ambiguity: AmbiguityFlag) => void;
  isResolvingId: string | null;
}) {
  // Resolved state: green tinted card, show only the chosen reading
  if (ambiguity.resolved) {
    const chosen = ambiguity.plausibleReadings.find(
      (r) => r.id === ambiguity.resolved!.readingId,
    );
    const resolvedAt = new Date(ambiguity.resolved.resolvedAt);
    return (
      <div className="rounded-lg border p-4 border-emerald-200 bg-emerald-50">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 mt-0.5 text-emerald-600" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded border text-emerald-700 bg-emerald-100 border-emerald-200">
                resolved
              </span>
              <span className="text-sm font-medium italic">
                &ldquo;{ambiguity.clauseRef}&rdquo;
              </span>
            </div>
            <div className="text-sm bg-white/60 rounded border border-emerald-200 px-3 py-2">
              <div className="font-medium text-slate-800">
                {chosen?.summary ?? "—"}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Resolved {resolvedAt.toLocaleDateString()} · {ambiguity.resolved.source.replace(/_/g, " ")}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Unresolved state
  const s = severityStyles[ambiguity.severity];
  return (
    <div className={`rounded-lg border p-4 ${s.container}`}>
      <div className="flex items-start gap-3">
        {ambiguity.severity === "high" ? (
          <AlertTriangle className={`h-5 w-5 mt-0.5 ${s.icon}`} />
        ) : (
          <Info className={`h-5 w-5 mt-0.5 ${s.icon}`} />
        )}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded border ${s.pill}`}>
              {ambiguity.severity}
            </span>
            <span className="text-sm font-medium italic">
              &ldquo;{ambiguity.clauseRef}&rdquo;
            </span>
          </div>
          <p className="text-sm text-slate-700">{ambiguity.description}</p>

          <div className="space-y-1.5 mt-2">
            {ambiguity.plausibleReadings.map((p, i) => {
              const resolving =
                isResolvingId === `${ambiguity.id}:${p.id}`;
              return (
                <div
                  key={p.id}
                  className="text-sm bg-white/60 rounded border border-slate-200 px-3 py-2 flex items-start justify-between gap-3"
                >
                  <div className="flex-1">
                    <div className="font-medium text-slate-800">
                      Reading {i + 1}: {p.summary}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {p.impact}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onResolve(ambiguity.id, p.id)}
                    disabled={resolving}
                    className="shrink-0"
                  >
                    {resolving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Use this"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDraftEmail(ambiguity)}
              className="gap-1.5 text-slate-700"
            >
              <Mail className="h-3.5 w-3.5" />
              Draft clarification email
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Main component
// ====================================================================
export function DealInterpretation({
  showId,
  dealText,
  initialParsed,
  agentName,
  agentEmail,
  artistName,
  showDate,
}: DealInterpretationProps) {
  const [parsed, setParsed] = useState<ParsedDeal | null>(initialParsed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [modalAmb, setModalAmb] = useState<AmbiguityFlag | null>(null);

  const handleParse = () => {
    if (!dealText) return;
    setError(null);
    startTransition(async () => {
      const result = await parseDealAction(showId, dealText);
      if (result.ok) setParsed(result.parsed);
      else setError(result.error);
    });
  };

  const handleResolve = (ambiguityId: string, readingId: string) => {
    setResolvingId(`${ambiguityId}:${readingId}`);
    startTransition(async () => {
      const result = await resolveAmbiguityAction(showId, ambiguityId, readingId);
      if (result.ok) setParsed(result.parsed);
      else setError(result.error);
      setResolvingId(null);
    });
  };

  const handleDraftEmail = (amb: AmbiguityFlag) => {
    setModalAmb(amb);
  };

  // Compose email content (only when modal is open)
  const emailContent = modalAmb
    ? composeClarificationEmail(modalAmb, { agentName, artistName, showDate })
    : null;

  // -----------------------------------------------------------------
  // Empty state
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
            <Button onClick={handleParse} disabled={!dealText || isPending} className="gap-2">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading the deal email…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Parse deal terms
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
  // Parsed state
  // -----------------------------------------------------------------
  const ambs = parsed.ambiguities ?? [];
  const unresolved = ambs.filter((a) => !a.resolved);
  const resolved = ambs.filter((a) => a.resolved);
  const hasHigh = unresolved.some((a) => a.severity === "high");

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Deal interpretation</CardTitle>
              <CardDescription>
                Structured representation of the prose, with any ambiguous clauses flagged.
              </CardDescription>
            </div>
            {unresolved.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {resolved.length > 0 ? "All ambiguities resolved" : "No ambiguities"}
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
                {unresolved.length} unresolved
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
              value={parsed.guarantee ? formatMoney(parsed.guarantee.amount) : "—"}
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
              value={parsed.expenseCap ? formatMoney(parsed.expenseCap.amount) : "—"}
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
                  <li key={r.id} className="text-sm flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{r.label}</span>
                    <span>{formatMoney(r.amount)}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        r.againstWhat === "unknown"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-emerald-100 text-emerald-700"
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

          {/* Unresolved ambiguities */}
          {/* Unresolved ambiguities */}
          {unresolved.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Ambiguities to resolve
              </div>
              {unresolved.some((a) => a.severity === "high") ? (
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-3">
                  Settlement is blocked until high-severity ambiguities are resolved. Pick a reading or send a clarification email to the agent.
                </p>
              ) : (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2 mb-3">
                  These won&apos;t block settlement, but resolving them now prevents Monday-morning questions from the agent.
                </p>
              )}
              <div className="space-y-3">
                {unresolved.map((a) => (
                  <AmbiguityCard
                    key={a.id}
                    ambiguity={a}
                    onResolve={handleResolve}
                    onDraftEmail={handleDraftEmail}
                    isResolvingId={resolvingId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Resolved ambiguities */}
          {resolved.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Resolved
              </div>
              <div className="space-y-3">
                {resolved.map((a) => (
                  <AmbiguityCard
                    key={a.id}
                    ambiguity={a}
                    onResolve={handleResolve}
                    onDraftEmail={handleDraftEmail}
                    isResolvingId={resolvingId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Re-parse */}
          <div className="pt-2 border-t border-slate-100">
            <Button variant="ghost" size="sm" onClick={handleParse} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Re-parsing…
                </>
              ) : (
                <>Re-parse deal</>
              )}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Email modal — only mount when open so useState re-initializes per draft */}
      {modalAmb && emailContent && (
        <ClarificationModal
          onClose={() => setModalAmb(null)}
          to={agentEmail ?? ""}
          subject={emailContent.subject}
          body={emailContent.body}
        />
      )}
    </>
  );
}