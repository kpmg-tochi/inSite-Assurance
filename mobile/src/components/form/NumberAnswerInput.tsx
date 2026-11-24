import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { VisitFormAnswerInput, VisitFormSnapshotBlock, VisitFormSnapshotField } from '@insite/shared';
import { numberRangeText, numberToText, parseNumberText, plannedQuantityText } from '../../utils/formUiModel';
import { formStyles } from './formStyles';

export interface NumberAnswerInputProps {
  field: VisitFormSnapshotField;
  block: VisitFormSnapshotBlock;
  label: string;
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  onChange: (value: number | null) => void;
}

/**
 * NUMBER (with its unit, range and, on supply questions, "of {planned} {uom}") and PERCENTAGE (0–100).
 * The typed text stays local; the answer holds a number or nothing.
 */
export function NumberAnswerInput({ field, block, label, value, readOnly, onChange }: NumberAnswerInputProps) {
  const [text, setText] = useState(numberToText(value));
  const parsed = parseNumberText(text);
  const percent = field.type === 'PERCENTAGE';
  const suffix = percent ? '%' : field.unit;
  const planned = plannedQuantityText(field, block);
  const range = numberRangeText(field);
  const allowNegative = !percent && field.min !== null && field.min < 0;

  const onText = (t: string) => {
    setText(t);
    const p = parseNumberText(t);
    onChange(p.state === 'OK' ? p.value : null);
  };

  return (
    <View>
      <View style={formStyles.row}>
        <TextInput
          style={[formStyles.inputSingle, readOnly && formStyles.inputDisabled]}
          editable={!readOnly}
          keyboardType={allowNegative ? 'numbers-and-punctuation' : 'decimal-pad'}
          value={text}
          onChangeText={onText}
          placeholder={percent ? '0 to 100' : 'Number'}
          accessibilityLabel={[label, suffix ? `in ${suffix}` : null, planned].filter(Boolean).join(', ')}
        />
        {suffix ? <Text style={formStyles.suffix}>{suffix}</Text> : null}
        {planned ? <Text style={formStyles.suffix}>{planned}</Text> : null}
      </View>
      {range ? <Text style={formStyles.meta}>{range}</Text> : null}
      {parsed.state === 'INVALID' ? <Text style={formStyles.error}>Enter a number, for example 12 or 4.5</Text> : null}
    </View>
  );
}
