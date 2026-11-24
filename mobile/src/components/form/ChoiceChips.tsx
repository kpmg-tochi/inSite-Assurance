import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { formStyles } from './formStyles';

export interface ChoiceChipsProps {
  /** The question, for screen readers ("Is the contractor on site?"). */
  groupLabel: string;
  options: Array<{ key: string; label: string; accessibilityLabel?: string }>;
  selected: string[];
  /** Multiple choice: checkboxes; otherwise radio buttons. */
  multi?: boolean;
  disabled?: boolean;
  onToggle: (key: string) => void;
}

/** A row of chips; selection is shown by fill and by the screen reader state, plus a check mark in text. */
export function ChoiceChips({ groupLabel, options, selected, multi = false, disabled = false, onToggle }: ChoiceChipsProps) {
  return (
    <View style={formStyles.row} accessibilityRole={multi ? undefined : 'radiogroup'} accessibilityLabel={groupLabel}>
      {options.map((o) => {
        const on = selected.includes(o.key);
        return (
          <TouchableOpacity
            key={o.key}
            style={[formStyles.chip, on && formStyles.chipOn, disabled && !on && formStyles.disabled]}
            onPress={() => onToggle(o.key)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={multi ? { checked: on, disabled } : { selected: on, disabled }}
            accessibilityLabel={o.accessibilityLabel ?? o.label}
          >
            <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>{on ? `✓ ${o.label}` : o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
