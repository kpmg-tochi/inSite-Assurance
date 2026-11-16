import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface InSiteLoaderProps {
  white?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const BAR_DIMENSIONS = {
  sm: { width: 10, height: 16, gap: 4, borderWidth: 2 },
  md: { width: 14, height: 22, gap: 5, borderWidth: 2.5 },
  lg: { width: 18, height: 28, gap: 6, borderWidth: 3 },
};

/**
 * 4-bar animated KPMG-inspired loader matching web/src/components/Loader.tsx.
 */
export const InSiteLoader: React.FC<InSiteLoaderProps> = ({
  white = false,
  size = 'md',
  label,
}) => {
  const anims = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]).current;

  useEffect(() => {
    const loops = anims.map((anim, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(idx * 100),
          Animated.timing(anim, {
            toValue: 1,
            duration: 380,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.35,
            duration: 380,
            useNativeDriver: true,
          }),
        ])
      )
    );

    loops.forEach((loop) => loop.start());
    return () => {
      loops.forEach((loop) => loop.stop());
    };
  }, [anims]);

  const dims = BAR_DIMENSIONS[size];
  const borderColor = white ? '#FFFFFF' : '#00338D';

  return (
    <View style={styles.container}>
      <View style={[styles.barsRow, { gap: dims.gap }]}>
        {anims.map((anim, index) => (
          <Animated.View
            key={index}
            style={{
              width: dims.width,
              height: dims.height,
              borderWidth: dims.borderWidth,
              borderColor,
              borderRadius: 2,
              opacity: anim,
              transform: [
                {
                  scaleY: anim.interpolate({
                    inputRange: [0.35, 1],
                    outputRange: [0.78, 1.08],
                  }),
                },
              ],
            }}
          />
        ))}
      </View>
      {label ? (
        <Text style={[styles.label, white && styles.labelWhite]}>{label}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  labelWhite: {
    color: '#E2E8F0',
  },
});

