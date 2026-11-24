import { StyleSheet, Dimensions } from "react-native";
import Svg, { Defs, Rect, RadialGradient, LinearGradient, Stop } from "react-native-svg";
import { useActiveBranding } from "../../context/ProfileContext";
import { defaultColors } from "../../styles/commonStyles";

const { width, height } = Dimensions.get("screen");

/**
 * Header and landing background (UBEC rebrand, same as the web portal's `brand-primary` →
 * `brand-navy` gradient): the tenant's primary colour fading into the UBEC dark green, with a soft
 * UBEC green light at the top left.
 */
export const BrandGradient = () => {
  const { primaryColor } = useActiveBranding();

  return (
    <Svg height={height * 1.5} width={width * 1.5} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={primaryColor} stopOpacity="1" />
          <Stop offset="75%" stopColor={defaultColors.primaryDark} stopOpacity="1" />
        </LinearGradient>
        <RadialGradient id="light" cx="0%" cy="0%" r="70%">
          <Stop offset="0%" stopColor={defaultColors.medium} stopOpacity="0.55" />
          <Stop offset="100%" stopColor={defaultColors.medium} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#base)" />
      <Rect width={width} height={height} fill="url(#light)" />
    </Svg>
  );
};
