import React, { useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserCheck,
  FileText,
  Camera,
  Phone,
  Building2,
  Eye,
  Check,
  X,
  Smartphone,
  Award,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import type { ContractorVerificationRecordDto } from '../api/types';
import Drawer from './Drawer';
import { useAuth } from '../lib/auth-context';
import { useContractorVerificationsQuery } from '../queries/projects/useContractorVerificationQueries';
import { useReviewContractorVerificationMutation } from '../mutations/projects/useContractorVerificationMutations';
import { formatDateTimeShort } from '../lib/formatters';

interface ContractorVerificationQueueProps {
  projectId?: string | null;
  compact?: boolean;
  onVerificationReviewed?: () => void;
}

export default function ContractorVerificationQueue({
  projectId,
  compact = false,
  onVerificationReviewed,
}: ContractorVerificationQueueProps) {
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [selectedVerification, setSelectedVerification] =
    useState<ContractorVerificationRecordDto | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState('');

  // The endpoint requires assurance:review_credentials; never request it without that permission.
  const { data: verifications = [], isLoading } = useContractorVerificationsQuery(
    projectId || 'all',
    hasPermission('assurance:review_credentials')
  );

  const reviewMutation = useReviewContractorVerificationMutation();

  const pendingList = verifications.filter(
    (v) => v.assuranceStatus === 'PENDING_APPROVAL'
  );
  const displayedList = filter === 'PENDING' ? pendingList : verifications;

  const handleQuickDecision = (
    verification: ContractorVerificationRecordDto,
    decision: 'APPROVE' | 'REJECT',
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    reviewMutation.mutate(
      {
        projectId: verification.projectId,
        sessionId: verification.id,
        payload: {
          decision,
          remarks:
            decision === 'APPROVE'
              ? 'Approved for on-site field evidence reporting.'
              : 'Rejected: Credentials or biometric verification requirements not met.',
        },
      },
      {
        onSuccess: () => {
          if (selectedVerification?.id === verification.id) {
            setSelectedVerification(null);
          }
          if (onVerificationReviewed) onVerificationReviewed();
        },
      }
    );
  };

  const handleDrawerDecision = (decision: 'APPROVE' | 'REJECT') => {
    if (!selectedVerification) return;
    reviewMutation.mutate(
      {
        projectId: selectedVerification.projectId,
        sessionId: selectedVerification.id,
        payload: {
          decision,
          remarks:
            reviewRemarks ||
            (decision === 'APPROVE'
              ? 'Verified by Independent Monitor.'
              : 'Rejected by Independent Monitor.'),
        },
      },
      {
        onSuccess: () => {
          setSelectedVerification(null);
          setReviewRemarks('');
          if (onVerificationReviewed) onVerificationReviewed();
        },
      }
    );
  };

  const canReview = hasPermission('assurance:review_credentials');

  return (
    <div className="space-y-4">
      {/* Top Header & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand-primary/5 text-brand-primary flex items-center justify-center font-bold">
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Contractor Assurance Verifications
              </h3>
              {pendingList.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  {pendingList.length} Pending
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              ID photo, guided selfie set (3 poses) and COREN credentials for manual review
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setFilter('PENDING')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              filter === 'PENDING'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pending ({pendingList.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              filter === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Submissions ({verifications.length})
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Loading contractor assurance queue...
        </div>
      ) : displayedList.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
          <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="text-xs font-bold text-slate-800">
            {filter === 'PENDING'
              ? 'No Pending Verifications'
              : 'No Contractor Submissions Found'}
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {filter === 'PENDING'
              ? 'All on-site contractor personnel have been reviewed and approved for field evidence reporting.'
              : 'Contractor onboarding requests will appear here when site engineers join via project codes.'}
          </p>
        </div>
      ) : (
        /* Decluttered List of Cards */
        <div className="space-y-2.5">
          {displayedList.map((verification) => {
            const isPending = verification.assuranceStatus === 'PENDING_APPROVAL';
            const isApproved = verification.assuranceStatus === 'APPROVED';
            const isRejected = verification.assuranceStatus === 'REJECTED';

            return (
              <div
                key={verification.id}
                onClick={() => setSelectedVerification(verification)}
                className="group relative bg-white rounded-xl border border-slate-200/90 hover:border-brand-primary/40 p-4 transition-all duration-200 hover:shadow-sm cursor-pointer"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Left: Avatar & Contractor Details */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    {verification.selfieImageUrl ? (
                      <div className="relative shrink-0">
                        <img
                          src={verification.selfieImageUrl}
                          alt={verification.agentFullName}
                          className="w-11 h-11 rounded-xl object-cover border border-slate-200 shadow-2xs"
                        />
                      </div>
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-sm shrink-0 border border-slate-200">
                        {verification.agentFullName.slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900 group-hover:text-brand-primary transition-colors">
                          {verification.agentFullName}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-600 truncate font-medium">
                          {verification.organizationName}
                        </span>
                      </div>

                      {/* Badges Row */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {verification.registrationNumber && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-brand-primary/5 text-brand-primary border border-brand-primary/15">
                            <Award className="w-3 h-3 text-brand-primary" />
                            {verification.registrationBodyCode ? `${verification.registrationBodyCode} ` : ''}
                            {verification.registrationNumber}
                          </span>
                        )}

                        {verification.idDocumentType && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
                            <FileText className="w-3 h-3 text-slate-500" />
                            {verification.idDocumentType.replace(/_/g, ' ')}
                          </span>
                        )}

                        {verification.selfieImageUrl && verification.selfieLeftUrl && verification.selfieRightUrl && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
                            <Camera className="w-3 h-3 text-slate-500" />
                            Selfie set (3 poses) for manual review
                          </span>
                        )}

                        {/* Status Badge */}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            Pending Approval
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700">
                            Approved
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700">
                            Rejected
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Quick Action Buttons or Reviewer Info */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    {isPending && canReview ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) =>
                            handleQuickDecision(verification, 'APPROVE', e)
                          }
                          disabled={reviewMutation.isPending}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={(e) =>
                            handleQuickDecision(verification, 'REJECT', e)
                          }
                          disabled={reviewMutation.isPending}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="text-right">
                        {verification.reviewedByUserName && (
                          <div className="text-[11px] text-slate-500">
                            {isApproved ? 'Approved by' : 'Reviewed by'}{' '}
                            <span className="font-semibold text-slate-700">
                              {verification.reviewedByUserName}
                            </span>
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400">
                          {formatDateTimeShort(
                            verification.reviewedAt || verification.submittedAt
                          )}
                        </div>
                      </div>
                    )}

                    <div className="text-slate-400 pl-1">
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Dossier Slide-Over Drawer */}
      {selectedVerification && (
        <Drawer onClick={() => setSelectedVerification(null)}>
          <div
            className="flex flex-col h-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-brand-primary uppercase tracking-wide">
                    Contractor Assurance Dossier
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      selectedVerification.assuranceStatus === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : selectedVerification.assuranceStatus === 'REJECTED'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {selectedVerification.assuranceStatus.replace(/_/g, ' ')}
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-900 mt-0.5">
                  {selectedVerification.agentFullName}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedVerification.organizationName} · {selectedVerification.projectCodePrefix}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedVerification(null)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Biometric & Live Selfie Verification Card */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Camera className="w-4 h-4 text-brand-primary" />
                    Selfie set (3 poses) for manual review
                  </div>
                </div>

                {/* D-4.2: no automated liveness check runs. The reviewer compares the three poses
                    with each other and with the ID photo. */}
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['Front', selectedVerification.selfieImageUrl],
                      ['Left', selectedVerification.selfieLeftUrl],
                      ['Right', selectedVerification.selfieRightUrl],
                    ] as const
                  ).map(([label, url]) => (
                    <div key={label}>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        {label}
                      </div>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={url}
                            alt={`Selfie ${label.toLowerCase()}`}
                            className="w-full aspect-square object-cover rounded-lg border border-slate-200"
                          />
                        </a>
                      ) : (
                        <div className="rounded-lg border border-dashed border-slate-300 aspect-square flex items-center justify-center text-slate-400 text-[11px]">
                          Not provided
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  {/* Selfie Preview */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Front selfie
                    </div>
                    {selectedVerification.selfieImageUrl ? (
                      <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-200">
                        <img
                          src={selectedVerification.selfieImageUrl}
                          alt="Selfie"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 aspect-square flex items-center justify-center text-slate-400 text-[11px]">
                        No image
                      </div>
                    )}
                  </div>

                  {/* ID Document Preview */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Government Photo ID
                    </div>
                    {selectedVerification.idDocumentUrl ? (
                      <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-200">
                        <img
                          src={selectedVerification.idDocumentUrl}
                          alt="ID Document"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-brand-primary/10 flex items-center justify-center pointer-events-none">
                          <span className="rotate-[-25deg] text-[9px] font-bold tracking-widest text-white/90 bg-slate-950/70 px-2 py-0.5 rounded shadow-sm">
                            NDPA AUDIT ONLY
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 aspect-square flex items-center justify-center text-slate-400 text-[11px]">
                        No ID uploaded
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/60 leading-relaxed">
                  No automated liveness check is run. Approve only if the three poses show the same live person as the ID photo. Images are private and shown through links that expire after 5 minutes.
                </div>
              </div>

              {/* Professional registration (Phase 12: shown only when one was given) */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Award className="w-4 h-4 text-brand-primary" />
                  Competence &amp; registration
                </div>

                <div className="space-y-2">
                  {selectedVerification.registrationNumber && (
                    <>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Registration body</span>
                        <span className="font-semibold text-slate-800">
                          {selectedVerification.registrationBodyName ||
                            selectedVerification.registrationBodyCode ||
                            'Not stated'}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Registration number</span>
                        <span className="font-bold text-brand-primary">{selectedVerification.registrationNumber}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">ID Document Type</span>
                    <span className="font-semibold text-slate-800">
                      {selectedVerification.idDocumentType?.replace(/_/g, ' ') || 'Government ID'}
                    </span>
                  </div>
                </div>

                {selectedVerification.experienceSummary && (
                  <div className="pt-2">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Professional Experience &amp; Specialization
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-slate-700 leading-relaxed border border-slate-100">
                      {selectedVerification.experienceSummary}
                    </div>
                  </div>
                )}
              </div>

              {/* Device & Session Telemetry */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Smartphone className="w-4 h-4 text-brand-primary" />
                  Device &amp; Telemetry Integrity
                </div>
                <div className="space-y-1.5 text-slate-600">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Mobile Phone</span>
                    <span className="font-semibold text-slate-800">
                      {selectedVerification.agentPhoneNumber}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Device Hardware</span>
                    <span className="font-semibold text-slate-800">
                      {selectedVerification.deviceModel || selectedVerification.deviceId || 'Android Smartphone'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Assigned Join Code</span>
                    <span className="font-bold text-slate-800">
                      {selectedVerification.joinCodeUsed}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Submission Timestamp</span>
                    <span className="font-medium text-slate-700">
                      {formatDateTimeShort(selectedVerification.submittedAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Review History / Remarks Section */}
              {selectedVerification.assuranceStatus !== 'PENDING_APPROVAL' ? (
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-1.5">
                  <div className="font-bold text-slate-800">
                    Review Decision Record
                  </div>
                  <div className="text-slate-600">
                    Decision recorded by{' '}
                    <span className="font-semibold text-slate-900">
                      {selectedVerification.reviewedByUserName || 'Independent Monitor'}
                    </span>{' '}
                    on {formatDateTimeShort(selectedVerification.reviewedAt || '')}.
                  </div>
                  {selectedVerification.rejectionReason && (
                    <div className="mt-2 text-rose-700 bg-rose-50 p-2 rounded border border-rose-100 font-medium">
                      Reason: {selectedVerification.rejectionReason}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Monitor Review Notes &amp; Auditor Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={reviewRemarks}
                    onChange={(e) => setReviewRemarks(e.target.value)}
                    placeholder="Enter compliance or approval notes for the immutable audit ledger..."
                    className="w-full text-xs rounded-xl border border-slate-200 p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                  />
                </div>
              )}
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
              {selectedVerification.assuranceStatus === 'PENDING_APPROVAL' && canReview ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleDrawerDecision('REJECT')}
                    disabled={reviewMutation.isPending}
                    className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject Dossier
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDrawerDecision('APPROVE')}
                    disabled={reviewMutation.isPending}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve Application
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedVerification(null)}
                  className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                >
                  Close Dossier
                </button>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
