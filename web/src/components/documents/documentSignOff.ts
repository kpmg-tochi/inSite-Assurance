import type { ProjectDocumentDto } from "@insite/shared";

/**
 * Whether to offer "Sign off" on a register document: its type needs a sign-off, the current
 * version is not yet signed by the caller, the caller holds the type's sign-off permission (when
 * the type names one), the document is not archived, and the server agrees (`canSign`).
 */
export function canOfferSignOff(
  doc: Pick<ProjectDocumentDto, "canSign" | "signedByMe" | "isArchived" | "documentType">,
  hasPermission: (permissionKey: string) => boolean,
): boolean {
  const permissionKey = doc.documentType.signOffPermissionKey;
  return (
    doc.canSign &&
    doc.documentType.requiresSignOff &&
    !doc.signedByMe &&
    !doc.isArchived &&
    (!permissionKey || hasPermission(permissionKey))
  );
}
