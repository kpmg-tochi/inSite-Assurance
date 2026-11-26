import React from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { useAuth } from "../../lib/auth-context";
import { formatNaira } from "../../lib/formatters";
import { useProjectApprovedListLinkQuery } from "../../queries/approvedLists";
import { BudgetCheckLine } from "./approvedListUi";

/**
 * Client demo updates E3 (wave 3): the project's approved list row and the budget-mismatch red flag
 * on the project overview. Shown only to users with `approved_lists:view` (the read itself needs only
 * project visibility). Unlinked: "Not linked to an approved list", with a link to Project details for
 * users who can edit live project settings.
 */
export function ApprovedListLinkCard({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuth();
  const canView = hasPermission("approved_lists:view");
  const query = useProjectApprovedListLinkQuery(projectId, canView);
  if (!canView || query.isLoading || query.isError) return null;
  const link = query.data ?? null;
  const canEdit = hasPermission("projects:edit_baseline");

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-labelledby={`approved-list-${projectId}`}>
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 id={`approved-list-${projectId}`} className="text-sm font-bold text-slate-900">
            Approved list
          </h2>
          {link ? (
            <>
              <p className="text-xs text-slate-700">
                <span className="font-semibold text-slate-900">{link.rowRef}</span> · {link.projectTitle}
              </p>
              <p className="text-[11px] text-slate-500">
                {link.listTitle} · approved estimate {formatNaira(link.costEstimateNgn)}
              </p>
              <BudgetCheckLine mismatch={link.mismatch} />
            </>
          ) : (
            <p className="text-xs text-slate-600">
              Not linked to an approved list.
              {canEdit && (
                <>
                  {" "}
                  <Link to={`/app/projects/${projectId}/settings/project`} className="font-semibold text-brand-primary hover:underline">
                    Link it in Project details
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
