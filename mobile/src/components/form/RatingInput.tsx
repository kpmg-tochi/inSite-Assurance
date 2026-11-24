import React from 'react';
import { Text, View } from 'react-native';
import type { VisitFormAnswerInput } from '@insite/shared';
import { ChoiceChips } from './ChoiceChips';
import { formStyles } from './formStyles';

export interface RatingInputProps {
  label: string;
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  onChange: (value: number | null) => void;
}

/** RATING_1_5: 1 (poor) to 5 (very good); tapping the chosen rating clears it. */
export function RatingInput({ label, value, readOnly, onChange }: RatingInputProps) {
  const options = [1, 2, 3, 4, 5].map((n) => ({ key: String(n), label: String(n), accessibilityLabel: `${n} of 5` }));
  return (
    <View>
      <ChoiceChips
        groupLabel={label}
        options={options}
        selected={typeof value === 'number' ? [String(value)] : []}
        disabled={readOnly}
        onToggle={(k) => onChange(value === Number(k) ? null : Number(k))}
      />
      <Text style={formStyles.meta}>1 = poor, 5 = very good{typeof value === 'number' ? `. Chosen: ${value} of 5` : ''}</Text>
    </View>
  );
}
