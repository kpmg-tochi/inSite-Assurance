import React, { FC } from "react";
import {
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { defaultColors } from "../../styles/commonStyles";

export type PillVariant =
  | "primary"
  | "positive"
  | "warning"
  | "negative"
  | "info"
  | "gray"
  | "darkGlass";

const pillColors: Record<
  PillVariant,
  { backgroundColor: string; textColor: string; borderColor: string }
> = {
  primary: {
    backgroundColor: defaultColors.primary,
    textColor: "#FFFFFF",
    borderColor: defaultColors.primary,
  },
  positive: {
    backgroundColor: "#ECFDF5",
    textColor: "#065F46",
    borderColor: "#A7F3D0",
  },
  warning: {
    backgroundColor: "#FEF3C7",
    textColor: "#92400E",
    borderColor: "#FDE68A",
  },
  negative: {
    backgroundColor: "#FFF1F2",
    textColor: "#BE123C",
    borderColor: "#FECDD3",
  },
  info: {
    backgroundColor: "#ECFDF5",
    textColor: defaultColors.primary,
    borderColor: "#A7F3D0",
  },
  gray: {
    backgroundColor: "#F1F5F9",
    textColor: defaultColors.secondaryText,
    borderColor: defaultColors.border,
  },
  darkGlass: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    textColor: "#A7F3D0",
    borderColor: "rgba(167, 243, 208, 0.25)",
  },
};

interface PillProps {
  variant: PillVariant;
  text: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const Pill: FC<PillProps> = ({ variant, text, style, textStyle }) => {
  const palette = pillColors[variant];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
        style,
      ]}
    >
      <Text style={[styles.pillText, { color: palette.textColor }, textStyle]}>
        {text}
      </Text>
    </View>
  );
};

export default Pill;

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 9999,
    alignSelf: "flex-start",
  },
  pillText: {
    fontSize: 10,
    fontWeight: "700",
  },
});
