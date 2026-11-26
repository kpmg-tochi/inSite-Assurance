import React, { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, HardHat } from "lucide-react";
import {
  CONTRACTOR_STATUS_LABELS,
  ChangeContractorStatusRequestSchema,
  ContractorStatusEnum,
  formatProjectCode,
  stateByCode,
  type ContractorDetailDto,
  type ContractorFlagDto,
  type ContractorProjectDto,
  type ContractorStatus,
} from "@insite/shared";
import Loader from "../../components/Loader";
import { ModalShell } from "../../components/common/ModalShell";
import { StandardTable, type TableColumnDef } from "../../components/table";
import { ContractorStars, ContractorStatusChip, StarRow } from "../../components/contractors/ContractorStars";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { formatNaira } from "../../lib/formatters";
import { useContractorQuery } from "../../queries/contractors";
import { useChangeContractorStatusMutation } from "../../mutations/contractors";
import { stateNames } from "../../components/contractors/contractorUi";
import { ContractorFlagCard } from "../../components/contractorFlags/ContractorFlagCard";
import { FlagDecisionDrawer } from "../../components/contractorFlags/FlagDecisionDrawer";
import { OpenFlagCountChip } from "../../components/contractorFlags/flagUi";
import { useContractorFlagsQuery } from "../../queries/contractorFlags";

const STANDING: Record<ContractorProjectDto["standing"], { label: string; cls: string }> = {
  CURRENT: { label: "Current", cls: "bg-brand-primary/5 text-brand-primary border-brand-primary/25" },
  DRAFT: { label: "Being set up", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  COMPLETED: { label: "Completed", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  TERMINATED: { label: "Terminated", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

const STATUS_ACTION: Record<ContractorStatus, string> = { ACTIVE: "Set active", INACTIVE: "Set inactive", SUSPENDED: "Suspend" };

/**
 * Client demo updates F.1 (wave 2): one contractor (`/app/contractors/:contractorId`): profile,
 * status (changed with a reason by `contractors:manage`), the rating with each component and what
 * it is based on, and its projects, current and previous. Wave 3 (F.4): its performance flags, open
 * and closed; "Review flag" (or `?flag=<id>`, used by notifications) opens the decision drawer.
 */
export function ContractorDetailPage() {
  const { contractorId } = useParams();
  const query = useContractorQuery(contractorId);
  const [changing, setChanging] = useState<ContractorStatus | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const flags = useContractorFlagsQuery({ organizationId: contractorId }, Boolean(contractorId));
  const reviewingId = searchParams.get("flag");
  const setReviewing = (flagId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (flagId) next.set("flag", flagId);
    else next.delete("flag");
    setSearchParams(next, { replace: true });
  };
  if (query.isLoading) return <Loader />;
  if (query.isError || !query.data) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">This contractor is not available to you.</div>;
  }
  const c = query.data;
  const others = ContractorStatusEnum.options.filter((s) => s !== c.status);

  return (
    <div className="space-y-5">
      <Link to="/app/contractors" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Contractors
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <HardHat className="mt-1 h-5 w-5 text-brand-primary" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">{c.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <ContractorStatusChip status={c.status} />
              {c.status === "INACTIVE" && <span>{CONTRACTOR_STATUS_LABELS[c.status]}</span>}
              <OpenFlagCountChip count={c.openFlagCount} />
            </div>
          </div>
        </div>
        {c.canManage && (
          <div className="flex flex-wrap gap-2">
            {others.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setChanging(s)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  s === "SUSPENDED" ? "border-rose-300 text-rose-700 hover:bg-rose-50" : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {STATUS_ACTION[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Profile c={c} />
        <Rating c={c} />
      </div>

      <FlagsSection flags={flags.data} loading={flags.isLoading} failed={flags.isError} onReview={setReviewing} />

      <ProjectsTable projects={c.projects} />

      {changing && <StatusDialog contractor={c} to={changing} onClose={() => setChanging(null)} />}
      {reviewingId && (
        <FlagDecisionDrawer
          flagId={reviewingId}
          initialFlag={flags.data?.find((f) => f.id === reviewingId)}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}

function Profile({ c }: { c: ContractorDetailDto }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["CAC registration number", c.registrationNumber ?? "–"],
    ["TIN", c.tin ?? "–"],
    ["Address", c.address ?? "–"],
    ["State", stateByCode(c.stateCode)?.name ?? c.stateCode ?? "–"],
    ["Email", c.contactEmail ?? "–"],
    ["Phone", c.contactPhone ?? "–"],
    ["States worked in", c.statesWorkedIn.length ? stateNames(c.statesWorkedIn) : "–"],
    ["Projects", `${c.activeProjectCount} active, ${c.completedProjectCount} completed`],
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Profile</h2>
      <dl className="mt-3 space-y-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-5 gap-2">
            <dt className="col-span-2 text-slate-500">{k}</dt>
            <dd className="col-span-3 font-medium text-slate-800 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Rating({ c }: { c: ContractorDetailDto }) {
  const r = c.rating;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Reliability rating</h2>
        {r.computedAt && (
          <span className="text-[11px] text-slate-500">
            Calculated {new Date(r.computedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
      </div>
      <div className="mt-2">
        <ContractorStars rating={r} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        From approved data only: accepted monitoring reports, verified work phases, findings and closure ratings. Recent reports count
        more. Rating is information from past monitoring; the award follows procurement.
      </p>
      {r.components.length > 0 && (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1.5 pr-2 font-semibold">Component</th>
              <th className="py-1.5 pr-2 font-semibold">Score</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Weight</th>
              <th className="py-1.5 font-semibold">Based on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.components.map((k) => (
              <tr key={k.key} className="align-top">
                <td className="py-2 pr-2 font-medium text-slate-800">{k.label}</td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {k.score === null ? (
                    <span className="text-slate-500">Not scored</span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <StarRow stars={Math.round(k.score * 2) / 2} size="h-3 w-3" />
                      <span className="font-semibold">{k.score.toFixed(1)}</span>
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2 text-right text-slate-600">{k.score === null ? "–" : `${Math.round(k.weight * 100)}%`}</td>
                <td className="py-2 text-slate-600">{k.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.components.length === 0 && <p className="mt-3 text-xs text-slate-500">No rating calculated yet. Use Refresh ratings on the register.</p>}
    </section>
  );
}

function FlagsSection({
  flags,
  loading,
  failed,
  onReview,
}: {
  flags: ContractorFlagDto[] | undefined;
  loading: boolean;
  failed: boolean;
  onReview: (flagId: string) => void;
}) {
  const list = flags ?? [];
  const open = list.filter((f) => f.status === "OPEN");
  const closed = list.filter((f) => f.status === "CLOSED");
  return (
    <section aria-labelledby="contractor-flags-heading" className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="contractor-flags-heading" className="text-sm font-bold text-slate-900">
        Performance flags
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Raised on a project when accepted monitoring reports rate workmanship low under the workspace rule. Each action is decided with a reason.
      </p>
      {loading ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden="true" />
      ) : failed ? (
        <p className="mt-3 text-xs text-rose-700">The flags could not be loaded.</p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-xs text-slate-600">No flags raised.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {open.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-rose-700">Open ({open.length})</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {open.map((f) => (
                  <ContractorFlagCard key={f.id} flag={f} onReview={() => onReview(f.id)} />
                ))}
              </div>
            </div>
          )}
          {closed.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-600">Closed ({closed.length})</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {closed.map((f) => (
                  <ContractorFlagCard key={f.id} flag={f} onReview={() => onReview(f.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectsTable({ projects }: { projects: ContractorProjectDto[] }) {
  const columns: TableColumnDef<ContractorProjectDto>[] = [
    {
      id: "project",
      header: "Project",
      cell: (p) => (
        <Link to={`/app/projects/${p.projectId}/dashboard`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          <span className="font-semibold text-slate-900">{formatProjectCode(p.codePrefix)}</span>
          <span className="block text-[11px] text-slate-500">{p.name}</span>
        </Link>
      ),
    },
    { id: "year", header: "Year", cell: (p) => p.interventionYear ?? "–" },
    { id: "state", header: "State", cell: (p) => stateByCode(p.stateCode)?.name ?? p.stateCode ?? "–" },
    {
      id: "standing",
      header: "Standing",
      cell: (p) => (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STANDING[p.standing].cls}`}>{STANDING[p.standing].label}</span>
      ),
    },
    { id: "sum", header: "Contract sum", align: "right", cell: (p) => (p.contractSumNgn === null ? "–" : formatNaira(p.contractSumNgn)) },
    { id: "progress", header: "Progress", align: "right", cell: (p) => `${Math.round(p.progressPct)}%` },
    { id: "reports", header: "Reports", align: "right", tooltip: "Accepted monitoring reports with a workmanship rating", cell: (p) => p.reportCount },
    {
      id: "workmanship",
      header: "Workmanship",
      align: "right",
      cell: (p) => (p.averageWorkmanship === null ? "–" : `${p.averageWorkmanship.toFixed(1)} of 5`),
    },
  ];
  return (
    <StandardTable<ContractorProjectDto>
      title="Projects"
      subtitle="Current first, then previous"
      columns={columns}
      data={projects}
      keyExtractor={(p) => p.projectId}
      emptyState={{ title: "No projects yet", description: "The contractor has not been named on a project." }}
    />
  );
}

function StatusDialog({ contractor, to, onClose }: { contractor: ContractorDetailDto; to: ContractorStatus; onClose: () => void }) {
  const form = useZodForm(ChangeContractorStatusRequestSchema, { defaultValues: { status: to, reason: "" } });
  const change = useChangeContractorStatusMutation(contractor.id);
  return (
    <ModalShell title={`${STATUS_ACTION[to]}: ${contractor.name}`} subtitle={`New status: ${CONTRACTOR_STATUS_LABELS[to]}`} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={form.handleSubmit((body) => change.mutate(body, { onSuccess: onClose }))}>
        {to === "SUSPENDED" && (
          <p className="text-xs text-slate-600">A suspended contractor cannot be named on a new project. Its current projects continue.</p>
        )}
        <div>
          <label htmlFor="contractor-status-reason" className="mb-1 block text-xs font-semibold text-slate-700">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            id="contractor-status-reason"
            rows={3}
            className={`w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary ${invalidClass(form, "reason")}`}
            {...form.register("reason")}
            {...fieldA11y(form, "reason")}
          />
          <FieldError form={form} name="reason" />
          <p className="mt-1 text-[11px] text-slate-500">Recorded in the audit ledger.</p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={change.isPending} pendingLabel="Saving…">
            {STATUS_ACTION[to]}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
