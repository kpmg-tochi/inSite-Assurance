import React, { useEffect, useState } from "react";
import {
  CREDENTIAL_REQUIREMENT_META,
  CREDENTIAL_SUBJECT_META,
  type CredentialRequirement,
  type CredentialSubject,
  type RegistrationBodyDto,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../common";
import Loader from "../Loader";
import { useCredentialSettingsQuery } from "../../queries/credentials/useCredentialQueries";
import {
  useDeleteRegistrationBodyMutation,
  useSaveRegistrationBodyMutation,
  useUpdateCredentialPolicyMutation,
} from "../../mutations/credentials/useCredentialMutations";

type PolicyChoice = CredentialRequirement | "DEFAULT";

const POLICY_OPTIONS: CustomSelectOption<PolicyChoice>[] = [
  { value: "DEFAULT", label: "Platform default (required)", description: "Today's behaviour: a registration is needed." },
  ...(["REQUIRED", "OPTIONAL", "HIDDEN"] as const).map((v) => ({
    value: v,
    label: CREDENTIAL_REQUIREMENT_META[v].label,
    description: CREDENTIAL_REQUIREMENT_META[v].description,
  })),
];

const SUBJECTS: CredentialSubject[] = ["certifier", "fieldAssurance"];

const emptyBody = { code: "", fullName: "", displayPrefix: "", exampleNumber: "" };

/**
 * Phase 12: professional registration settings. The tenant policy for certifiers and for field
 * identity assurance (a project type can override either), and the tenant's registration bodies.
 */
export function ProfessionalRegistrationCard() {
  const { data, isLoading } = useCredentialSettingsQuery();
  const savePolicy = useUpdateCredentialPolicyMutation();
  const saveBody = useSaveRegistrationBodyMutation();
  const deleteBody = useDeleteRegistrationBodyMutation();
  const [policy, setPolicy] = useState<Record<CredentialSubject, PolicyChoice>>({ certifier: "DEFAULT", fieldAssurance: "DEFAULT" });
  const [editing, setEditing] = useState<{ id: string | null; draft: typeof emptyBody } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!data) return;
    setPolicy({ certifier: data.policy.certifier ?? "DEFAULT", fieldAssurance: data.policy.fieldAssurance ?? "DEFAULT" });
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader size="sm" />
      </div>
    );
  }

  const policyDirty =
    policy.certifier !== (data.policy.certifier ?? "DEFAULT") || policy.fieldAssurance !== (data.policy.fieldAssurance ?? "DEFAULT");

  const handleSavePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    savePolicy.mutate({
      certifier: policy.certifier === "DEFAULT" ? null : policy.certifier,
      fieldAssurance: policy.fieldAssurance === "DEFAULT" ? null : policy.fieldAssurance,
    });
  };

  const startEdit = (b: RegistrationBodyDto | null) =>
    setEditing({
      id: b?.id ?? null,
      draft: b ? { code: b.code, fullName: b.fullName, displayPrefix: b.displayPrefix, exampleNumber: b.exampleNumber ?? "" } : emptyBody,
    });

  const handleSaveBody = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const d = editing.draft;
    try {
      await saveBody.mutateAsync({
        bodyId: editing.id,
        payload: {
          code: d.code.trim().toUpperCase(),
          fullName: d.fullName.trim(),
          displayPrefix: d.displayPrefix.trim(),
          exampleNumber: d.exampleNumber.trim() || null,
        },
      });
      setEditing(null);
    } catch {
      // toasted by the mutation hook
    }
  };

  const bodies = data.registrationBodies.filter((b) => showArchived || !b.isArchived);
  const draftValid =
    editing &&
    /^[A-Z][A-Z0-9_]{1,15}$/.test(editing.draft.code.trim().toUpperCase()) &&
    editing.draft.fullName.trim().length >= 3 &&
    editing.draft.displayPrefix.trim().length >= 2;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Professional registration</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Whether certifiers and field staff must give a professional registration (for example QSRBN or COREN). Required blocks the
          action without one; optional shows the field and prints it when given; hidden never asks or prints it. A project type can
          override this. Permissions and segregation of duties apply either way.
        </p>
      </div>

      <form onSubmit={handleSavePolicy} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SUBJECTS.map((subject) => (
            <div key={subject} className="rounded-xl border border-slate-200 p-3 text-xs space-y-2">
              <div>
                <p className="font-semibold text-slate-800">{CREDENTIAL_SUBJECT_META[subject].label}</p>
                <p className="text-[11px] text-slate-500">{CREDENTIAL_SUBJECT_META[subject].description}</p>
              </div>
              <CustomSelect
                value={policy[subject]}
                onChange={(v) => setPolicy((p) => ({ ...p, [subject]: v }))}
                options={POLICY_OPTIONS}
              />
            </div>
          ))}
        </div>
        {!data.profileFieldVisible && (
          <p className="text-[11px] text-slate-500">Registration is hidden everywhere, so user forms do not show the registration fields.</p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!policyDirty || savePolicy.isPending}
            className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-50"
          >
            {savePolicy.isPending ? "Saving…" : "Save policy"}
          </button>
        </div>
      </form>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-slate-900">Registration bodies</h4>
            <p className="text-[11px] text-slate-500">
              The list people choose from. A body named on a profile or certificate is archived instead of deleted, so old certificates
              still print correctly.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-slate-600">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            <button
              type="button"
              onClick={() => startEdit(null)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-slate-700"
            >
              Add body
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Printed as</th>
                <th className="text-right px-3 py-2">Users</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {bodies.map((b) => (
                <tr key={b.id} className={`border-t border-slate-100 ${b.isArchived ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2 font-semibold text-slate-900">
                    {b.code}
                    {b.isArchived && <span className="ml-1.5 text-[10px] font-semibold text-slate-400">archived</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{b.fullName}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {b.displayPrefix} {b.exampleNumber ?? ""}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{b.userCount}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-2">
                    <button type="button" onClick={() => startEdit(b)} className="font-semibold text-brand-primary">
                      Edit
                    </button>
                    {b.isArchived ? (
                      <button
                        type="button"
                        onClick={() =>
                          saveBody.mutate({
                            bodyId: b.id,
                            payload: { code: b.code, fullName: b.fullName, displayPrefix: b.displayPrefix, exampleNumber: b.exampleNumber, isArchived: false },
                          })
                        }
                        className="font-semibold text-slate-600"
                      >
                        Restore
                      </button>
                    ) : (
                      <button type="button" onClick={() => deleteBody.mutate(b.id)} className="font-semibold text-rose-700">
                        {b.userCount > 0 ? "Archive" : "Delete"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {bodies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    No registration bodies.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editing && (
          <form onSubmit={handleSaveBody} className="rounded-xl border border-brand-primary/30 bg-brand-primary/5 p-3 text-xs space-y-2">
            <p className="font-semibold text-slate-800">{editing.id ? "Edit registration body" : "Add registration body"}</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              {(
                [
                  ["code", "Code", "QSRBN"],
                  ["fullName", "Full name", "Quantity Surveyors Registration Board of Nigeria"],
                  ["displayPrefix", "Printed before the number", "QSRBN Reg. No."],
                  ["exampleNumber", "Example number (optional)", "3842"],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key} className="block font-medium text-slate-700">
                  {label}
                  <input
                    type="text"
                    value={editing.draft[key]}
                    placeholder={placeholder}
                    onChange={(e) => setEditing((x) => (x ? { ...x, draft: { ...x.draft, [key]: e.target.value } } : x))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!draftValid || saveBody.isPending}
                className="px-3 py-1.5 rounded-xl bg-brand-primary text-white font-semibold disabled:opacity-50"
              >
                {saveBody.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
