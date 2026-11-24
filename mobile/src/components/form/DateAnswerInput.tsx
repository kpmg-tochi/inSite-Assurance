import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { VisitFormAnswerInput } from '@insite/shared';
import { parseDateText, shiftDate } from '../../utils/formUiModel';
import { projectToday } from '../../utils/visitCalendar';
import { formStyles } from './formStyles';

export interface DateAnswerInputProps {
  label: string;
  value: VisitFormAnswerInput['value'];
  readOnly: boolean;
  /** The project zone: "Today" is the project's today. */
  timeZone: string | null;
  onChange: (value: string | null) => void;
}

/**
 * DATE: typed as YYYY-MM-DD or DD/MM/YYYY, with Today and one-day steps (no date picker dependency;
 * D-R5.1). Stored as YYYY-MM-DD.
 */
export function DateAnswerInput({ label, value, readOnly, timeZone, onChange }: DateAnswerInputProps) {
  const stored = typeof value === 'string' ? value : '';
  const [text, setText] = useState(stored);
  const invalid = text.trim() !== '' && parseDateText(text) === null;

  const set = (iso: string | null) => {
    setText(iso ?? '');
    onChange(iso);
  };
  const onText = (t: string) => {
    setText(t);
    onChange(parseDateText(t));
  };
  const base = parseDateText(text) ?? projectToday(timeZone);

  return (
    <View>
      <View style={formStyles.row}>
        <TextInput
          style={[formStyles.inputSingle, readOnly && formStyles.inputDisabled]}
          editable={!readOnly}
          value={text}
          onChangeText={onText}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          accessibilityLabel={`${label}, date as year, month, day`}
        />
      </View>
      {!readOnly && (
        <View style={formStyles.row}>
          <TouchableOpacity style={formStyles.secondaryButton} onPress={() => set(projectToday(timeZone))} accessibilityRole="button" accessibilityLabel="Set to today">
            <Text style={formStyles.secondaryButtonText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity style={formStyles.secondaryButton} onPress={() => set(shiftDate(base, -1))} accessibilityRole="button" accessibilityLabel="One day earlier">
            <Text style={formStyles.secondaryButtonText}>− 1 day</Text>
          </TouchableOpacity>
          <TouchableOpacity style={formStyles.secondaryButton} onPress={() => set(shiftDate(base, 1))} accessibilityRole="button" accessibilityLabel="One day later">
            <Text style={formStyles.secondaryButtonText}>+ 1 day</Text>
          </TouchableOpacity>
        </View>
      )}
      {invalid ? <Text style={formStyles.error}>Enter a real date, for example 2026-11-24</Text> : null}
    </View>
  );
}
