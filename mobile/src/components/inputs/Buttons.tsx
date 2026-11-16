import { FC } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { defaultShadow } from "../../styles/commonStyles";
import { MaterialCommunityIcons } from "@expo/vector-icons";

interface PrimaryButtonProps {
  onPress: () => void;
  text: string;
  icon?: React.ReactNode;
  style?: ViewStyle;
  disabled?: boolean;
  isWorking?: boolean;
  indicatorColor?: string;
  backgroundColor?: string;
  textColor?: string;
  accessibilityLabel?: string;
}

export const PrimaryButton: FC<PrimaryButtonProps> = ({
  onPress,
  style,
  text,
  icon,
  disabled,
  isWorking,
  indicatorColor = "#FFF",
  backgroundColor = "#00338D",
  textColor = "#FFF",
  accessibilityLabel,
}) => {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        style,
        (isWorking || disabled) && styles.primaryButtonDisabled,
        { backgroundColor },
      ]}
      onPress={onPress}
      disabled={disabled || isWorking}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {isWorking ? (
        <ActivityIndicator size="small" color={indicatorColor} />
      ) : (
        <View style={styles.buttonContent}>
          {!!icon && icon}
          <Text style={[styles.primaryButtonText, { color: textColor }]}>
            {text}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

interface BackButtonProps {
  onPress: () => void;
  color?: string;
  text?: string;
}

export const BackButton: FC<BackButtonProps> = ({
  onPress,
  color = "#FFF",
  text,
}) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.buttonContent}
      accessibilityRole="button"
      accessibilityLabel={text ?? "Back"}
    >
      <MaterialCommunityIcons name="arrow-left" size={24} color={color} />
      {!!text && <Text style={{ color, fontWeight: 600 }}>{text}</Text>}
    </TouchableOpacity>
  );
};

interface IconButtonProps {
  onPress: () => void;
  color?: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  text?: string;
}

export const IconButton: FC<IconButtonProps> = ({
  onPress,
  color = "#FFF",
  icon,
  text,
}) => {
  return (
    <TouchableOpacity onPress={onPress} style={styles.iconButtonContent}>
      <MaterialCommunityIcons name={icon} size={24} color={color} />
      {!!text && <Text style={{ color, fontSize: 8 }}>{text}</Text>}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    ...defaultShadow,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  iconButtonContent: {
    alignItems: "center",
    gap: 2,
  },
});
