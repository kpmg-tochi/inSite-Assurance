import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, FilePlus2 } from "lucide-react";
import {
  FLAG_RESOLUTIONS_BY_KIND,
  NEEDS_OPEN_PROPOSAL_STATUSES,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  PROPOSAL_FLAG_RESOLUTION_LABELS,
  RecordValidationRequestSchema,
  SiteVerificationMethodEnum,
  type NeedsCycleDto,
  type NeedsProposalDetailDto,
  type NeedsSeparationErrorCode,
  type ProposalDocumentKind,
  type ProposalFlagDto,
  type ProposalFlagResolution,
  type SiteVerificationMethod,
  type StageOutcome,
} from "@insite/shared";
import { CustomSelect } from "../../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useAuth } from "../../../lib/auth-context";
import { formatDateShort, formatDateTimeShort } from "../../../lib/formatters";
import { getProposalDocumentLink } from "../../../api/needsPipeline";
import { useNeedsProposalsQuery } from "../../../queries/needs/useNeedsQueries";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { useRecordValidationMutation } from "../../../mutations/needs/useDecisionMutations";
import { NeedsDocumentDialog } from "../NeedsDocumentDialog";
import { EmptyPanel, cardCls, inputCls, labelCls, stageLabel, todayInTenant } from "../needsUi";
import { outcomeLabel, separationCodeOf, SEPARATION_ACTION_FOR_CODE } from "./decisionUi";
import { DuplicateMatches, EssentialGaps, FlagResolutionText } from "./FlagDetails";
import { AskOverrideDialog, overrideFlagsOf } from "./SeparationOverride";

/**
 * Needs pipeline wave 3 (C2, A2): the Validation tab. The validator's current record (desk review,
 * site verification with its evidence, how the duplicate and essential facility flags were resolved),
 * the open validation flags with their facts, and the form to record one on the current version
 * (`POST /proposals/:id/validation`). The record is the validator's finding; the stage decision then
 * moves the proposal (an ADVANCE decision needs an ADVANCE record on the current version).
 */

const VALIDATION_FLAG_KINDS = new Set(["DUPLICATE", "ESSENTIAL_FACILITY_GAP"]);
const EVIDENCE_KINDS: readonly ProposalDocumentKind[] = ["SITE_VERIFICATION_EVIDENCE", "PHOTO", "SITE_REPORT"];

const METHOD_LABELS: Record<SiteVerificationMethod, string> = {
  WEB_EVIDENCE: "Evidence uploaded on the web",
  FIELD_APP: "Visit with the field app",
};

const RECORD_OUTCOMES = ["ADVANCE", "RETURN", "NOT_VALIDATED"] as const;
const RECORD_OUTCOME_HELP: Record<(typeof RECORD_OUTCOMES)[number], string> = {
  ADVANCE: "The need is real, the sites exist and the flags are resolved.",
  RETURN: "Something must be corrected by the submitter first.",
  NOT_VALIDATED: "The need or the site could not be confirmed; the proposed project closes.",
};

function buildFormSchema(requireSite: boolean) {
  return z
    .object({
      outcome: z.enum(RECORD_OUTCOMES),
      deskNotes: z.string().trim().min(10, "Write the desk review (at least 10 characters)").max(4000, "At most 4,000 characters"),
      withSite: z.boolean(),
      method: SiteVerificationMethodEnum,
      verifiedOn: z.string(),
      officerName: z.string(),
      siteNotes: z.string().max(4000, "At most 4,000 characters"),
      evidenceDocumentIds: z.array(z.string()),
      resolutions: z.array(z.object({ flagId: z.string(), resolution: z.string(), reason: z.string(), mergeIntoProposalId: z.string() })),
    })
    .superRefine((v, ctx) => {
      const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
      if (v.outcome === "ADVANCE" && requireSite && !v.withSite) issue(["withSite"], "This programme needs a site verification before a proposed project is validated");
      if (v.withSite) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.verifiedOn)) issue(["verifiedOn"], "Choose the date of the verification");
        else if (v.verifiedOn > todayInTenant()) issue(["verifiedOn"], "The verification cannot be in the future");
        if (v.officerName.trim().length < 2) issue(["officerName"], "Enter the name of the officer who verified the site");
      }
      v.resolutions.forEach((r, i) => {
        if (!r.resolution) {
          if (v.outcome === "ADVANCE") issue(["resolutions", i, "resolution"], "Resolve this flag before validating");
          return;
        }
        if (r.reason.trim().length < 5) issue(["resolutions", i, "reason"], "Give the reason (at least 5 characters)");
        if (r.resolution === "MERGED" && !r.mergeIntoProposalId) issue(["resolutions", i, "mergeIntoProposalId"], "Choose the proposed project it is merged into");
      });
    });
}

export function ProposalValidationTab({
  proposal,
  cycle,
  writable,
  onDecide,
}: {
  proposal: NeedsProposalDetailDto;
  cycle: NeedsCycleDto | null;
  writable: boolean;
  /** Opens the stage decision for this proposal with the outcome preset. */
  onDecide: (outcome: StageOutcome) => void;
}) {
  const record = proposal.validation;
  const flags = proposal.flags.filter((f) => VALIDATION_FLAG_KINDS.has(f.kind));
  const openFlags = flags.filter((f) => !f.resolved);
  const canRecord = writable && proposal.allowedActions.includes("RECORD_VALIDATION");
  const recordIsCurrent = Boolean(record && proposal.currentVersionNumber !== null && record.versionNumber === proposal.currentVersionNumber);
  const [formOpen, setFormOpen] = useState(!recordIsCurrent);
  // A record on an older version is recorded again: the form stays open until the current one exists.
  const showForm = canRecord && (formOpen || !recordIsCurrent);
  const validationLabel = cycle ? stageLabel(cycle, "VALIDATION") : "Validation";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-2">
        <section className={cardCls} aria-labelledby="validation-record">
          <h3 id="validation-record" className="text-sm font-bold text-slate-900">
            Validation record
          </h3>
          {record ? <RecordView proposal={proposal} /> : <p className="mt-1 text-xs text-slate-500">Nothing recorded yet.</p>}
          {canRecord && recordIsCurrent && record && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button type="button" className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover" onClick={() => onDecide(record.outcome)}>
                Record the {validationLabel.toLowerCase()} decision
              </button>
              {!formOpen && (
                <button type="button" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setFormOpen(true)}>
                  Record again
                </button>
              )}
            </div>
          )}
        </section>

        <section className={cardCls} aria-labelledby="validation-flags">
          <h3 id="validation-flags" className="text-sm font-bold text-slate-900">
            Possible duplicates and essential facilities
          </h3>
          {flags.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No duplicate or essential facility flag on this proposed project.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {flags.map((f) => (
                <li key={f.id} className="text-xs">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                    {f.resolved ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />}
                    {f.label}
                    {f.raisedOnVersion !== null && <span className="font-normal text-slate-500">· version {f.raisedOnVersion}</span>}
                  </p>
                  {f.kind === "DUPLICATE" ? <DuplicateMatches flag={f} /> : <EssentialGaps flag={f} />}
                  <p className="mt-1 text-[11px]">
                    <FlagResolutionText flag={f} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="xl:col-span-3">
        {showForm ? (
          <RecordForm proposal={proposal} cycle={cycle} openFlags={openFlags} onCancel={recordIsCurrent ? () => setFormOpen(false) : undefined} onSaved={() => setFormOpen(false)} />
        ) : !canRecord ? (
          <EmptyPanel title={proposal.stage === "VALIDATION" ? "Waiting for the validator" : `Not at ${validationLabel}`}>
            {proposal.stage === "VALIDATION"
              ? "The desk review, the site verification and the resolution of any flags are recorded here by the validator."
              : record
                ? "The record shown is the one the proposed project left this stage with."
                : "The validator records the desk review and the site verification here when the proposed project reaches this stage."}
          </EmptyPanel>
        ) : null}
      </div>
    </div>
  );
}

function RecordView({ proposal }: { proposal: NeedsProposalDetailDto }) {
  const record = proposal.validation!;
  const openFile = useOpenNeedsFileMutation();
  const docName = new Map(proposal.documents.map((d) => [d.id, d.title]));
  const flagLabel = new Map(proposal.flags.map((f) => [f.id, f.label]));
  const stale = proposal.currentVersionNumber !== null && record.versionNumber !== proposal.currentVersionNumber;
  const site = record.siteVerification;
  return (
    <dl className="mt-2 space-y-2 text-xs">
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Finding</dt>
        <dd className="font-semibold text-slate-900">
          {outcomeLabel("VALIDATION", record.outcome)}
          <span className="font-normal text-slate-600">
            {" "}
            · version {record.versionNumber} · {record.recordedByName}, {formatDateTimeShort(record.recordedAt)}
          </span>
        </dd>
        {stale && (
          <dd className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            Recorded on version {record.versionNumber}; the current version is {proposal.currentVersionNumber}. Record it again on the current version.
          </dd>
        )}
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Desk review</dt>
        <dd className="whitespace-pre-line text-slate-800">{record.deskNotes ?? "–"}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Site verification</dt>
        {site ? (
          <dd className="text-slate-800">
            {METHOD_LABELS[site.method]} on {formatDateShort(site.verifiedOn)} by {site.officerName}
            {site.notes && <span className="block whitespace-pre-line text-slate-600">{site.notes}</span>}
            {site.evidenceDocumentIds.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {site.evidenceDocumentIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="font-semibold text-brand-primary hover:underline disabled:opacity-50"
                    disabled={openFile.isPending}
                    onClick={() => openFile.mutate(() => getProposalDocumentLink(proposal.id, id))}
                  >
                    {docName.get(id) ?? "Evidence"}
                  </button>
                ))}
              </span>
            )}
          </dd>
        ) : (
          <dd className="text-slate-600">Not recorded</dd>
        )}
      </div>
      {record.duplicateResolutions.length > 0 && (
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Flags resolved</dt>
          <dd>
            <ul className="space-y-0.5 text-slate-800">
              {record.duplicateResolutions.map((r) => (
                <li key={r.flagId}>
                  {flagLabel.get(r.flagId) ?? "Flag"}: <span className="font-semibold">{PROPOSAL_FLAG_RESOLUTION_LABELS[r.resolution]}</span>
                  {r.reason ? ` (${r.reason})` : ""}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  );
}

function RecordForm({
  proposal,
  cycle,
  openFlags,
  onCancel,
  onSaved,
}: {
  proposal: NeedsProposalDetailDto;
  cycle: NeedsCycleDto | null;
  openFlags: ProposalFlagDto[];
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const requireSite = cycle?.config.requireSiteVerification ?? true;
  const schema = useMemo(() => buildFormSchema(requireSite), [requireSite]);
  const save = useRecordValidationMutation(proposal.cycleId, proposal.id);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState<NeedsSeparationErrorCode | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const othersQuery = useNeedsProposalsQuery(openFlags.some((f) => f.kind === "DUPLICATE") ? proposal.cycleId : null, {});
  const mergeOptions = useMemo(
    () =>
      (othersQuery.data ?? [])
        .filter((p) => p.id !== proposal.id && NEEDS_OPEN_PROPOSAL_STATUSES.includes(p.status))
        .map((p) => ({ value: p.id, label: `${p.reference} · ${p.title}` })),
    [othersQuery.data, proposal.id]
  );

  const form = useZodForm(schema, {
    defaultValues: {
      outcome: "ADVANCE",
      deskNotes: "",
      withSite: requireSite,
      method: "WEB_EVIDENCE",
      verifiedOn: todayInTenant(),
      officerName: user?.fullName ?? "",
      siteNotes: "",
      evidenceDocumentIds: [],
      resolutions: openFlags.map((f) => ({ flagId: f.id, resolution: "", reason: "", mergeIntoProposalId: "" })),
    },
  });
  const outcome = form.watch("outcome");
  const withSite = form.watch("withSite");
  const method = form.watch("method");
  const evidence = form.watch("evidenceDocumentIds");
  const resolutions = form.watch("resolutions");

  const supersededIds = useMemo(() => new Set(proposal.documents.map((d) => d.supersedesId).filter(Boolean)), [proposal.documents]);
  const evidenceDocs = useMemo(
    () => proposal.documents.filter((d) => EVIDENCE_KINDS.includes(d.kind) && !supersededIds.has(d.id)),
    [proposal.documents, supersededIds]
  );

  // An evidence document uploaded from here is ticked once it appears.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (uploading) known.current = new Set(proposal.documents.map((d) => d.id));
  }, [uploading, proposal.documents]);
  useEffect(() => {
    if (uploading || !known.current) return;
    const added = evidenceDocs.filter((d) => !known.current!.has(d.id)).map((d) => d.id);
    known.current = null;
    if (added.length) form.setValue("evidenceDocumentIds", [...new Set([...form.getValues("evidenceDocumentIds"), ...added])], { shouldValidate: true });
  }, [uploading, evidenceDocs, form]);

  const submit = form.handleSubmit((v) => {
    setRequestError(null);
    const parsed = RecordValidationRequestSchema.safeParse({
      outcome: v.outcome,
      deskNotes: v.deskNotes,
      siteVerification: v.withSite
        ? { method: v.method, verifiedOn: v.verifiedOn, officerName: v.officerName.trim(), notes: v.siteNotes.trim() || null, evidenceDocumentIds: v.evidenceDocumentIds }
        : null,
      flagResolutions: v.resolutions
        .filter((r) => r.resolution)
        .map((r) => ({ flagId: r.flagId, resolution: r.resolution, reason: r.reason.trim(), mergeIntoProposalId: r.resolution === "MERGED" ? r.mergeIntoProposalId : null })),
    });
    if (!parsed.success) {
      setRequestError(parsed.error.issues[0]?.message ?? "Check the record.");
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: () => onSaved(),
      onError: (err) => {
        const code = separationCodeOf(err);
        if (code) setAsking(code);
      },
    });
  });

  const separation = separationCodeOf(save.error);

  return (
    <>
    <form className={`${cardCls} space-y-4`} noValidate onSubmit={submit} aria-labelledby="validation-form-title">
      <div>
        <h3 id="validation-form-title" className="text-sm font-bold text-slate-900">
          Record the validation
        </h3>
        <p className="text-[11px] text-slate-500">On version {proposal.currentVersionNumber ?? "–"}. The decision that moves the proposed project is recorded after this.</p>
      </div>

      <fieldset>
        <legend className={labelCls}>Finding</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {RECORD_OUTCOMES.map((o) => (
            <label
              key={o}
              className={`flex cursor-pointer flex-col rounded-xl border p-2.5 text-xs ${outcome === o ? "border-brand-primary bg-brand-primary/[0.05]" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <span className="flex items-center gap-2 font-semibold text-slate-900">
                <input type="radio" value={o} {...form.register("outcome", { deps: ["withSite", "resolutions"] })} />
                {outcomeLabel("VALIDATION", o)}
              </span>
              <span className="mt-0.5 text-[11px] text-slate-600">{RECORD_OUTCOME_HELP[o]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className={labelCls} htmlFor="validation-desk">
          Desk review <span className="text-rose-600">*</span>
        </label>
        <textarea
          id="validation-desk"
          rows={4}
          className={`${inputCls} ${invalidClass(form, "deskNotes")}`}
          placeholder="What you checked: the need, the justification, the sites, the facilities breakdown…"
          {...form.register("deskNotes")}
          {...fieldA11y(form, "deskNotes")}
        />
        <FieldError form={form} name="deskNotes" />
      </div>

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">Site verification</legend>
        <label className="flex items-center gap-2 text-xs text-slate-800">
          <input type="checkbox" {...form.register("withSite", { deps: ["verifiedOn", "officerName"] })} />
          The sites were verified {requireSite && <span className="text-[11px] text-slate-500">(required by this programme to validate)</span>}
        </label>
        <FieldError form={form} name="withSite" />
        {withSite && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className={labelCls}>How</p>
              <CustomSelect
                ariaLabel="How the sites were verified"
                value={method}
                onChange={(v) => form.setValue("method", v as SiteVerificationMethod, { shouldValidate: true, shouldDirty: true })}
                options={SiteVerificationMethodEnum.options.map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
                size="sm"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="validation-date">
                Date <span className="text-rose-600">*</span>
              </label>
              <input id="validation-date" type="date" max={todayInTenant()} className={`${inputCls} ${invalidClass(form, "verifiedOn")}`} {...form.register("verifiedOn")} {...fieldA11y(form, "verifiedOn")} />
              <FieldError form={form} name="verifiedOn" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="validation-officer">
                Officer <span className="text-rose-600">*</span>
              </label>
              <input id="validation-officer" className={`${inputCls} ${invalidClass(form, "officerName")}`} {...form.register("officerName")} {...fieldA11y(form, "officerName")} />
              <FieldError form={form} name="officerName" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="validation-site-notes">
                Notes <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <textarea id="validation-site-notes" rows={2} className={`${inputCls} ${invalidClass(form, "siteNotes")}`} {...form.register("siteNotes")} {...fieldA11y(form, "siteNotes")} />
              <FieldError form={form} name="siteNotes" />
            </div>
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={labelCls}>Evidence</p>
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline" onClick={() => setUploading(true)}>
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Upload evidence
                </button>
              </div>
              {evidenceDocs.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No site verification evidence, photo or site report yet. Upload one with the kind "Site verification evidence", "Photo" or "Site report".
                </p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {evidenceDocs.map((d) => (
                    <label key={d.id} className="flex items-start gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={evidence.includes(d.id)}
                        onChange={(e) =>
                          form.setValue("evidenceDocumentIds", e.target.checked ? [...evidence, d.id] : evidence.filter((x) => x !== d.id), { shouldValidate: true, shouldDirty: true })
                        }
                      />
                      <span>
                        <span className="font-semibold text-slate-900">{d.title}</span> · {PROPOSAL_DOCUMENT_KIND_LABELS[d.kind]}
                        <span className="block text-[11px] text-slate-500">{formatDateTimeShort(d.uploadedAt)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </fieldset>

      {openFlags.length > 0 && (
        <fieldset className="space-y-3">
          <legend className={labelCls}>Resolve the flags</legend>
          {openFlags.map((f, i) => {
            const choice = resolutions?.[i]?.resolution as ProposalFlagResolution | "";
            const options = FLAG_RESOLUTIONS_BY_KIND[f.kind].map((r) => ({ value: r, label: PROPOSAL_FLAG_RESOLUTION_LABELS[r] }));
            return (
              <div key={f.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-xs font-semibold text-slate-900">{f.label}</p>
                {f.kind === "DUPLICATE" ? <DuplicateMatches flag={f} /> : <EssentialGaps flag={f} />}
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <CustomSelect
                      ariaLabel={`Resolution of ${f.label}`}
                      value={choice}
                      placeholder={outcome === "ADVANCE" ? "Choose the resolution" : "Leave open"}
                      onChange={(v) => form.setValue(`resolutions.${i}.resolution`, v, { shouldValidate: true, shouldDirty: true })}
                      options={options}
                      size="sm"
                    />
                    <FieldError form={form} name={`resolutions.${i}.resolution`} />
                  </div>
                  {choice === "MERGED" && (
                    <div>
                      <CustomSelect
                        ariaLabel="Merged into"
                        value={resolutions?.[i]?.mergeIntoProposalId ?? ""}
                        placeholder={othersQuery.isLoading ? "Loading…" : "The proposed project it is merged into"}
                        onChange={(v) => form.setValue(`resolutions.${i}.mergeIntoProposalId`, v, { shouldValidate: true, shouldDirty: true })}
                        options={mergeOptions}
                        size="sm"
                        searchable={mergeOptions.length > 8}
                      />
                      <FieldError form={form} name={`resolutions.${i}.mergeIntoProposalId`} />
                    </div>
                  )}
                  {choice && (
                    <div className="sm:col-span-2">
                      <label className="sr-only" htmlFor={`resolution-reason-${i}`}>
                        Reason
                      </label>
                      <input
                        id={`resolution-reason-${i}`}
                        className={`${inputCls} ${invalidClass(form, `resolutions.${i}.reason`)}`}
                        placeholder={f.kind === "ESSENTIAL_FACILITY_GAP" ? "Why the site does not need it (justification)" : "Reason"}
                        {...form.register(`resolutions.${i}.reason`)}
                        {...fieldA11y(form, `resolutions.${i}.reason`)}
                      />
                      <FieldError form={form} name={`resolutions.${i}.reason`} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
      )}

      {requestError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {requestError}
        </p>
      )}
      {separation && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p>{save.error instanceof Error ? save.error.message : "Separation of duties stops you from this step."}</p>
          <button type="button" className="mt-1 font-semibold text-brand-primary hover:underline" onClick={() => setAsking(separation)}>
            Ask for an override
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
        )}
        <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…">
          Save the record
        </SubmitButton>
      </div>
    </form>

      {uploading && <NeedsDocumentDialog target="proposal" cycleId={proposal.cycleId} proposalId={proposal.id} onClose={() => setUploading(false)} />}
      {asking && (
        <AskOverrideDialog
          cycleId={proposal.cycleId}
          proposal={{ id: proposal.id, reference: proposal.reference, title: proposal.title }}
          code={asking}
          action={SEPARATION_ACTION_FOR_CODE[asking]}
          overrides={overrideFlagsOf(proposal.flags)}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
