import React from 'react';
import { Text, View } from 'react-native';
import type { FormChoiceOption, VisitFormAnswerInput } from '@insite/shared';
import { ChoiceChips } from './ChoiceChips';
import { formStyles } from './formStyles';

export interface MultiChoiceInputProps {
  label: string;
  options: FormChoiceOption[];
  minSelected: number | null;
  maxSelected: number | null;
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  /** Option keys in the options' order. */
  onChange: (keys: string[] | null) => void;
}

/** MULTI_CHOICE: option keys, with the "pick at least / at most" hint. */
export function MultiChoiceInput({ label, options, minSelected, maxSelected, value, readOnly, onChange }: MultiChoiceInputProps) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (k: string) => {
    const next = selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k];
    const ordered = options.map((o) => o.key).filter((key) => next.includes(key));
    onChange(ordered.length > 0 ? ordered : null);
  };
  const hint = [minSelected ? `Pick at least ${minSelected}` : null, maxSelected ? `at most ${maxSelected}` : null].filter(Boolean).join(', ');
  return (
    <View>
      <ChoiceChips groupLabel={label} options={options} selected={selected} multi disabled={readOnly} onToggle={toggle} />
      <Text style={formStyles.meta}>{hint ? `${hint}. ` : ''}{selected.length} selected</Text>
    </View>
  );
}
