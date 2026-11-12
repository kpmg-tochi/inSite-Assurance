import type { EvidenceStrengthRating, IndependenceTier } from "@insite/shared";

export function EvidenceRatingBadge({
  rating,
}: {
  rating: EvidenceStrengthRating;
}) {
  switch (rating) {
    case "SUPPORTED":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
          Supported
        </span>
      );
    case "PARTIALLY_SUPPORTED":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
          Partially Supported
        </span>
      );
    case "UNSUPPORTED":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-800 border border-orange-200 whitespace-nowrap">
          Unsupported
        </span>
      );
    case "CONTRADICTED":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-800 border border-red-200 whitespace-nowrap">
          Contradicted
        </span>
      );
    default:
      return null;
  }
}

export function formatIndependenceTierText(
  tier?: IndependenceTier | null,
): string {
  if (!tier) return "No Evidence";
  switch (tier) {
    case "MONITOR_INSPECTOR":
      return "Tier 1 — Independent";
    case "INDEPENDENT_RESIDENT":
      return "Tier 2 — Delegated";
    case "CONTRACTOR_ENGINEER":
      return "Tier 3 — Self-Reported";
    default:
      return tier;
  }
}

export function formatIndependenceTierCode(
  tier?: IndependenceTier | null,
): string {
  if (!tier) return "None";
  switch (tier) {
    case "MONITOR_INSPECTOR":
      return "INS";
    case "INDEPENDENT_RESIDENT":
      return "COW";
    case "CONTRACTOR_ENGINEER":
      return "CON";
    default:
      return tier;
  }
}
