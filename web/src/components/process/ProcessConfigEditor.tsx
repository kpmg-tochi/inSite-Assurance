import React from "react";
import { Lock } from "lucide-react";
import {
  DISBURSEMENT_MECHANISM_META,
  DisbursementMechanismEnum,
  DOCUMENT_MODE_META,
  NeedsAssessmentModeEnum,
  PROCESS_TOGGLE_META,
  type DisbursementMechanism,
  type NeedsAssessmentMode,
  type ProjectProcessConfig,
} from "@insite/shared";

type ToggleKey = keyof typeof PROCESS_TOGGLE_META;
const TOGGLE_KEYS = Object.keys(PROCESS_TOGGLE_META) as ToggleKey[];

function ModeGroup({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: NeedsAssessmentMode;
  onChange: (v: NeedsAssessmentMode) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="block text-xs font-semibold text-slate-700 mb-1">{label}</p>
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label={label}>
        {NeedsAssessmentModeEnum.options.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed ${
              value === m ? "bg-white text-brand-primary shadow-xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {DOCUMENT_MODE_META[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Document modes, disbursement mechanism and the on/off switches of a project process. */
export function ProcessConfigEditor({
  value,
  onChange,
  onMechanismChange,
  disabled,
  mechanismLocked,
}: {
  value: ProjectProcessConfig;
  onChange: (next: ProjectProcessConfig) => void;
  /** The mechanism also changes the certification step of the chain. */
  onMechanismChange: (m: DisbursementMechanism) => void;
  disabled?: boolean;
  mechanismLocked?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ModeGroup
          label="Project standards"
          value={value.standardsSpecificationMode}
          onChange={(m) => onChange({ ...value, standardsSpecificationMode: m })}
          disabled={disabled}
        />
        <ModeGroup
          label="Needs-assessment documents"
          value={value.needsAssessmentMode}
          onChange={(m) => onChange({ ...value, needsAssessmentMode: m })}
          disabled={disabled}
        />
      </div>

      <div>
        <p className="block text-xs font-semibold text-slate-700 mb-1">How money is released</p>
        {mechanismLocked && (
          <p className="mb-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Lock className="w-3 h-3" /> Locked: an IPC or valuation already exists on this project.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label="Disbursement mechanism">
          {DisbursementMechanismEnum.options.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={value.disbursementMechanism === m}
              disabled={disabled || mechanismLocked}
              onClick={() => onMechanismChange(m)}
              className={`text-left rounded-xl border p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed ${
                value.disbursementMechanism === m
                  ? "border-brand-primary bg-brand-primary/5"
                  : "border-slate-200 hover:border-slate-300 disabled:opacity-60"
              }`}
            >
              <p className="text-xs font-bold text-slate-900">{DISBURSEMENT_MECHANISM_META[m].label}</p>
              <p className="mt-1 text-[11px] text-slate-500">{DISBURSEMENT_MECHANISM_META[m].description}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="block text-xs font-semibold text-slate-700 mb-2">Modules and checks</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {TOGGLE_KEYS.map((key) => {
            const id = `process-toggle-${key}`;
            return (
              <label
                key={key}
                htmlFor={id}
                className={`flex items-start gap-3 rounded-xl border border-slate-200 p-3 ${disabled ? "opacity-75" : "cursor-pointer hover:border-slate-300"}`}
              >
                <input
                  id={id}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-brand-primary"
                  checked={value[key]}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                />
                <span>
                  <span className="block text-xs font-bold text-slate-900">{PROCESS_TOGGLE_META[key].label}</span>
                  <span className="block text-[11px] text-slate-500">{PROCESS_TOGGLE_META[key].description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
