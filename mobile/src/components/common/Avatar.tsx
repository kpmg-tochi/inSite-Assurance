import React, { FC, useMemo } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import Toast from "react-native-toast-message";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { defaultColors } from "../../styles/commonStyles";
import { useProfile } from "../../context/ProfileContext";
import { getInitials } from "../../utils/userUtils";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_MAP: Record<AvatarSize, { box: number; font: number }> = {
  xs: { box: 38, font: 13 },
  sm: { box: 48, font: 16 },
  md: { box: 62, font: 20 },
  lg: { box: 96, font: 28 },
};

interface AvatarProps {
  image?: string;
  forceInitials?: string;
  editable?: boolean;
  size?: AvatarSize;
  showOnlineDot?: boolean;
  onlineDotBorderColor?: string;
  onPress?: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const Avatar: FC<AvatarProps> = ({
  image,
  forceInitials,
  editable = false,
  size = "md",
  showOnlineDot = false,
  onlineDotBorderColor = "#1E1B4B",
  onPress,
  style,
  accessibilityLabel,
}) => {
  const { displayName } = useProfile();

  const initials = useMemo(() => {
    if (forceInitials) return forceInitials;
    return getInitials(displayName, "CO");
  }, [forceInitials, displayName]);

  const handleAvatarTap = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (!editable) {
      return;
    }

    Toast.show({
      type: "info",
      props: {
        title: "Coming soon",
        message: "Profile images will be added soon",
      },
    });
  };

  const dims = SIZE_MAP[size];
  const isInteractive = Boolean(onPress || editable);

  return (
    <TouchableOpacity
      onPress={handleAvatarTap}
      disabled={!isInteractive}
      activeOpacity={0.8}
      accessibilityRole={isInteractive ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.avatarCircle,
        size === "xs" && styles.avatarCompact,
        {
          width: dims.box,
          height: dims.box,
          borderRadius: dims.box / 2,
        },
        style,
      ]}
    >
      <Text style={[styles.avatarInitials, { fontSize: dims.font }]}>
        {initials}
      </Text>

      {showOnlineDot && (
        <View
          style={[
            styles.onlineDot,
            { borderColor: onlineDotBorderColor },
          ]}
        />
      )}

      {editable && (
        <View
          style={[
            styles.avatarPlusBadge,
            {
              width: dims.box / 3,
              height: dims.box / 3,
              borderRadius: dims.box / 6,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={image ? "plus" : "pencil-outline"}
            size={dims.box / 6}
            color={defaultColors.primary}
          />
        </View>
      )}
    </TouchableOpacity>
  );
};

export default Avatar;

const styles = StyleSheet.create({
  avatarCircle: {
    backgroundColor: defaultColors.primary,
    borderWidth: 2,
    borderColor: defaultColors.accent,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarCompact: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderWidth: 1.5,
  },
  avatarInitials: {
    color: "#FFFFFF",
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  onlineDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#10B981",
    borderWidth: 1.5,
  },
  avatarPlusBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: defaultColors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
