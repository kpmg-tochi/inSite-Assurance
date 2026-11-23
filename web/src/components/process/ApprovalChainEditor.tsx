import React, { useMemo } from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import {
  APPROVAL_ORGANIZATION_SCOPE_META,
  ApprovalOrganizationScopeEnum,
  MAX_APPROVAL_STEPS,
  type ApprovalOrganizationScope,
  DEFAULT_REVIEW_PERMISSION_KEY,
  REPORT_APPROVAL_PERMISSION_KEY,
  SYSTEM_PERMISSIONS_CATALOG,
  type ApprovalChainType,
  type ApprovalStepConfig,
  type ChainIssue,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../common";

export interface RoleOption {
  id: string;
  name: string;
}

const inputCls =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary disabled:bg-slate-50 disabled:text-slate-500";

const PERMISSION_OPTIONS: CustomSelectOption<string>[] = SYSTEM_PERMISSIONS_CATALOG.filter((p) => p.surface !== "MOBILE").map(
  (p) => ({ value: p.key, label: p.name, description: p.key })
);

/** Phase 11: limit a step to the owner's organisation, the owner or above, or the funder. */
const SCOPE_OPTIONS: CustomSelectOption<string>[] = ApprovalOrganizationScopeEnum.options.map((scope) => ({
  value: scope,
  label: APPROVAL_ORGANIZATION_SCOPE_META[scope].label,
  description: APPROVAL_ORGANIZATION_SCOPE_META[scope].description,
}));

export function permissionName(key: string): string {
  return SYSTEM_PERMISSIONS_CATALOG.find((p) => p.key === key)?.name ?? key;
}

/**
 * An ordered, editable approval chain. The disbursement chain's first (certification) and last
 * (release) steps are system steps: fixed in place, permission fixed, no threshold. Tenants add
 * review steps between them; only added disbursement steps take an amount threshold. Phase 13: the
 * contract default chain ends with a fixed decision step; review steps are added before it.
 */
export function ApprovalChainEditor({
  chainType,
  steps,
  onChange,
  disabled,
  roles,
  issues,
}: {
  chainType: ApprovalChainType;
  steps: ApprovalStepConfig[];
  onChange: (next: ApprovalStepConfig[]) => void;
  disabled?: boolean;
  /** Roles the person may pick from; empty when roles cannot be listed. */
  roles: RoleOption[];
  issues: ChainIssue[];
}) {
  const isContractDefault = chainType === "CONTRACT_DEFAULT";
  /** Chains whose last step is a fixed system step: new steps go before it. */
  const endsWithSystemStep = isContractDefault;
  const roleOptions = useMemo<CustomSelectOption<string>[]>(
    () => [{ value: "", label: "Any role with the permission" }, ...roles.map((r) => ({ value: r.id, label: r.name }))],
    [roles]
  );
  const chainIssues = issues.filter((i) => i.stepIndex === undefined);

  const update = (index: number, patch: Partial<ApprovalStepConfig>) =>
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = () => {
    const step: ApprovalStepConfig = {
      label: isContractDefault ? "Review" : `Approval step ${steps.length + 1}`,
      requiredPermissionKey: isContractDefault ? DEFAULT_REVIEW_PERMISSION_KEY : REPORT_APPROVAL_PERMISSION_KEY,
      requiredRoleId: null,
      minAmountThresholdNgn: null,
      isSystemStep: false,
      organizationScope: "ANY",
    };
    if (endsWithSystemStep && steps.length >= 1 && steps[steps.length - 1].isSystemStep) {
      // Added before the release (or decision) step.
      onChange([...steps.slice(0, -1), step, steps[steps.length - 1]]);
    } else {
      onChange([...steps, step]);
    }
  };

  /** A step can move only within the editable middle (disbursement) or anywhere (report). */
  const canMove = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return false;
    return !steps[index].isSystemStep && !steps[target].isSystemStep;
  };

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const stepIssues = issues.filter((i) => i.stepIndex === index);
          const fixed = step.isSystemStep;
          return (
            <li
              key={index}
              className={`rounded-xl border p-3 ${stepIssues.length ? "border-red-300 bg-red-50/40" : fixed ? "border-slate-200 bg-slate-50" : "border-slate-200"}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-[11px] font-bold text-brand-primary">
                  {index + 1}
                </span>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2 min-w-0">
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5" htmlFor={`${chainType}-label-${index}`}>
                      Step name
                    </label>
                    <input
                      id={`${chainType}-label-${index}`}
                      className={inputCls}
                      value={step.label}
                      disabled={disabled}
                      maxLength={120}
                      onChange={(e) => update(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-4">
                    <p className="block text-[11px] font-semibold text-slate-600 mb-0.5">Permission required</p>
                    {fixed ? (
                      <p className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700" title={step.requiredPermissionKey}>
                        <Lock className="w-3 h-3 text-slate-400" /> {permissionName(step.requiredPermissionKey)}
                      </p>
                    ) : (
                      <CustomSelect
                        value={step.requiredPermissionKey}
                        onChange={(v) => update(index, { requiredPermissionKey: v })}
                        options={PERMISSION_OPTIONS}
                        searchable
                        size="sm"
                        disabled={disabled}
                      />
                    )}
                  </div>
                  <div className="md:col-span-4">
                    <p className="block text-[11px] font-semibold text-slate-600 mb-0.5">Role (optional)</p>
                    <CustomSelect
                      value={step.requiredRoleId ?? ""}
                      onChange={(v) => update(index, { requiredRoleId: v || null })}
                      options={
                        step.requiredRoleId && !roles.some((r) => r.id === step.requiredRoleId)
                          ? [...roleOptions, { value: step.requiredRoleId, label: "Role set earlier" }]
                          : roleOptions
                      }
                      size="sm"
                      disabled={disabled || roles.length === 0}
                      searchable={roles.length > 8}
                    />
                  </div>
                  <div className="md:col-span-6">
                    <p className="block text-[11px] font-semibold text-slate-600 mb-0.5">Organisation (optional)</p>
                    <CustomSelect
                      value={step.organizationScope ?? "ANY"}
                      onChange={(v) => update(index, { organizationScope: v as ApprovalOrganizationScope })}
                      options={SCOPE_OPTIONS}
                      size="sm"
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1 pt-5">
                  {fixed ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400" title={isContractDefault ? "The decision step cannot be removed or moved." : "Certification and release steps cannot be removed or moved."}>
                      Fixed
                    </span>
                  ) : (
                    !disabled && (
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label="Move step up" disabled={!canMove(index, -1)} onClick={() => move(index, -1)} className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" aria-label="Move step down" disabled={!canMove(index, 1)} onClick={() => move(index, 1)} className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" aria-label="Remove step" onClick={() => remove(index)} className="rounded-lg border border-rose-200 p-1 text-rose-600 hover:bg-rose-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
              {stepIssues.map((issue, i) => (
                <p key={i} className="mt-1 pl-9 text-[11px] font-medium text-red-600">
                  {issue.message}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
      {chainIssues.map((issue, i) => (
        <p key={i} className="text-[11px] font-medium text-red-600">
          {issue.message}
        </p>
      ))}
      {!disabled && steps.length < MAX_APPROVAL_STEPS && (
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Plus className="w-3.5 h-3.5" /> {isContractDefault ? "Add a review step before the decision" : "Add a step"}
        </button>
      )}
    </div>
  );
}
