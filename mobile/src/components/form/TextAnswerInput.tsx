import React from 'react';
import { TextInput } from 'react-native';
import { FORM_LONG_TEXT_MAX, FORM_SHORT_TEXT_MAX, type VisitFormAnswerInput } from '@insite/shared';
import { formStyles } from './formStyles';

export interface TextAnswerInputProps {
  label: string;
  long: boolean;
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  onChange: (value: string | null) => void;
}

/** SHORT_TEXT (one line, 300) and LONG_TEXT (several lines, 4000). */
export function TextAnswerInput({ label, long, value, readOnly, onChange }: TextAnswerInputProps) {
  return (
    <TextInput
      style={[long ? formStyles.input : [formStyles.inputSingle, { marginTop: 10 }], readOnly && formStyles.inputDisabled]}
      multiline={long}
      editable={!readOnly}
      value={typeof value === 'string' ? value : ''}
      onChangeText={(t) => onChange(t.length > 0 ? t : null)}
      maxLength={long ? FORM_LONG_TEXT_MAX : FORM_SHORT_TEXT_MAX}
      placeholder={long ? 'Write your answer' : 'Answer'}
      accessibilityLabel={label}
    />
  );
}
