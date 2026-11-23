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
    // Demo branch: UBEC greens instead of the blue/violet glows.
    leftGradient: { start: "#12915C", stop: "#00715D" },
    rightGradient: { start: "#0B4F43", stop: "#12915C" },
    bottomGradientEnd: { start: "#122F2A", stop: "#122F2A" },
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
