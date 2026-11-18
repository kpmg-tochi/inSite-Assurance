import type { EvidenceStrengthRating, FieldPersonaType } from "@insite/shared";

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
