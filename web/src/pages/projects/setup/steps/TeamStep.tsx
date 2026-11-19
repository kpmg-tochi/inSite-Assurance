import React, { useMemo, useState } from "react";
import { Search, Smartphone } from "lucide-react";
import { useTeamOptionsQuery } from "../../../../queries/projects/useProjectSetupQueries";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import {
  extractErrors,
  inputClass,
  NO_ERRORS,
  StepSection,
  useRegisterStep,
  type FormErrors,
  type StepProps,
} from "../setupContext";

export function TeamStep({ projectId, setup, readOnly, mode }: StepProps) {
  const options = useTeamOptionsQuery(projectId);
  const initial = useMemo(
    () => ({ userIds: [...setup.team.userIds].sort(), joinCodeRoleIds: setup.team.joinCodeRoleIds }),
    [setup.team]
  );
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [search, setSearch] = useState("");
  const save = useSaveSetupStepMutation(projectId);
  const dirty = JSON.stringify({ ...state, userIds: [...state.userIds].sort() }) !== JSON.stringify(initial);

  const joinCodeRoles = (options.data?.roles ?? []).filter((r) => r.onboardingMode === "JOIN_CODE");
  const provisionedRoles = (options.data?.roles ?? []).filter((r) => r.onboardingMode === "PROVISIONED_ACCOUNT");
  const selectedRoleIds = state.joinCodeRoleIds ?? joinCodeRoles.map((r) => r.id);
  const users = (options.data?.users ?? []).filter((u) =>
    `${u.fullName} ${u.email} ${u.organizationName}`.toLowerCase().includes(search.toLowerCase())
  );
  const creatorId = setup.createdByUserId;

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    try {
      await save.mutateAsync({ stepId: "team", body: state, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  const toggleUser = (id: string) =>
    setState((s) => ({ ...s, userIds: s.userIds.includes(id) ? s.userIds.filter((x) => x !== id) : [...s.userIds, id] }));
  const toggleRole = (id: string) => {
    const next = selectedRoleIds.includes(id) ? selectedRoleIds.filter((x) => x !== id) : [...selectedRoleIds, id];
    setState((s) => ({ ...s, joinCodeRoleIds: next }));
  };

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
      </StepSection>

      <StepSection
        title="Join codes"
        description={
          mode === "settings" || setup.status !== "DRAFT"
            ? "Codes were issued when the project was set active. Manage them from the project's join codes panel."
            : "Codes are issued when the project is set active. Contractor field roles get one code per contractor with field reporting on."
        }
      >
        <div className="space-y-2">
          {joinCodeRoles.map((r) => (
            <label key={r.id} className="flex items-center gap-3 text-xs">
              <input
                type="checkbox"
                checked={selectedRoleIds.includes(r.id)}
                onChange={() => toggleRole(r.id)}
                disabled={readOnly || setup.status !== "DRAFT"}
              />
              <span className="font-semibold text-slate-800">{r.name}</span>
              <span className="text-slate-500">
                {r.fieldPersonaType === "CONTRACTOR_EXECUTOR" ? "contractor field role" : "independent field role"}
                {r.requiresIdentityAssurance ? " · identity check" : ""}
              </span>
            </label>
          ))}
          {joinCodeRoles.length === 0 && !options.isLoading && <p className="text-xs text-slate-500">No join-code mobile roles in this workspace.</p>}
        </div>
        {provisionedRoles.length > 0 && (
          <p className="text-[11px] text-slate-500">
            {provisionedRoles.map((r) => r.name).join(", ")} sign in with their account and need no code.
          </p>
        )}
      </StepSection>
    </div>
  );
}
