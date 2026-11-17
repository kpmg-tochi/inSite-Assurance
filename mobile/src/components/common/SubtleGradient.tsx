import { StyleSheet } from "react-native";
import Svg, { Defs, Rect, RadialGradient, Stop } from "react-native-svg";

export const SubtleGradient = ({
  colors,
  opacity,
}: {
  colors: [string, string];
  opacity: string;
}) => {
  return (
    <Svg style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="radial" cx="-20%" cy="50%" r="100%">
          <Stop
            offset="0%"
            stopColor={colors[0]}
            stopOpacity={opacity ?? "0.4"}
          />
          <Stop offset="100%" stopColor={colors[1]} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <Rect width="100%" height="100%" fill="url(#radial)" />
    </Svg>
  );
};
