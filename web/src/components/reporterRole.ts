import type { FieldPersonaType } from "@insite/shared";

/** Short labels for who reported a piece of field evidence. */
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
