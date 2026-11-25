import React from "react";
import { AlertTriangle, Camera, Flag, Mic, MessageSquare, Star } from "lucide-react";
import {
  FACILITY_ARCHETYPE_META,
  FORM_SIGNAL_LABELS,
  VISIT_KIND_META,
  type FormCondition,
  type VisitFormAssemblyWarning,
  type VisitFormSnapshot,
  type VisitFormSnapshotField,
} from "@insite/shared";

/**
 * Redesign R3: read-only rendering of a frozen visit form (or a preview). Shows each block with its
 * units, each question with a disabled control for its type, photo slots and the rules that apply.
 * Reused by R4's visit pages.
 */

export function conditionText(when: FormCondition, field?: Pick<VisitFormSnapshotField, "options">): string {
  const label = (v: string) => field?.options.find((o) => o.key === v)?.label ?? (v === "YES" ? "Yes" : v === "NO" ? "No" : v === "NA" ? "N/A" : v);
  if ("equals" in when) return `is ${label(when.equals)}`;
  if ("anyOf" in when) return `is ${when.anyOf.map(label).join(" or ")}`;
  if ("atMost" in when) return `≤ ${when.atMost}`;
  return when.atLeast === "PLANNED" ? "≥ planned quantity" : `≥ ${when.atLeast}`;
}

const ACTION_TEXT = { REQUIRE_PHOTO: "photo", REQUIRE_COMMENT: "comment", RAISE_FINDING: "finding" } as const;

function FieldControl({ f }: { f: VisitFormSnapshotField }) {
  const box = "rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-400";
  switch (f.type) {
    case "YES_NO":
      return (
        <div className="flex gap-1.5">
          {["Yes", "No", ...(f.allowNa ? ["N/A"] : [])].map((o) => (
            <span key={o} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] text-slate-600">
              {o}
            </span>
          ))}
        </div>
      );
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
      return (
        <div className="flex flex-wrap gap-1.5">
          {f.options.map((o) => (
            <span key={o.key} className={`border border-slate-300 px-2.5 py-0.5 text-[11px] text-slate-600 ${f.type === "SINGLE_CHOICE" ? "rounded-full" : "rounded"}`}>
              {o.label}
            </span>
          ))}
        </div>
      );
    case "RATING_1_5":
      return (
        <div className="flex gap-0.5 text-slate-300">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className="w-4 h-4" />
          ))}
        </div>
      );
    case "PHOTO": {
      const p = f.photo!;
      if (p.slots.length > 0) {
        return (
          <div className="flex flex-wrap gap-2">
            {p.slots.map((s) => (
              <div key={s.unitId} className="w-28 rounded-lg border border-dashed border-slate-300 p-2 text-center">
                <Camera className="w-4 h-4 mx-auto text-slate-400" />
                <p className="mt-1 text-[10px] text-slate-600 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        );
      }
      return (
        <span className={`${box} inline-flex items-center gap-1`}>
          <Camera className="w-3.5 h-3.5" /> {p.minCount > 0 ? `At least ${p.minCount}` : "Optional"}, up to {p.maxCount}
        </span>
      );
    }
    case "VOICE_NOTE":
      return (
        <span className={`${box} inline-flex items-center gap-1`}>
          <Mic className="w-3.5 h-3.5" /> Voice note (transcribed)
        </span>
      );
    case "NUMBER":
      return <span className={box}>Number{f.unit ? ` (${f.unit})` : ""}</span>;
    case "PERCENTAGE":
      return <span className={box}>0–100 %</span>;
    case "DATE":
      return <span className={box}>YYYY-MM-DD</span>;
    case "LONG_TEXT":
      return <span className={`${box} block h-10`}>Long answer</span>;
    default:
      return <span className={box}>Short answer</span>;
  }
}

function FieldRow({ f }: { f: VisitFormSnapshotField }) {
  return (
    <div className="py-2.5 border-t border-slate-100 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-slate-900">
          {f.label}
          {f.required && <span className="text-rose-500"> *</span>}
        </p>
        <span className="shrink-0 font-mono text-[10px] text-slate-400">{f.path.startsWith("r:") ? "follow-up check" : f.key}</span>
      </div>
      {f.guidance && <p className="text-[11px] text-slate-500 mt-0.5">{f.guidance}</p>}
      <div className="mt-1.5">
        <FieldControl f={f} />
      </div>
      {(f.rules.length > 0 || f.signal) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {f.rules.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-800">
              {r.then === "RAISE_FINDING" ? <Flag className="w-3 h-3" /> : r.then === "REQUIRE_PHOTO" ? <Camera className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
              {conditionText(r.when, f)} → {ACTION_TEXT[r.then]}
              {r.severity ? ` (${r.severity.toLowerCase()})` : ""}
            </span>
          ))}
          {f.signal && (
            <span className="rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] text-sky-800">
              {FORM_SIGNAL_LABELS[f.signal.kind]}
              {f.signal.when ? ` when ${conditionText(f.signal.when, f)}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function FormWarnings({ warnings }: { warnings: VisitFormAssemblyWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w.message}
        </p>
      ))}
    </div>
  );
}

export function FormSnapshotView({ snapshot, showHeader = true }: { snapshot: VisitFormSnapshot; showHeader?: boolean }) {
  const fieldCount = snapshot.blocks.reduce((n, b) => n + b.fields.length, 0);
  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
          <p className="font-bold text-slate-900">
            {VISIT_KIND_META[snapshot.context.visitKind].label} · {snapshot.context.visitDate}
          </p>
          <p className="mt-0.5">
            {snapshot.context.sprint
              ? `Work phase ${snapshot.context.sprint.number}: ${snapshot.context.sprint.name} (${snapshot.context.sprint.startDate} to ${snapshot.context.sprint.endDate})`
              : "No work phase for this date"}
            {" · "}
            Template {snapshot.sources.template.code} v{snapshot.sources.template.version} · {fieldCount} questions
          </p>
          {snapshot.context.sprint?.deliverables && <p className="mt-0.5 text-slate-500">Deliverables: {snapshot.context.sprint.deliverables}</p>}
        </div>
      )}
      <FormWarnings warnings={snapshot.warnings} />
      {snapshot.blocks.map((b) => (
        <section key={b.key} className="rounded-xl border border-slate-200 bg-white">
          <header className={`px-3.5 py-2.5 rounded-t-xl ${b.kind === "FACILITY" ? "bg-brand-primary/5" : b.kind === "RECHECK" ? "bg-amber-50" : "bg-slate-50"}`}>
            <p className="text-xs font-bold text-slate-900">{b.title}</p>
            {b.facility && <p className="text-[11px] text-slate-500">{FACILITY_ARCHETYPE_META[b.facility.archetype].label}</p>}
            {b.units.length > 0 && <p className="text-[11px] text-slate-600 mt-0.5">{b.units.map((u) => u.label).join(" · ")}</p>}
            {b.kind !== "FACILITY" && b.description && <p className="text-[11px] text-slate-500 mt-0.5">{b.description}</p>}
          </header>
          <div className="px-3.5 pb-1">
            {b.fields.length === 0 ? (
              <p className="py-2.5 text-[11px] text-slate-500">No questions for this visit kind.</p>
            ) : (
              b.fields.map((f) => <FieldRow key={f.path} f={f} />)
            )}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-slate-500">Header (project, officers, check-in) and the summary (overall finding, summary text) come from the visit itself.</p>
    </div>
  );
}
