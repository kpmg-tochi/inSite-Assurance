import React, { FC } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

export type InfoCalloutVariant = "info" | "neutral" | "warning";

const CALLOUT_THEMES: Record<
  InfoCalloutVariant,
  { bg: string; border: string; titleColor: string; textColor: string }
> = {
  info: {
    bg: "#ECFDF5",
    border: "#A7F3D0",
    titleColor: "#00715D",
    textColor: "#0B4F43",
  },
  neutral: {
    bg: "#F1F5F9",
    border: "#E2E8F0",
    titleColor: "#334155",
    textColor: "#64748B",
  },
  warning: {
    bg: "#FFFBEB",
    border: "#FDE68A",
    titleColor: "#92400E",
    textColor: "#78350F",
  },
};

interface InfoCalloutProps {
  title: string;
  description: string;
  variant?: InfoCalloutVariant;
  style?: ViewStyle;
}

export const InfoCallout: FC<InfoCalloutProps> = ({
  title,
  description,
  variant = "info",
  style,
}) => {
  const theme = CALLOUT_THEMES[variant];

  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: theme.bg,
          borderColor: theme.border,
        },
        style,
      ]}
    >
      <Text style={[styles.title, { color: theme.titleColor }]}>{title}</Text>
      <Text style={[styles.description, { color: theme.textColor }]}>
        {description}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    width: "100%",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  description: {
    fontSize: 11,
    lineHeight: 16,
  },
});

