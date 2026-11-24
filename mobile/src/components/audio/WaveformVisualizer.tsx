import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  StyleSheet,
  View,
} from 'react-native';

export const BAR_WIDTH = 3;
export const BAR_GAP = 2;
export const MIN_BAR_HEIGHT = 4;

interface WaveformVisualizerProps {
  /** Normalized amplitude values in [0, 1]. */
  amplitudes: number[];
  /** True while actively recording live audio. */
  isRecording?: boolean;
  /** Playback progress ratio in [0, 1] for highlighting played bars. */
  progressRatio?: number;
  /** Maximum bar height in pixels. */
  maxHeight?: number;
  /** Active / played bar color. */
  activeColor?: string;
  /** Unplayed / idle bar color. */
  inactiveColor?: string;
}

const AnimatedBar: React.FC<{
  amplitude: number;
  maxHeight: number;
  color: string;
  animateOnMount: boolean;
}> = memo(({ amplitude, maxHeight, color, animateOnMount }) => {
  const targetHeight = Math.max(
    MIN_BAR_HEIGHT,
    Math.min(1, Math.max(0, amplitude)) * maxHeight
  );
  const heightAnim = useRef(
    new Animated.Value(animateOnMount ? MIN_BAR_HEIGHT : targetHeight)
  ).current;

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: targetHeight,
      duration: animateOnMount ? 110 : 80,
      useNativeDriver: false,
    }).start();
  }, [targetHeight, animateOnMount, heightAnim]);

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          height: heightAnim,
          backgroundColor: color,
        },
      ]}
    />
  );
});

/**
 * Downsamples or slices an amplitude array to fit cleanly inside the measured
 * container width without overflow or unbounded array rendering.
 */
export function fitAmplitudesToSlots(
  amplitudes: number[],
  slotCount: number,
  isRecording: boolean
): number[] {
  if (slotCount <= 0) return [];
  if (amplitudes.length === 0) {
    return Array.from({ length: slotCount }, () => 0.08);
  }

  if (isRecording) {
    // Rolling window of the most recent samples during live capture
    const tail = amplitudes.slice(-slotCount);
    if (tail.length < slotCount) {
      const pad = Array.from({ length: slotCount - tail.length }, () => 0.06);
      return [...pad, ...tail];
    }
    return tail;
  }

  // Uniformly resample full recording across the available width for playback
  if (amplitudes.length <= slotCount) {
    return amplitudes;
  }

  const bucketSize = amplitudes.length / slotCount;
  const sampled: number[] = [];
  for (let i = 0; i < slotCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let peak = 0;
    for (let j = start; j < end && j < amplitudes.length; j++) {
      if (amplitudes[j] > peak) peak = amplitudes[j];
    }
    sampled.push(peak);
  }
  return sampled;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = memo(
  ({
    amplitudes,
    isRecording = false,
    progressRatio = 0,
    maxHeight = 34,
    activeColor = '#00715D',
    inactiveColor = '#CBD5E1',
  }) => {
    const [containerWidth, setContainerWidth] = useState(200);

    const handleLayout = (event: LayoutChangeEvent) => {
      const measured = event.nativeEvent.layout.width;
      if (measured > 0) {
        setContainerWidth(measured);
      }
    };

    const slotCount = Math.max(
      12,
      Math.floor(containerWidth / (BAR_WIDTH + BAR_GAP))
    );

    const visibleBars = useMemo(
      () => fitAmplitudesToSlots(amplitudes, slotCount, isRecording),
      [amplitudes, slotCount, isRecording]
    );

    const playedIndexCutoff = isRecording
      ? visibleBars.length
      : Math.floor(Math.max(0, Math.min(1, progressRatio)) * visibleBars.length);

    return (
      <View
        style={[styles.container, { height: maxHeight + 4 }]}
        onLayout={handleLayout}
      >
        {visibleBars.map((amp, idx) => {
          const isActive = isRecording || idx <= playedIndexCutoff;
          return (
            <AnimatedBar
              key={`bar-${idx}`}
              amplitude={amp}
              maxHeight={maxHeight}
              color={isActive ? activeColor : inactiveColor}
              animateOnMount={isRecording && idx === visibleBars.length - 1}
            />
          );
        })}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
});

