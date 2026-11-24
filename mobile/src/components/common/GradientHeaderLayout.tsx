import React, { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, ViewStyle } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandGradient } from "./BrandGradient";
import { defaultColors } from "../../styles/commonStyles";

interface GradientHeaderLayoutProps {
  title?: string | ReactNode;
  subtitle?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  headerChildren?: ReactNode;
  children: ReactNode;
  contentBackgroundColor?: string;
  scrollable?: boolean;
  contentContainerStyle?: ViewStyle;
}

export const GradientHeaderLayout: React.FC<GradientHeaderLayoutProps> = ({
  title,
  subtitle,
  leftAction,
  rightAction,
  headerChildren,
  children,
  contentBackgroundColor = defaultColors.background,
  scrollable = true,
  contentContainerStyle,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <BrandGradient />

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: insets.top,
          paddingBottom: headerChildren ? 16 : 28,
        }}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.titleArea}>
            {leftAction && (
              <View style={styles.leftActionWrap}>{leftAction}</View>
            )}
            <View style={styles.titleTexts}>
              {typeof title === "string" ? (
                <Text style={styles.headerTitle}>{title}</Text>
              ) : (
                title
              )}
              {subtitle && (
                <Text style={styles.headerSubtitle}>{subtitle}</Text>
              )}
            </View>
          </View>
          {rightAction && (
            <View style={styles.rightActionWrap}>{rightAction}</View>
          )}
        </View>

        {headerChildren && (
          <View style={styles.headerChildrenWrap}>{headerChildren}</View>
        )}
      </View>

      {/* Curved Content Container (overlapping the gradient slightly) */}
      <View
        style={[
          styles.curvedContentContainer,
          {
            backgroundColor: contentBackgroundColor,
          },
        ]}
      >
        {scrollable ? (
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              contentContainerStyle,
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.staticContent, contentContainerStyle]}>
            {children}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#122F2A",
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  titleArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  leftActionWrap: {
    marginRight: 4,
    zIndex: 500,
  },
  titleTexts: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.75)",
    marginTop: 2,
  },
  rightActionWrap: {
    marginLeft: 12,
    zIndex: 500,
  },
  headerChildrenWrap: {
    marginTop: 14,
  },
  curvedContentContainer: {
    flex: 1,
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
  },
  staticContent: {
    flex: 1,
    padding: 20,
    paddingBottom: 0,
  },
});
