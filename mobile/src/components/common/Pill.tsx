import React, { FC } from "react";
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { defaultColors } from "../../styles/commonStyles";

export type PillVariant = "primary" | "positive" | "warning" | "negative" | "info" | "gray" | "darkGlass";

/**
 * A status as a small coloured dot plus plain text, the same as the web portal's `StatusText`
 * (UBEC rebrand: "remove unnecessary badges"; no filled pills). The name is kept so call sites stay.
 */
const tones: Record<PillVariant, { dot: string; text: string }> = {
  primary: { dot: defaultColors.primary, text: defaultColors.primary },
  info: { dot: defaultColors.primary, text: "#005A4A" },
  positive: { dot: "#059669", text: "#065F46" },
  warning: { dot: "#F59E0B", text: "#92400E" },
  negative: { dot: "#E11D48", text: "#BE123C" },
  gray: { dot: "#94A3B8", text: "#334155" },
  darkGlass: { dot: defaultColors.accent, text: "#FFFFFF" },
};

interface PillProps {
  variant: PillVariant;
  text: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const Pill: FC<PillProps> = ({ variant, text, style, textStyle }) => {
  const tone = tones[variant];
  return (
    <View style={[styles.row, style]} accessibilityRole="text">
      <View style={[styles.dot, { backgroundColor: tone.dot }]} />
      <Text style={[styles.text, { color: tone.text }, textStyle]}>{text}</Text>
    </View>
  );
};

export default Pill;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: "600" },
});
