import React, { useId, useMemo } from "react";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, MoveRight, Undo2, X } from "lucide-react";
import {
  EXISTING_CONDITION_LABELS,
  NEEDS_VERIFICATION_PURPOSE_LABELS,
  ReviewNeedsVerificationRequestSchema,
  distanceMeters,
  siteCoordinateCorrections,
  sitesNotFound,
  type NeedsSiteCoordinateCorrection,
  type NeedsVerificationCaptureDto,
  type NeedsVerificationDto,
  type NeedsVerificationRowFact,
  type NeedsVerificationSiteFact,
} from "@insite/shared";
import Drawer from "../../Drawer";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { formatDateShort, formatDateTimeShort } from "../../../lib/formatters";
import { useNeedsVerificationQuery } from "../../../queries/needs/useVerificationQueries";
import { useReviewVerificationMutation, verificationFailureText } from "../../../mutations/needs/useVerificationMutations";
import { inputCls, labelCls, plural } from "../needsUi";
import { VerificationDue, VerificationStatusTag, formatCoordinate, formatDistance } from "./verificationUi";

/**
 * Needs pipeline wave 5 (N8): one field verification, opened from the Validation tab or the BEAP
 * review. Per site: the school found answer, the comment, the recorded location against the stored
 * one (distance, and whether acceptance moves it: `siteCoordinateCorrections`); per facilities
 * breakdown row: recorded against counted quantity and condition (`differs` highlighted); photos
 * (signed links, open full size); the officer's notes. A reviewer (`allowedActions` REVIEW) accepts
 * (correcting the site coordinates by default) or returns it with a reason. After acceptance the
 * drawer shows what moved (`submission.siteCorrections`).
 */

const ReviewFormSchema = z
  .object({ decision: z.enum(["ACCEPT", "RETURN"]), reason: z.string(), correctCoordinates: z.boolean() })
  .transform((v) => ({ decision: v.decision, reason: v.reason.trim() || null, correctCoordinates: v.correctCoordinates }))
  .pipe(ReviewNeedsVerificationRequestSchema);

export function VerificationReviewDrawer({ verificationId, onClose }: { verificationId: string; onClose: () => void }) {
  const titleId = useId();
  const q = useNeedsVerificationQuery(verificationId);
  const v = q.data;
  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && onClose()} onClose={onClose} labelledBy={titleId}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm font-bold text-slate-900">
              {v ? NEEDS_VERIFICATION_PURPOSE_LABELS[v.purpose] : "Field verification"}
            </h3>
            {v && (
              <p className="text-[11px] text-slate-500">
                {v.reference} · {v.title}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {q.isLoading ? (
            <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
              <span className="sr-only">Loading the field verification…</span>
            </div>
          ) : q.isError || !v ? (
            <p role="alert" className="text-xs font-medium text-rose-700">
              The field verification could not be loaded.
            </p>
          ) : (
            <VerificationBody v={v} onDone={onClose} />
          )}
        </div>
      </div>
    </Drawer>
  );
}

function VerificationBody({ v, onDone }: { v: NeedsVerificationDto; onDone: () => void }) {
  const s = v.submission;
  const canReview = v.allowedActions.includes("REVIEW") && s?.status === "SUBMITTED";
  // Same rule as the server: a site whose school was not found is never moved.
  const preview = useMemo(
    () => (s ? siteCoordinateCorrections(v.sites, s.siteLocations, { skipSiteNumbers: sitesNotFound({ sites: v.sites }, s.answers) }) : []),
    [v.sites, s]
  );
  const applied = s?.status === "ACCEPTED" ? s.siteCorrections ?? [] : null;
  const photosByPath = useMemo(() => groupCaptures(v.captures), [v.captures]);

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <VerificationStatusTag status={v.status} label={v.statusLabel} />
          <span className="text-slate-600">
            <VerificationDue v={v} />
          </span>
        </div>
        <p className="text-slate-700">
          {v.officer.name} · assigned by {v.assignedBy.name}, {formatDateShort(v.assignedAt)} · needs assessment v{v.versionNumber} · {plural(v.sites.length, "site")},{" "}
          {plural(v.rowCount, "facility row")}
        </p>
        {v.instructions && <p className="whitespace-pre-line rounded-lg bg-slate-50 px-2 py-1 text-slate-700">{v.instructions}</p>}
        {v.status === "CANCELLED" && v.cancelReason && <p className="text-slate-600">Cancelled: {v.cancelReason}</p>}
      </section>

      {!s ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">The officer has not submitted anything yet.</p>
      ) : (
        <>
          <section className="space-y-0.5 border-t border-slate-100 pt-3">
            <p className="text-slate-700">
              Submitted by {s.submittedByName}, {formatDateTimeShort(s.submittedAt)}
              {s.reviewedByName && s.reviewedAt && (
                <span>
                  {" "}
                  · {s.status === "RETURNED" ? "returned" : "accepted"} by {s.reviewedByName}, {formatDateTimeShort(s.reviewedAt)}
                </span>
              )}
            </p>
            {s.status === "RETURNED" && s.reviewReason && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-amber-900">
                <Undo2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="whitespace-pre-line">{s.reviewReason}</span>
              </p>
            )}
          </section>

          {applied && <AppliedCorrections corrections={applied} />}

          <section aria-label="Sites" className="space-y-3">
            {v.sites.map((site) => (
              <SiteBlock
                key={site.siteNumber}
                site={site}
                fact={s.siteFacts.find((f) => f.siteNumber === site.siteNumber) ?? null}
                willMove={applied ? null : preview.find((c) => c.siteNumber === site.siteNumber) ?? null}
                photos={photosByPath.site.get(site.siteNumber) ?? []}
                rows={s.rowFacts.filter((r) => r.siteNumber === site.siteNumber)}
                rowPhotos={photosByPath.row}
              />
            ))}
          </section>

          {photosByPath.other.length > 0 && (
            <section>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Other photos and voice notes</h4>
              <Captures captures={photosByPath.other} />
            </section>
          )}

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Officer's notes</h4>
            <p className="whitespace-pre-line text-slate-800">{s.notes ?? "–"}</p>
          </section>

          {canReview && <ReviewForm v={v} movesCount={preview.length} onDone={onDone} />}
        </>
      )}
    </div>
  );
}

function AppliedCorrections({ corrections }: { corrections: NeedsSiteCoordinateCorrection[] }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900" aria-label="Site locations corrected">
      <p className="flex items-center gap-1.5 font-semibold">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        {corrections.length === 0 ? "No site location was changed." : `${plural(corrections.length, "site location")} corrected on acceptance`}
      </p>
      {corrections.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {corrections.map((c) => (
            <li key={c.siteNumber}>
              Site {c.siteNumber} · {c.schoolName}: {c.from ? `${formatCoordinate(c.from.latitude, c.from.longitude)} → ` : "no location → "}
              {formatCoordinate(c.to.latitude, c.to.longitude)}
              {c.distanceMeters !== null ? ` (moved ${formatDistance(c.distanceMeters)})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SiteBlock({
  site,
  fact,
  willMove,
  photos,
  rows,
  rowPhotos,
}: {
  site: NeedsVerificationDto["sites"][number];
  fact: NeedsVerificationSiteFact | null;
  willMove: NeedsSiteCoordinateCorrection | null;
  photos: NeedsVerificationCaptureDto[];
  rows: NeedsVerificationRowFact[];
  rowPhotos: Map<string, NeedsVerificationCaptureDto[]>;
}) {
  const loc = fact?.location ?? null;
  const stored = site.latitude !== null && site.longitude !== null ? { latitude: site.latitude, longitude: site.longitude } : null;
  const gap = loc && stored ? distanceMeters(stored, { latitude: loc.latitude, longitude: loc.longitude }) : null;
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <h4 className="font-bold text-slate-900">
        Site {site.siteNumber} · {site.schoolName}
      </h4>
      <dl className="mt-1 space-y-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-slate-500">School found</dt>
          <dd className="font-semibold text-slate-900">
            {fact?.schoolFound === true ? (
              "Yes"
            ) : fact?.schoolFound === false ? (
              <span className="inline-flex items-center gap-1 text-rose-700">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> No
              </span>
            ) : (
              "Not answered"
            )}
          </dd>
        </div>
        {fact?.comment && <dd className="whitespace-pre-line text-slate-700">{fact.comment}</dd>}
        <div>
          <dt className="text-slate-500">Location</dt>
          <dd className="text-slate-800">
            <span className="flex items-start gap-1">
              <MapPin className="mt-px h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
              <span>
                Recorded: {loc ? formatCoordinate(loc.latitude, loc.longitude) : "none"}
                {loc?.accuracyMeters != null && <span className="text-slate-500"> (±{Math.round(loc.accuracyMeters)} m)</span>}
                {loc?.isMockLocation && <span className="font-semibold text-rose-700"> · simulated location, not used</span>}
                <span className="block">Stored: {stored ? formatCoordinate(stored.latitude, stored.longitude) : "none"}</span>
                {gap !== null && <span className="block">Distance: {formatDistance(gap)}</span>}
              </span>
            </span>
            {willMove && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">
                <MoveRight className="h-3 w-3" aria-hidden="true" />
                {willMove.from ? "Acceptance moves the site to the recorded location" : "Acceptance gives the site the recorded location"}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {photos.length > 0 && <Captures captures={photos} />}

      {rows.length > 0 && (
        <ul className="mt-2 space-y-2 border-t border-slate-100 pt-2" aria-label={`Facilities at site ${site.siteNumber}`}>
          {rows.map((r) => (
            <li key={r.rowId} className={`rounded-lg p-2 ${r.differs ? "border border-amber-300 bg-amber-50/60" : "bg-slate-50"}`}>
              <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                {r.differs && <AlertTriangle className="h-3 w-3 text-amber-700" aria-hidden="true" />}
                {r.facilityName} <span className="font-normal text-slate-500">({r.unitId})</span>
                {r.differs && <span className="text-[11px] font-semibold text-amber-800">Differs from the needs assessment</span>}
              </p>
              <table className="mt-1 w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th scope="col" className="font-normal" />
                    <th scope="col" className="font-semibold">
                      Needs assessment
                    </th>
                    <th scope="col" className="font-semibold">
                      Counted on site
                    </th>
                  </tr>
                </thead>
                <tbody className="text-slate-800">
                  <tr>
                    <th scope="row" className="pr-2 font-normal text-slate-500">
                      Quantity
                    </th>
                    <td className="tabular-nums">{r.recordedQuantity}</td>
                    <td className={`tabular-nums ${r.countedQuantity !== null && r.countedQuantity !== r.recordedQuantity ? "font-bold text-amber-900" : ""}`}>{r.countedQuantity ?? "–"}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="pr-2 font-normal text-slate-500">
                      Condition
                    </th>
                    <td>{EXISTING_CONDITION_LABELS[r.recordedCondition]}</td>
                    <td className={r.countedCondition && r.countedCondition !== r.recordedCondition ? "font-bold text-amber-900" : ""}>
                      {r.countedCondition ? EXISTING_CONDITION_LABELS[r.countedCondition] : "–"}
                    </td>
                  </tr>
                </tbody>
              </table>
              {r.matchesAssessment === false && <p className="mt-1 text-[11px] text-amber-900">The officer said it does not match the needs assessment.</p>}
              {r.comment && <p className="mt-1 whitespace-pre-line text-[11px] text-slate-700">{r.comment}</p>}
              {(rowPhotos.get(r.rowId) ?? []).length > 0 && <Captures captures={rowPhotos.get(r.rowId)!} />}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Photos as thumbnails (open full size in a new tab) and voice notes as players. */
function Captures({ captures }: { captures: NeedsVerificationCaptureDto[] }) {
  const photos = captures.filter((c) => c.kind === "PHOTO");
  const audio = captures.filter((c) => c.kind === "AUDIO");
  return (
    <div className="mt-2 space-y-2">
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((c) => (
            <li key={c.clientCaptureId}>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" className="group relative block h-20 w-20 overflow-hidden rounded-lg border border-slate-200" title={`Open full size (${formatDateTimeShort(c.capturedAt)})`}>
                  <img src={c.url} alt={`Photo taken ${formatDateTimeShort(c.capturedAt)}`} className="h-full w-full object-cover" loading="lazy" />
                  <ExternalLink className="absolute right-1 top-1 h-3 w-3 text-white opacity-0 drop-shadow group-hover:opacity-100" aria-hidden="true" />
                </a>
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-center text-[10px] text-slate-500">Not available</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {audio.map((c) =>
        c.url ? (
          <audio key={c.clientCaptureId} controls preload="none" src={c.url} className="h-8 w-full" aria-label={`Voice note recorded ${formatDateTimeShort(c.capturedAt)}`} />
        ) : null
      )}
    </div>
  );
}

/** Captures by the answer path they belong to: `n:site:<n>/…`, `n:row:<rowId>/…`, else other. */
function groupCaptures(captures: NeedsVerificationCaptureDto[]) {
  const site = new Map<number, NeedsVerificationCaptureDto[]>();
  const row = new Map<string, NeedsVerificationCaptureDto[]>();
  const other: NeedsVerificationCaptureDto[] = [];
  for (const c of captures) {
    const path = c.answerPath ?? "";
    const siteMatch = /^n:site:(\d+)\//.exec(path);
    const rowMatch = /^n:row:([^/]+)\//.exec(path);
    if (siteMatch) {
      const n = Number(siteMatch[1]);
      site.set(n, [...(site.get(n) ?? []), c]);
    } else if (rowMatch) {
      row.set(rowMatch[1], [...(row.get(rowMatch[1]) ?? []), c]);
    } else other.push(c);
  }
  return { site, row, other };
}

function ReviewForm({ v, movesCount, onDone }: { v: NeedsVerificationDto; movesCount: number; onDone: () => void }) {
  const review = useReviewVerificationMutation();
  const form = useZodForm(ReviewFormSchema, { defaultValues: { decision: "ACCEPT", reason: "", correctCoordinates: true } });
  const decision = form.watch("decision");
  const accepting = decision === "ACCEPT";
  const refused = review.error ? verificationFailureText(review.error, "Could not record the review.") : null;
  const photos = v.captures.filter((c) => c.kind === "PHOTO").length;

  return (
    <form
      className="space-y-3 rounded-xl border border-brand-primary/30 bg-brand-primary/[0.03] p-3"
      noValidate
      onSubmit={form.handleSubmit((body) =>
        // An acceptance keeps the drawer open: it reloads and shows what moved.
        review.mutate({ verificationId: v.id, body }, { onSuccess: () => body.decision === "RETURN" && onDone() })
      )}
      aria-label="Review the field verification"
    >
      <fieldset>
        <legend className={labelCls}>Your review</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["ACCEPT", "RETURN"] as const).map((d) => (
            <label key={d} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2 font-semibold ${decision === d ? "border-brand-primary bg-white" : "border-slate-200 hover:bg-white"}`}>
              <input type="radio" value={d} {...form.register("decision", { deps: ["reason"] })} />
              {d === "ACCEPT" ? "Accept" : "Return to the officer"}
            </label>
          ))}
        </div>
      </fieldset>
      {accepting ? (
        <div className="space-y-1">
          <label className="flex items-start gap-2 text-slate-800">
            <input type="checkbox" className="mt-0.5" {...form.register("correctCoordinates")} />
            <span>
              Correct the site coordinates
              <span className="block text-[11px] text-slate-500">
                {movesCount ? `${plural(movesCount, "site")} would move to the recorded location.` : "No site is far enough from its recorded location to move."}
              </span>
            </span>
          </label>
          <p className="text-[11px] text-slate-600">
            {photos ? `The ${plural(photos, "photo")} are filed as documents of the proposed project. ` : ""}
            {v.purpose === "VALIDATION" ? "The validation record can then use this field verification as its site verification." : ""}
          </p>
        </div>
      ) : (
        <div>
          <label className={labelCls} htmlFor="verification-return-reason">
            What the officer must redo <span className="text-rose-600">*</span>
          </label>
          <textarea id="verification-return-reason" rows={3} className={`${inputCls} ${invalidClass(form, "reason")}`} {...form.register("reason")} {...fieldA11y(form, "reason")} />
          <FieldError form={form} name="reason" />
        </div>
      )}
      {refused && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {refused}
        </p>
      )}
      <div className="flex justify-end">
        <SubmitButton form={form} pending={review.isPending} pendingLabel="Saving…" hint={accepting ? undefined : "Say what the officer must redo."}>
          {accepting ? "Accept the field verification" : "Return it"}
        </SubmitButton>
      </div>
    </form>
  );
}
