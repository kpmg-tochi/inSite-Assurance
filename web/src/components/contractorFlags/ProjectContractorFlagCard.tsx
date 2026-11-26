import { useState } from "react";
import { Flag, HardHat } from "lucide-react";
import type { ProjectSummaryDto } from "@insite/shared";
import { useAuth, useTerm } from "../../lib/auth-context";
import { ContractorCard } from "../contractors/ContractorCard";
import { useContractorQuery } from "../../queries/contractors";
import { useProjectContractorFlagsQuery } from "../../queries/contractorFlags";
import { FlagDecisionDrawer } from "./FlagDecisionDrawer";

/**
 * Client demo updates F.4 (wave 3): the project's contractor on the overview. Its stars (holders of
 * `contractors:view_register`; others see the name) and, when the project has an open performance
 * flag, a red "Flagged: <summary>" line with "Review" for `contractors:manage`.
 */
export function ProjectContractorFlagCard({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const term = useTerm();
  const organizationId = project.contractors[0]?.organizationId;
  const canSeeRegister = hasPermission("contractors:view_register");
  const detail = useContractorQuery(canSeeRegister ? organizationId : undefined);
  const flags = useProjectContractorFlagsQuery(project.id, Boolean(organizationId));
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  if (!organizationId) return null;

  const openFlag = flags.data?.find((f) => f.status === "OPEN" && f.organizationId === organizationId) ?? null;
  const canReview = hasPermission("contractors:manage");

  const flagLine = openFlag ? (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs font-semibold text-rose-700">
      <span className="inline-flex items-start gap-1">
        <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Flagged: {openFlag.summary}
      </span>
      {canReview && (
        <button
          type="button"
          onClick={() => setReviewingId(openFlag.id)}
          className="rounded-lg border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
        >
          Review
        </button>
      )}
    </p>
  ) : null;

  return (
    <section aria-label={term("contractor")}>
      {detail.data ? (
        <ContractorCard contractor={detail.data} note={flagLine} />
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
          <HardHat className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[11px] font-semibold text-slate-500">{term("contractor")}</div>
            <div className="font-semibold text-slate-900">{project.contractors[0]?.organizationName ?? project.contractorOrganizationName}</div>
            {flagLine}
          </div>
        </div>
      )}
      {reviewingId && <FlagDecisionDrawer flagId={reviewingId} initialFlag={openFlag ?? undefined} onClose={() => setReviewingId(null)} />}
    </section>
  );
}
