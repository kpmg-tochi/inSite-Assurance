import type { FieldPersonaType } from "@insite/shared";

/** Short label for who captured a piece of field evidence. */
export function formatReporterRoleBadge(
  roleName?: string | null,
  fieldPersonaType?: FieldPersonaType | null,
): string {
  if (!roleName && !fieldPersonaType) return "No Evidence";
  const prefix = fieldPersonaType === "INDEPENDENT_VERIFIER" ? "Independent" : "Field";
  if (roleName) {
    return `${prefix} · ${roleName}`;
  }
  return prefix;
}
