import { StyleSheet, Dimensions } from "react-native";
import Svg, {
  Defs,
  Rect,
  RadialGradient,
  LinearGradient,
  Stop,
} from "react-native-svg";
import { useActiveBranding } from "../../context/ProfileContext";

const { width, height } = Dimensions.get("screen");

export const BrandGradient = () => {
  // Base colour is the tenant's primary once the tenant is known; neutral InSite default before.
  const { primaryColor } = useActiveBranding();
  const colors = {
    solidBackground: primaryColor,
    leftGradient: { start: "#00B8F5", stop: "#1E49E2" },
    rightGradient: { start: "#7213EA", stop: "#00B8F5" },
    bottomGradientEnd: { start: "#0C233C", stop: "#0C233C" },
  };

  return (
    <Svg
      height={height * 1.5}
      width={width * 1.5}
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        {/* Left */}
        <RadialGradient id="leftGradient" cx="-20%" cy="10%" r="70%">
          <Stop
            offset="0%"
            stopColor={colors.leftGradient.start}
            stopOpacity="0.7"
          />
          <Stop
            offset="100%"
            stopColor={colors.leftGradient.stop}
            stopOpacity="0"
          />
        </RadialGradient>

        {/* Right */}
        <RadialGradient id="rightGradient" cx="60%" cy="50%" r="50%">
          <Stop
            offset="0%"
            stopColor={colors.rightGradient.start}
            stopOpacity="1"
          />
          <Stop
            offset="100%"
            stopColor={colors.rightGradient.stop}
            stopOpacity="0"
          />
        </RadialGradient>

        {/* Bottom */}
        <LinearGradient id="bottomGradientEnd" x1="0" y1="0" x2="0" y2="1">
          <Stop
            offset="70%"
            stopColor={colors.bottomGradientEnd.start}
            stopOpacity="0"
          />
          <Stop
            offset="95%"
            stopColor={colors.bottomGradientEnd.stop}
            stopOpacity="0.8"
          />
        </LinearGradient>
      </Defs>

      <Rect width={width} height={height} fill={colors.solidBackground} />
      <Rect width={height} height={height} fill="url(#leftGradient)" />
      <Rect width={height} height={height} fill="url(#rightGradient)" />
      <Rect width={width} height={height} fill="url(#bottomGradientEnd)" />
    </Svg>
  );
};
