import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatProjectCode, type SupervisorWorkloadDto } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useSupervisorsQuery, useTeamWorkloadQuery } from "../../queries/supervision/useSupervisionQueries";
import { useTenantUsersQuery } from "../../queries/rbac/useRbacQueries";
import { useProjectsQuery } from "../../queries/projects/useProjectsQueries";
import { StandardTable, TableActionButton, type TableColumnDef } from "../table";
import { TAB_LIST_CLASS, tabCountClass, tabItemClass } from "../common/Tabs";
import { SupervisorDetailDrawer } from "./SupervisorDetailDrawer";
import { supervisorWarnings } from "./supervisorWarnings";

/**
 * Phase 14: supervision workload. A supervisor is a user whose role a project type lists as a
 * supervisor role; their sites are their assigned live projects. The system warns above the
 * project type's limits (sites per supervisor, distance between sites) and never blocks.
 *
 * UBEC: one table row per supervisor (search, warning filter, project type filter); the sites,
 * spread, limits and warnings open in a drawer.
 */

type WarningFilter = "ALL" | "OVER_SITES" | "OVER_SPREAD" | "NONE";

const FILTERS: Array<{ id: WarningFilter; label: string; match: (w: SupervisorWorkloadDto) => boolean }> = [
  { id: "ALL", label: "All", match: () => true },
  { id: "OVER_SITES", label: "Over the site limit", match: (w) => w.overSiteLimit },
  { id: "OVER_SPREAD", label: "Sites far apart", match: (w) => w.overSpread },
  { id: "NONE", label: "No warnings", match: (w) => !w.overSiteLimit && !w.overSpread },
];

const selectClass =
  "rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary";

export function SupervisorsCard() {
  const { hasPermission } = useAuth();
  const q = useSupervisorsQuery();
  // The workload DTO has no organisation: take it from the user directory when the caller may read it.
  const users = useTenantUsersQuery(hasPermission("users:invite_manage"));
  const projects = useProjectsQuery(true);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WarningFilter>("ALL");
  const [typeId, setTypeId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const orgByUser = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.organizationName])), [users.data]);
  const typeByProject = useMemo(
    () => new Map((projects.data ?? []).flatMap((p) => (p.projectType ? [[p.id, p.projectType] as const] : []))),
    [projects.data]
  );
  // Project types present among the supervisors' sites.
  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of rows) for (const p of w.projects) {
      const t = typeByProject.get(p.projectId);
      if (t) seen.set(t.id, t.name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, typeByProject]);

  const inType = (w: SupervisorWorkloadDto) => !typeId || w.projects.some((p) => typeByProject.get(p.projectId)?.id === typeId);
  const matchesSearch = (w: SupervisorWorkloadDto) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [w.fullName, w.roleName, orgByUser.get(w.userId) ?? "", ...w.projects.flatMap((p) => [p.codePrefix, formatProjectCode(p.codePrefix), p.name])].some((s) =>
      s.toLowerCase().includes(term)
    );
  };
  const base = rows.filter((w) => inType(w) && matchesSearch(w));
  const active = FILTERS.find((f) => f.id === filter)!;
  const shown = base.filter(active.match);
  const selected = rows.find((w) => w.userId === selectedId) ?? null;

  const columns: TableColumnDef<SupervisorWorkloadDto>[] = [
    {
      id: "name",
      header: "Supervisor",
      cell: (w) => {
        const org = orgByUser.get(w.userId);
        return (
          <div>
            <div className="font-semibold text-slate-900">{w.fullName}</div>
            <div className="text-[11px] text-slate-500">
              {w.roleName}
              {org ? ` · ${org}` : ""}
            </div>
          </div>
        );
      },
    },
    {
      id: "workload",
      header: "Workload",
      cell: (w) => {
        const warnings = supervisorWarnings(w);
        if (warnings.length > 0) {
          return (
            <span className="inline-flex items-start gap-1.5 font-semibold text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{warnings.join("; ")}</span>
            </span>
          );
        }
        return (
          <span className="text-slate-500">{w.maxSitesPerSupervisor === null && w.maxSpreadKm === null ? "No limits set" : "Within limits"}</span>
        );
      },
    },
    {
      id: "sites",
      header: "Sites",
      align: "right",
      width: "w-20",
      cell: (w) => <span className="tabular-nums text-slate-800">{w.activeProjectCount}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "w-32 whitespace-nowrap",
      cell: (w) => <TableActionButton onClick={() => setSelectedId(w.userId)}><span className="whitespace-nowrap">View sites</span></TableActionButton>,
    },
  ];

  if (q.isError) {
    return (
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 text-xs shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Supervisors</h2>
        <p className="mt-1 text-rose-700">
          The supervisors could not be loaded.{" "}
          <button type="button" onClick={() => q.refetch()} className="font-semibold underline">
            Try again
          </button>
        </p>
      </section>
    );
  }

  const filtersActive = Boolean(search.trim() || typeId || filter !== "ALL");

  return (
    <>
      <StandardTable<SupervisorWorkloadDto>
        title="Supervisors"
        subtitle="People in a project type's supervisor roles, with their live sites. Warnings never block an assignment."
        search={{ value: search, onChange: setSearch, placeholder: "Search name, organisation or project code" }}
        filters={
          <>
            <div role="group" aria-label="Show supervisors" className={TAB_LIST_CLASS}>
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={tabItemClass(filter === f.id)}>
                  {f.label}
                  <span className={tabCountClass(filter === f.id)}>{base.filter(f.match).length}</span>
                </button>
              ))}
            </div>
            {typeOptions.length > 1 && (
              <select aria-label="Project type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={selectClass}>
                <option value="">All project types</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </>
        }
        columns={columns}
        data={shown}
        keyExtractor={(w) => w.userId}
        onRowClick={(w) => setSelectedId(w.userId)}
        selectedId={selectedId}
        loading={q.isLoading}
        minWidth="min-w-[640px]"
        emptyState={
          filtersActive && rows.length > 0
            ? {
                title: "No supervisors match",
                description: "Clear the search or choose another filter.",
                action: (
                  <TableActionButton
                    onClick={() => {
                      setSearch("");
                      setFilter("ALL");
                      setTypeId("");
                    }}
                  >
                    Clear filters
                  </TableActionButton>
                ),
              }
            : {
                title: "No supervisors yet",
                description: "No project type names supervisor roles, or no one holds those roles.",
              }
        }
      />
      {selected && (
        <SupervisorDetailDrawer supervisor={selected} organizationName={orgByUser.get(selected.userId) ?? null} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}

/** Team step: warns when people on the team would supervise too many or too spread-out sites. */
export function TeamWorkloadNotice({ projectId, userIds }: { projectId: string; userIds: string[] }) {
  const q = useTeamWorkloadQuery(projectId, userIds);
  const over = (q.data ?? []).filter((w) => w.overSiteLimit || w.overSpread);
  const counted = (q.data ?? []).filter((w) => w.maxSitesPerSupervisor !== null || w.maxSpreadKm !== null);
  if (counted.length === 0) return null;
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${over.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`} aria-live="polite">
      <p className="font-semibold inline-flex items-center gap-1">
        {over.length > 0 && <AlertTriangle className="w-3.5 h-3.5" />} Supervision workload (with this project)
      </p>
      <ul className="mt-1 space-y-0.5">
        {counted.map((w) => (
          <li key={w.userId}>
            {w.fullName}: {w.activeProjectCount} site(s){w.spreadKm !== null ? `, ${w.spreadKm} km apart` : ""}
            {supervisorWarnings(w).length > 0 ? ` · ${supervisorWarnings(w).join("; ")}` : ""}
          </li>
        ))}
      </ul>
      {over.length > 0 && <p className="mt-1 text-[11px]">This is a warning only; you can still assign them.</p>}
    </div>
  );
}
