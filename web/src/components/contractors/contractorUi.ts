import { stateByCode, type ContractorSummaryDto } from "@insite/shared";

/** Client demo updates F.1: state names for a list of state codes ("Kano, Lagos"). */
export const stateNames = (codes: string[]) => codes.map((c) => stateByCode(c)?.name ?? c).join(", ");

/** The line under a contractor in the picker: what its status means for a new project. */
export function contractorStatusNote(c: Pick<ContractorSummaryDto, "status">): string | null {
  if (c.status === "INACTIVE") return "Contract not yet on file";
  if (c.status === "SUSPENDED") return "Suspended: cannot be named on a new project";
  return null;
}
