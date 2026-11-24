import React from 'react';
import type { FormChoiceOption, VisitFormAnswerInput } from '@insite/shared';
import { ChoiceChips } from './ChoiceChips';

export interface SingleChoiceInputProps {
  label: string;
  options: FormChoiceOption[];
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  /** The option key (never its label). */
  onChange: (key: string | null) => void;
}

/** SINGLE_CHOICE: one option key; tapping the chosen option clears it. */
export function SingleChoiceInput({ label, options, value, readOnly, onChange }: SingleChoiceInputProps) {
  return (
    <ChoiceChips
      groupLabel={label}
      options={options}
      selected={typeof value === 'string' ? [value] : []}
      disabled={readOnly}
      onToggle={(k) => onChange(value === k ? null : k)}
    />
  );
}
