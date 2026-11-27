import React, { useState } from "react";
import { Smartphone } from "lucide-react";
import { NEEDS_OPEN_PROPOSAL_STATUSES, NEEDS_VERIFICATION_OPEN_STATUSES, NEEDS_VERIFICATION_PURPOSE_LABELS, type NeedsProposalDetailDto, type NeedsVerificationDto } from "@insite/shared";
import { useAuth } from "../../../lib/auth-context";
import { useProposalVerificationsQuery } from "../../../queries/needs/useVerificationQueries";
import { cardCls, plural } from "../needsUi";
import { AssignVerificationDialog, CancelVerificationDialog } from "./VerificationDialogs";
import { VerificationReviewDrawer } from "./VerificationReviewDrawer";
import { VerificationDue, VerificationStatusTag, sitesText } from "./verificationUi";

/**
 * Needs pipeline wave 5 (N8): the "Field verification" card on the proposal's Validation tab. Lists
 * every verification of the proposed project (both purposes), newest first; the validator
 * (`needs:validate`, cycle writable, proposal at Validation) assigns one; Cancel and Review follow
 * each verification's `allowedActions`; any reader may open one to see what was found.
 */

export function FieldVerificationCard({ proposal, writable }: { proposal: NeedsProposalDetailDto; writable: boolean }) {
  const { hasPermission } = useAuth();
  const q = useProposalVerificationsQuery(proposal.id);
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState<NeedsVerificationDto | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = [...(q.data ?? [])].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  const openValidation = items.some((v) => v.purpose === "VALIDATION" && (NEEDS_VERIFICATION_OPEN_STATUSES.includes(v.status) || v.status === "SUBMITTED"));
  const canAssign = writable && hasPermission("needs:validate") && proposal.stage === "VALIDATION" && NEEDS_OPEN_PROPOSAL_STATUSES.includes(proposal.status) && proposal.sites.length > 0;

  return (
    <section className={cardCls} aria-labelledby="field-verification-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="field-verification-heading" className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Smartphone className="h-4 w-4 text-slate-500" aria-hidden="true" /> Field verification
          </h3>
          <p className="text-[11px] text-slate-500">An officer visits the sites with the field app; you review what was found here.</p>
        </div>
        {canAssign && (
          <button
            type="button"
            className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            disabled={openValidation}
            title={openValidation ? "A field verification is already open: cancel it or wait for it." : undefined}
            onClick={() => setAssigning(true)}
          >
            Assign field verification
          </button>
        )}
      </div>

      {q.isLoading ? (
        <div role="status" className="mt-2 h-12 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none">
          <span className="sr-only">Loading field verifications…</span>
        </div>
      ) : q.isError ? (
        <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
          The field verifications could not be loaded.
        </p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {canAssign ? "None yet. Assign one to have the sites checked from the field app." : "No field verification for this proposed project."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((v) => (
            <li key={v.id} className="py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <VerificationStatusTag status={v.status} label={v.statusLabel} />
                <span className="font-semibold text-slate-900">{NEEDS_VERIFICATION_PURPOSE_LABELS[v.purpose]}</span>
              </div>
              <p className="mt-0.5 text-slate-700">
                {v.officer.name} · <VerificationDue v={v} />
              </p>
              <p className="text-[11px] text-slate-500">
                {sitesText(v.sites)} · {plural(v.rowCount, "facility row")} · version {v.versionNumber}
              </p>
              <div className="mt-1 flex flex-wrap gap-3">
                <button type="button" className="font-semibold text-brand-primary hover:underline" onClick={() => setOpenId(v.id)}>
                  {v.allowedActions.includes("REVIEW") ? "Review" : "Open"}
                </button>
                {v.allowedActions.includes("CANCEL") && (
                  <button type="button" className="font-semibold text-rose-700 hover:underline" onClick={() => setCancelling(v)}>
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {assigning && (
        <AssignVerificationDialog
          proposal={{ id: proposal.id, reference: proposal.reference, title: proposal.title }}
          purpose="VALIDATION"
          sites={proposal.sites.map((s) => ({ siteNumber: s.siteNumber, schoolName: s.schoolName }))}
          onClose={() => setAssigning(false)}
        />
      )}
      {cancelling && <CancelVerificationDialog verification={cancelling} onClose={() => setCancelling(null)} />}
      {openId && <VerificationReviewDrawer verificationId={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}
