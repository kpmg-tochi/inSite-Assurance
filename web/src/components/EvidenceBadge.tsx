import {
  EVIDENCE_RATING_META,
  type EvidenceRatingColorToken,
  type EvidenceStrengthRating,
  type FieldPersonaType,
} from "@insite/shared";
import { useAuth } from "../lib/auth-context";

/**
 * Fixed colour per canonical rating (decision B: tenants change wording, never colour).
 * Classes are spelled out in full so Tailwind keeps them.
 */
const TONE_CLASSES: Record<
  EvidenceRatingColorToken,
  { badge: string; row: string; panel: string; text: string }
> = {
  emerald: {
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    row: "",
    panel: "bg-emerald-50/70 border-emerald-200",
    text: "text-emerald-800",
  },
  amber: {
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    row: "bg-amber-50/15 hover:bg-amber-50/35",
    panel: "bg-amber-50 border-amber-200",
    text: "text-amber-800",
  },
  slate: {
    badge: "bg-slate-100 text-slate-700 border-slate-300",
    row: "bg-slate-50/60 hover:bg-slate-100/60",
    panel: "bg-slate-50 border-slate-300",
    text: "text-slate-700",
  },
  rose: {
    badge: "bg-rose-50 text-rose-800 border-rose-200",
    row: "bg-rose-50/25 hover:bg-rose-50/50 border-l-4 border-l-rose-600",
    panel: "bg-rose-50 border-rose-200",
    text: "text-rose-800",
  },
};

export function ratingTone(rating: EvidenceStrengthRating) {
  return TONE_CLASSES[EVIDENCE_RATING_META[rating].colorToken];
}

/** The one evidence rating badge: canonical value in, tenant label out, description on hover. */
export function EvidenceBadge({ rating }: { rating: EvidenceStrengthRating }) {
  const { ratingLabels } = useAuth();
  const resolved = ratingLabels[rating];
  return (
    <span
      title={resolved.description}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${ratingTone(rating).badge}`}
    >
      {resolved.label}
    </span>
  );
}

export function formatReporterRoleBadge(
  roleName?: string | null,
  fieldPersonaType?: FieldPersonaType | null,
): string {
  if (!roleName && !fieldPersonaType) return "No Evidence";
  const prefix =
    fieldPersonaType === "INDEPENDENT_VERIFIER"
      ? "Independent"
      : fieldPersonaType === "CONTRACTOR_EXECUTOR"
        ? "Contractor"
        : "Field";
  if (roleName) {
    return `${prefix} · ${roleName}`;
  }
  return prefix;
}

export function formatReporterRoleShort(
  roleName?: string | null,
  fieldPersonaType?: FieldPersonaType | null,
): string {
  if (!roleName && !fieldPersonaType) return "None";
  if (roleName) return roleName;
  return fieldPersonaType === "INDEPENDENT_VERIFIER"
    ? "Independent"
    : "Contractor";
}
