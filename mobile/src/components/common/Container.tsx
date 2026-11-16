import { View, ViewStyle } from "react-native";
import { FC, ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandGradient } from "./BrandGradient";

interface ContainerProps {
  children: ReactNode;
  backgroundColor?: ViewStyle["backgroundColor"];
  style?: ViewStyle;
}

const Container: FC<ContainerProps> = ({
  children,
  backgroundColor,
  style,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 20,
          flex: 1,
          backgroundColor,
        },
        style,
      ]}
    >
      {!backgroundColor && <BrandGradient />}

      {children}
    </View>
  );
};

export default Container;
