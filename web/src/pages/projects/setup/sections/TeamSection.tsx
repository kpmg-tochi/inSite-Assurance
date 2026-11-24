import React, { useMemo, useState } from "react";
import { Search, Smartphone } from "lucide-react";
import { useTeamOptionsQuery } from "../../../../queries/projects/useProjectSetupQueries";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import type { ProjectSetupDto } from "@insite/shared";
import { TeamWorkloadNotice } from "../../../../components/supervision/SupervisorsCard";
import {
  extractErrors,
  inputClass,
  NO_ERRORS,
  StepSection,
  useLatestSetup,
  useRegisterSection,
  useSyncedState,
  type FormErrors,
  type StepProps,
} from "../setupContext";

const teamFrom = (setup: ProjectSetupDto) => ({ userIds: [...setup.team.userIds].sort() });
const teamKey = (v: { userIds: string[] }) => JSON.stringify([...v.userIds].sort());

/**
 * Section `team` (step 4 "Team & visits"): web users and provisioned mobile users with access.
 * Redesign R6a (D-R6.15): the mobilisation compliance panel moved to Kick-off & mobilisation.
 */
export function TeamSection({ projectId, setup, readOnly }: StepProps) {
  const options = useTeamOptionsQuery(projectId);
  const initial = useMemo(() => teamFrom(setup), [setup]);
  const [state, setState, dirty] = useSyncedState(initial, teamKey);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [search, setSearch] = useState("");
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);

  const users = (options.data?.users ?? []).filter((u) =>
    `${u.fullName} ${u.email} ${u.organizationName}`.toLowerCase().includes(search.toLowerCase())
  );
  const creatorId = setup.createdByUserId;

  useRegisterSection("team", dirty, async (opts) => {
    if (!dirty && !opts?.force) return true;
    try {
      await save.mutateAsync({ sectionId: "team", body: dirty ? state : teamFrom(latest()), silent: opts?.silent });
      setState(teamFrom(latest()));
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  const toggleUser = (id: string) =>
    setState((s) => ({ ...s, userIds: s.userIds.includes(id) ? s.userIds.filter((x) => x !== id) : [...s.userIds, id] }));
  return (
    <div className="space-y-5">
      <StepSection
        title="People with access"
        description="Web users assigned to this project. People in a pre-provisioned mobile role see the project on their phone once it is active."
      >
        {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input className={`${inputClass()} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" />
        </div>
        {options.isLoading ? (
          <p className="text-xs text-slate-500">Loading people…</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
            {users.map((u) => {
              const isCreator = u.id === creatorId && setup.status === "DRAFT";
              return (
                <label key={u.id} className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={state.userIds.includes(u.id) || isCreator}
                    onChange={() => toggleUser(u.id)}
                    disabled={readOnly || isCreator}
                  />
                  <span className="flex-1">
                    <span className="font-semibold text-slate-800">{u.fullName}</span>
                    <span className="text-slate-500"> · {u.roleName} · {u.organizationName}</span>
                    {isCreator && <span className="text-slate-400"> · started this draft</span>}
                  </span>
                  {u.mobileRoleName && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                      <Smartphone className="w-3 h-3" /> {u.mobileRoleName}
                    </span>
                  )}
                </label>
              );
            })}
            {users.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No one matches.</p>}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          People who can see every project in the workspace have access whether or not they are listed here.
        </p>
        {/* Phase 14: supervisors over the project type's site or distance limits (warning only) */}
        <TeamWorkloadNotice projectId={projectId} userIds={state.userIds} />
      </StepSection>
    </div>
  );
}
