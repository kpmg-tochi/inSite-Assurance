import React from "react";
import {
  DOCUMENT_MODE_META,
  NeedsAssessmentModeEnum,
  PROCESS_TOGGLE_META,
  type NeedsAssessmentMode,
  type ProjectProcessConfig,
} from "@insite/shared";
import { TAB_LIST_CLASS, tabItemClass } from "../common/Tabs";

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
      <div className={TAB_LIST_CLASS} role="radiogroup" aria-label={label}>
        {NeedsAssessmentModeEnum.options.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`${tabItemClass(value === m)} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {DOCUMENT_MODE_META[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Document modes and the on/off switches of a project process. */
export function ProcessConfigEditor({
  value,
  onChange,
  disabled,
}: {
  value: ProjectProcessConfig;
  onChange: (next: ProjectProcessConfig) => void;
  disabled?: boolean;
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
