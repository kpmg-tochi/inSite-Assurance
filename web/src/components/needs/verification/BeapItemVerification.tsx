import React, { useState } from "react";
import { NEEDS_VERIFICATION_OPEN_STATUSES, type NeedsVerificationDto } from "@insite/shared";
import { useAuth } from "../../../lib/auth-context";
import { useNeedsProposalQuery } from "../../../queries/needs/useNeedsQueries";
import { ModalShell } from "../../common/ModalShell";
import { AssignVerificationDialog, CancelVerificationDialog } from "./VerificationDialogs";
import { VerificationReviewDrawer } from "./VerificationReviewDrawer";
import { VerificationDue, VerificationStatusTag } from "./verificationUi";

/**
 * Needs pipeline wave 5 (N8): a BEAP item's site visit (purpose BEAP_REVIEW) inside UBEC's review.
 * Shows the item's latest BEAP site visit (status chip, officer, due date) with Review / Open and
 * Cancel from its `allowedActions`; a holder of `needs:review_beap` assigns one while the BEAP is in
 * review and no visit of the item is open. `verifications` are the cycle's (one request per BEAP).
 */

export function BeapItemVerification({
  item,
  verifications,
  beapInReview,
  inCell = false,
}: {
  item: { proposalId: string; reference: string; title: string };
  verifications: NeedsVerificationDto[];
  beapInReview: boolean;
  /** Inside a table cell (no divider, no heading). */
  inCell?: boolean;
}) {
  const { hasPermission } = useAuth();
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState<NeedsVerificationDto | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const mine = verifications.filter((v) => v.proposalId === item.proposalId && v.purpose === "BEAP_REVIEW").sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  const latest = mine[0] ?? null;
  const open = mine.some((v) => NEEDS_VERIFICATION_OPEN_STATUSES.includes(v.status) || v.status === "SUBMITTED");
  const canAssign = beapInReview && hasPermission("needs:review_beap") && !open;

  if (!latest && !canAssign) return inCell ? <span className="text-slate-400">–</span> : null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${inCell ? "max-w-[18rem]" : "mt-2 border-t border-slate-100 pt-2"}`}>
      {!inCell && <span className="font-semibold text-slate-700">Site visit</span>}
      {latest ? (
        <>
          <VerificationStatusTag status={latest.status} label={latest.statusLabel} />
          <span className="text-slate-600">
            {latest.officer.name} · <VerificationDue v={latest} />
          </span>
          <button type="button" className="font-semibold text-brand-primary hover:underline" onClick={() => setOpenId(latest.id)}>
            {latest.allowedActions.includes("REVIEW") ? "Review" : "Open"}
          </button>
          {latest.allowedActions.includes("CANCEL") && (
            <button type="button" className="font-semibold text-rose-700 hover:underline" onClick={() => setCancelling(latest)}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <span className="text-slate-500">None</span>
      )}
      {canAssign && (
        <button type="button" className="font-semibold text-brand-primary hover:underline" onClick={() => setAssigning(true)}>
          Assign site visit
        </button>
      )}
      {/* The dialogs are portalled, but React still bubbles their submit events through this tree:
          stop them here so the BEAP review form around this row is never submitted by them. */}
      <div className="contents" onSubmit={(e) => e.stopPropagation()}>
        {assigning && <AssignForProposal item={item} onClose={() => setAssigning(false)} />}
        {cancelling && <CancelVerificationDialog verification={cancelling} onClose={() => setCancelling(null)} />}
        {openId && <VerificationReviewDrawer verificationId={openId} onClose={() => setOpenId(null)} />}
      </div>
    </div>
  );
}

/** Loads the proposal's current sites, then opens the assign dialog. */
function AssignForProposal({ item, onClose }: { item: { proposalId: string; reference: string; title: string }; onClose: () => void }) {
  const q = useNeedsProposalQuery(item.proposalId);
  if (!q.data) {
    return (
      <ModalShell title="Assign a BEAP site visit" subtitle={`${item.reference} · ${item.title}`} onClose={onClose} maxWidth="max-w-md">
        <div className="p-5 text-xs">
          {q.isError ? (
            <p role="alert" className="font-medium text-rose-700">
              The proposed project could not be loaded.
            </p>
          ) : (
            <div role="status" className="h-16 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none">
              <span className="sr-only">Loading the sites…</span>
            </div>
          )}
        </div>
      </ModalShell>
    );
  }
  return (
    <AssignVerificationDialog
      proposal={{ id: item.proposalId, reference: item.reference, title: item.title }}
      purpose="BEAP_REVIEW"
      sites={q.data.sites.map((s) => ({ siteNumber: s.siteNumber, schoolName: s.schoolName }))}
      onClose={onClose}
    />
  );
}
