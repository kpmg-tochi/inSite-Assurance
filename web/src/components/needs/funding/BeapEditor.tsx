import React, { useMemo, useState } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileUp, Send } from "lucide-react";
import {
  PROCUREMENT_METHOD_LABELS,
  ProcurementMethodEnum,
  SaveBeapRequestSchema,
  type NeedsCycleDocumentDto,
  type NeedsCycleDto,
  type NeedsProposalSummaryDto,
  type NeedsSubmissionDto,
  type SaveBeapRequestInput,
} from "@insite/shared";
import { CustomSelect } from "../../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, visibleError } from "../../../lib/forms";
import { apiErrorCode, apiErrorDetails } from "../../../api/needsPipeline";
import { useSaveBeapMutation, useSubmitBeapMutation } from "../../../mutations/needs/useFundingMutations";
import { needsBeapKey } from "../../../queries/needs/useFundingQueries";
import { needsProposalsKey } from "../../../queries/needs/useNeedsQueries";
import { NeedsUploadDialog } from "../NeedsUploadDialog";
import { cardCls, inputCls, labelCls, locationText, money, plural } from "../needsUi";
import { DocumentRef, FundingDocumentDialog, Notice, ProblemList, ProposalLink, ReviewOutcomeTag, detailMessages } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C2): the SUBEB builds its BEAP (Matching Grants), `needs:prepare_beap` in
 * the owning organisation, while the BEAP is a draft or returned. Every proposed project at Funding
 * is listed: included (lot title, procurement method, planned start and end) or excluded with a
 * reason. Projects with the same lot title share a lot; the numbers are given on approval. The
 * narrative (the BEAP document) is required to submit; the counterpart amount and evidence may
 * follow (A5). Submitting saves first, then submits (422 NEEDS_BEAP_INCOMPLETE lists what is missing).
 * After a return, UBEC's comment sits on each item and the SUBEB can upload a revised needs
 * assessment of a proposed project (a BEAP_REVISION version) before resubmitting.
 */

export interface BeapEditorRow {
  proposalId: string;
  reference: string;
  title: string;
  stateCode: string | null;
  lgaCodes: string[];
  siteCount: number;
  amountNgn: number | null;
  currentVersionNumber: number | null;
  reviewOutcome: NeedsSubmissionDto["items"][number]["reviewOutcome"];
  reviewComment: string | null;
}

const ItemSchema = z
  .object({
    proposalId: z.string(),
    included: z.boolean(),
    exclusionReason: z.string(),
    lotTitle: z.string(),
    procurementMethod: z.string(),
    plannedStartDate: z.string(),
    plannedEndDate: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.included && v.exclusionReason.trim().length < 5) ctx.addIssue({ code: "custom", path: ["exclusionReason"], message: "Give the reason for the exclusion" });
    if (v.plannedStartDate && v.plannedEndDate && v.plannedEndDate < v.plannedStartDate) {
      ctx.addIssue({ code: "custom", path: ["plannedEndDate"], message: "The end is before the start" });
    }
  });

const FormSchema = z
  .object({
    items: z.array(ItemSchema),
    counterpartDeclaredNgn: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+(\.\d+)?$/.test(v.replace(/,/g, "")), "Enter the amount in naira, e.g. 25000000"),
  })
  .transform((v) => ({
    items: v.items.map((i) => ({
      proposalId: i.proposalId,
      included: i.included,
      exclusionReason: i.included ? null : i.exclusionReason.trim(),
      lotTitle: i.lotTitle.trim() || null,
      procurementMethod: (i.procurementMethod || null) as z.infer<typeof ProcurementMethodEnum> | null,
      plannedStartDate: i.plannedStartDate || null,
      plannedEndDate: i.plannedEndDate || null,
    })),
    counterpartDeclaredNgn: v.counterpartDeclaredNgn ? Number(v.counterpartDeclaredNgn.replace(/,/g, "")) : null,
  }))
  .pipe(SaveBeapRequestSchema.omit({ narrativeDocumentId: true, counterpartEvidenceDocumentId: true }));

type FormInput = z.input<typeof FormSchema>;

const METHOD_OPTIONS = ProcurementMethodEnum.options.map((m) => ({ value: m, label: PROCUREMENT_METHOD_LABELS[m] }));

/** The rows to edit: the BEAP's items, then any proposed project at Funding not on it yet. */
export function beapEditorRows(beap: NeedsSubmissionDto | null, atFunding: NeedsProposalSummaryDto[]): BeapEditorRow[] {
  const rows: BeapEditorRow[] = (beap?.items ?? []).map((i) => ({
    proposalId: i.proposalId,
    reference: i.reference,
    title: i.title,
    stateCode: i.stateCode,
    lgaCodes: i.lgaCodes,
    siteCount: i.siteCount,
    amountNgn: i.amountNgn,
    currentVersionNumber: i.currentVersionNumber,
    reviewOutcome: i.reviewOutcome,
    reviewComment: i.reviewComment,
  }));
  const listed = new Set(rows.map((r) => r.proposalId));
  for (const p of atFunding) {
    if (listed.has(p.id)) continue;
    rows.push({
      proposalId: p.id,
      reference: p.reference,
      title: p.title,
      stateCode: p.stateCode,
      lgaCodes: p.lgaCodes,
      siteCount: p.siteCount,
      amountNgn: p.approvedAmountNgn ?? p.costedAmountNgn,
      currentVersionNumber: p.currentVersionNumber,
      reviewOutcome: null,
      reviewComment: null,
    });
  }
  return rows;
}

export function BeapEditor({ cycle, beap, rows: liveRows }: { cycle: NeedsCycleDto; beap: NeedsSubmissionDto | null; rows: BeapEditorRow[] }) {
  const qc = useQueryClient();
  const save = useSaveBeapMutation(cycle.id);
  const submit = useSubmitBeapMutation(cycle.id);
  const returned = beap?.status === "RETURNED";
  // The form's items follow the rows as first shown (a refetch must not shift the indexes); amounts and
  // version numbers are read live, so a revised needs assessment shows at once.
  const [initialRows] = useState(liveRows);
  const rows = useMemo(() => initialRows.map((r) => liveRows.find((l) => l.proposalId === r.proposalId) ?? r), [initialRows, liveRows]);
  const [byId] = useState(() => new Map((beap?.items ?? []).map((i) => [i.proposalId, i])));

  const form = useZodForm(FormSchema, {
    defaultValues: {
      items: rows.map((r) => {
        const i = byId.get(r.proposalId);
        return {
          proposalId: r.proposalId,
          included: i?.included ?? true,
          exclusionReason: i?.exclusionReason ?? "",
          lotTitle: i?.lotTitle ?? "",
          procurementMethod: i?.procurementMethod ?? "",
          plannedStartDate: i?.plannedStartDate ?? "",
          plannedEndDate: i?.plannedEndDate ?? "",
        };
      }),
      counterpartDeclaredNgn: beap?.counterpartDeclaredNgn !== null && beap?.counterpartDeclaredNgn !== undefined ? String(beap.counterpartDeclaredNgn) : "",
    } satisfies FormInput,
  });
  const values = form.watch();

  const [narrativeId, setNarrativeId] = useState<string | null>(beap?.narrativeDocumentId ?? null);
  const [evidenceId, setEvidenceId] = useState<string | null>(beap?.counterpartEvidenceDocumentId ?? null);
  const [uploaded, setUploaded] = useState<NeedsCycleDocumentDto[]>([]);
  const [dialog, setDialog] = useState<"narrative" | "evidence" | null>(null);
  const [revisionFor, setRevisionFor] = useState<BeapEditorRow | null>(null);
  const documents = useMemo(() => [...cycle.documents, ...uploaded], [cycle.documents, uploaded]);

  const lotTitles = useMemo(
    () => [...new Set(values.items.map((i) => i.lotTitle.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [values.items]
  );
  const included = values.items.filter((i) => i.included);
  const includedTotal = rows.reduce((s, r, n) => s + (values.items[n]?.included ? (r.amountNgn ?? 0) : 0), 0);

  /** What submitting still needs (the server checks the same and answers 422 NEEDS_BEAP_INCOMPLETE). */
  const missing = useMemo(() => {
    const out: string[] = [];
    if (included.length === 0) out.push("Include at least one proposed project.");
    rows.forEach((r, n) => {
      const i = values.items[n];
      if (!i?.included) return;
      const gaps = [
        !i.lotTitle.trim() && "lot title",
        !i.procurementMethod && "procurement method",
        !i.plannedStartDate && "planned start",
        !i.plannedEndDate && "planned end",
      ].filter(Boolean);
      if (gaps.length) out.push(`${r.reference}: ${gaps.join(", ")}.`);
    });
    if (!narrativeId) out.push("Upload the BEAP narrative.");
    return out;
  }, [included.length, rows, values.items, narrativeId]);

  const bodyOf = (parsed: Omit<SaveBeapRequestInput, "narrativeDocumentId" | "counterpartEvidenceDocumentId">): SaveBeapRequestInput => ({
    ...parsed,
    narrativeDocumentId: narrativeId,
    counterpartEvidenceDocumentId: evidenceId,
  });
  const onSave = form.handleSubmit((parsed) => save.mutate(bodyOf(parsed)));
  const onSubmit = form.handleSubmit((parsed) => submit.mutate(bodyOf(parsed)));
  const incomplete = submit.error && apiErrorCode(submit.error) === "NEEDS_BEAP_INCOMPLETE" ? detailMessages(apiErrorDetails(submit.error)) : [];
  const pending = save.isPending || submit.isPending;

  const touch = { shouldValidate: true, shouldDirty: true, shouldTouch: true } as const;

  return (
    <form className="space-y-4" noValidate onSubmit={onSave}>
      {rows.length === 0 ? (
        <Notice tone="info">No proposed project is at Funding: they reach the BEAP when the State's portfolio is approved (Approvals tab).</Notice>
      ) : (
        <section className={`${cardCls} space-y-3`} aria-labelledby="beap-items-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="beap-items-heading" className="text-sm font-bold text-slate-900">
              Projects in the BEAP
            </h3>
            <p className="text-xs text-slate-600">
              {plural(included.length, "project")} included · {money(includedTotal)}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Give each included project its lot title, procurement method and planned dates. Projects with the same lot title are procured in one lot; the lot and
            batch numbers are given when UBEC approves the BEAP.
          </p>
          <datalist id="beap-lot-titles">
            {lotTitles.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <ul className="space-y-2">
            {rows.map((r, n) => {
              const item = values.items[n];
              const base = `items.${n}`;
              return (
                <li key={r.proposalId} className={`rounded-xl border p-3 ${item?.included ? "border-slate-200" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-xs">
                      <p className="text-slate-900">
                        <ProposalLink proposalId={r.proposalId} reference={r.reference} /> · <span className="font-semibold">{r.title}</span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {locationText(r.stateCode, r.lgaCodes)} · {plural(r.siteCount, "site")}
                        {r.currentVersionNumber ? ` · needs assessment v${r.currentVersionNumber}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="tabular-nums font-semibold text-slate-900">{money(r.amountNgn)}</span>
                      <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                        <input type="checkbox" checked={Boolean(item?.included)} onChange={(e) => form.setValue(`items.${n}.included`, e.target.checked, touch)} />
                        Include
                      </label>
                    </div>
                  </div>

                  {r.reviewOutcome && (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-700">UBEC review</span>
                        <ReviewOutcomeTag outcome={r.reviewOutcome} />
                      </p>
                      {r.reviewComment && <p className="mt-0.5 whitespace-pre-line text-slate-700">{r.reviewComment}</p>}
                    </div>
                  )}

                  {item?.included ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className={labelCls} htmlFor={`beap-lot-${n}`}>
                          Lot title
                        </label>
                        <input
                          id={`beap-lot-${n}`}
                          list="beap-lot-titles"
                          className={`${inputCls} ${invalidClass(form, `${base}.lotTitle`)}`}
                          placeholder="e.g. Renovation of Public Schools"
                          {...form.register(`items.${n}.lotTitle`)}
                          {...fieldA11y(form, `${base}.lotTitle`)}
                        />
                        <FieldError form={form} name={`${base}.lotTitle`} />
                      </div>
                      <div>
                        <p className={labelCls}>Procurement method</p>
                        <CustomSelect
                          ariaLabel={`Procurement method for ${r.reference}`}
                          value={item.procurementMethod}
                          onChange={(v) => form.setValue(`items.${n}.procurementMethod`, v, touch)}
                          options={METHOD_OPTIONS}
                          placeholder="Choose the method"
                          size="sm"
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor={`beap-start-${n}`}>
                          Planned start
                        </label>
                        <input
                          id={`beap-start-${n}`}
                          type="date"
                          className={`${inputCls} ${invalidClass(form, `${base}.plannedStartDate`)}`}
                          {...form.register(`items.${n}.plannedStartDate`, { deps: [`items.${n}.plannedEndDate`] })}
                          {...fieldA11y(form, `${base}.plannedStartDate`)}
                        />
                        <FieldError form={form} name={`${base}.plannedStartDate`} />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor={`beap-end-${n}`}>
                          Planned end
                        </label>
                        <input
                          id={`beap-end-${n}`}
                          type="date"
                          min={item.plannedStartDate || undefined}
                          className={`${inputCls} ${invalidClass(form, `${base}.plannedEndDate`)}`}
                          {...form.register(`items.${n}.plannedEndDate`)}
                          {...fieldA11y(form, `${base}.plannedEndDate`)}
                        />
                        <FieldError form={form} name={`${base}.plannedEndDate`} />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <label className={labelCls} htmlFor={`beap-exclusion-${n}`}>
                        Reason for leaving it out <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id={`beap-exclusion-${n}`}
                        className={`${inputCls} ${invalidClass(form, `${base}.exclusionReason`)}`}
                        {...form.register(`items.${n}.exclusionReason`)}
                        {...fieldA11y(form, `${base}.exclusionReason`)}
                      />
                      {visibleError(form, `${base}.exclusionReason`) ? (
                        <FieldError form={form} name={`${base}.exclusionReason`} />
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-500">An excluded project is not funded in this BEAP.</p>
                      )}
                    </div>
                  )}

                  {returned && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline"
                        onClick={() => setRevisionFor(r)}
                      >
                        <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload a revised needs assessment
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={`${cardCls} space-y-3`} aria-labelledby="beap-documents-heading">
        <h3 id="beap-documents-heading" className="text-sm font-bold text-slate-900">
          Narrative and counterpart funding
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1 text-xs">
            <p className={labelCls}>
              BEAP narrative <span className="text-rose-600">*</span>
            </p>
            <DocumentRef cycleId={cycle.id} documentId={narrativeId} documents={documents} />
            <div>
              <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline" onClick={() => setDialog("narrative")}>
                <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> {narrativeId ? "Replace the narrative" : "Upload the narrative"}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">The State's Basic Education Action Plan document. Required to submit.</p>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <label className={labelCls} htmlFor="beap-counterpart">
                Counterpart funds declared (₦)
              </label>
              <input
                id="beap-counterpart"
                inputMode="decimal"
                className={`${inputCls} ${invalidClass(form, "counterpartDeclaredNgn")}`}
                {...form.register("counterpartDeclaredNgn")}
                {...fieldA11y(form, "counterpartDeclaredNgn")}
              />
              <FieldError form={form} name="counterpartDeclaredNgn" />
            </div>
            <div className="space-y-1">
              <p className={labelCls}>Counterpart evidence</p>
              <DocumentRef cycleId={cycle.id} documentId={evidenceId} documents={documents} />
              <div>
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline" onClick={() => setDialog("evidence")}>
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> {evidenceId ? "Replace the evidence" : "Upload the evidence"}
                </button>
              </div>
            </div>
          </div>
        </div>
        <Notice tone={evidenceId ? "info" : "warning"}>
          The counterpart amount and evidence can follow after submission. UBEC may approve the BEAP without them, but no project from this BEAP can be activated
          until the counterpart evidence is recorded.
        </Notice>
      </section>

      <ProblemList title="The BEAP was not submitted: complete these first" items={incomplete} />

      <div className="flex flex-wrap items-start justify-end gap-3">
        {missing.length > 0 && (
          <div className="mr-auto max-w-xl text-[11px] text-slate-600">
            <p className="font-semibold text-slate-700">Before you can submit:</p>
            <ul className="list-disc pl-4">
              {missing.slice(0, 6).map((m) => (
                <li key={m}>{m}</li>
              ))}
              {missing.length > 6 && <li>and {missing.length - 6} more.</li>}
            </ul>
          </div>
        )}
        <SubmitButton
          form={form}
          pending={pending}
          pendingLabel="Saving…"
          blocked={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          hint="Fix the fields marked in red."
        >
          Save draft
        </SubmitButton>
        <SubmitButton
          form={form}
          type="button"
          onClick={() => void onSubmit()}
          pending={pending}
          pendingLabel="Submitting…"
          blocked={missing.length > 0}
          showHint={false}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" /> {returned ? "Resubmit to UBEC" : "Submit to UBEC"}
        </SubmitButton>
      </div>

      {dialog === "narrative" && (
        <FundingDocumentDialog
          cycleId={cycle.id}
          area="beap"
          kind="BEAP"
          defaultTitle={`BEAP ${cycle.interventionYear}`}
          dialogTitle="Upload the BEAP narrative"
          intro="It is named on the BEAP when you save or submit."
          onClose={() => setDialog(null)}
          onUploaded={(doc) => {
            setUploaded((prev) => [...prev, doc]);
            setNarrativeId(doc.id);
          }}
        />
      )}
      {dialog === "evidence" && (
        <FundingDocumentDialog
          cycleId={cycle.id}
          area="beap"
          kind="COUNTERPART_EVIDENCE"
          defaultTitle={`Counterpart funding evidence ${cycle.interventionYear}`}
          dialogTitle="Upload the counterpart evidence"
          intro="E.g. the State's release letter or bank statement. It is named on the BEAP when you save or submit."
          onClose={() => setDialog(null)}
          onUploaded={(doc) => {
            setUploaded((prev) => [...prev, doc]);
            setEvidenceId(doc.id);
          }}
        />
      )}
      {revisionFor && (
        <NeedsUploadDialog
          cycleId={cycle.id}
          fixedProposal={{ id: revisionFor.proposalId, reference: revisionFor.reference, title: revisionFor.title }}
          onClose={() => {
            setRevisionFor(null);
            // A revised version changes the item's cost and version number.
            qc.invalidateQueries({ queryKey: needsBeapKey(cycle.id) });
            qc.invalidateQueries({ queryKey: needsProposalsKey(cycle.id) });
          }}
        />
      )}
    </form>
  );
}
