import React from 'react';
import type { VisitFormAnswerInput } from '@insite/shared';
import { ChoiceChips } from './ChoiceChips';

export interface YesNoInputProps {
  label: string;
  allowNa: boolean;
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  /** Follow-up check items: "Rectified" / "Not rectified" instead of Yes / No. */
  recheck?: boolean;
  onChange: (value: 'YES' | 'NO' | 'NA' | null) => void;
}

/** YES_NO: Yes / No, plus N/A when the question allows it. Tapping the chosen answer clears it. */
export function YesNoInput({ label, allowNa, value, readOnly, recheck = false, onChange }: YesNoInputProps) {
  const options = [
    { key: 'YES', label: recheck ? 'Rectified' : 'Yes' },
    { key: 'NO', label: recheck ? 'Not rectified' : 'No' },
    ...(allowNa ? [{ key: 'NA', label: 'N/A', accessibilityLabel: 'Not applicable' }] : []),
  ];
  return (
    <ChoiceChips
      groupLabel={label}
      options={options}
      selected={typeof value === 'string' ? [value] : []}
      disabled={readOnly}
      onToggle={(k) => onChange(value === k ? null : (k as 'YES' | 'NO' | 'NA'))}
    />
  );
}
