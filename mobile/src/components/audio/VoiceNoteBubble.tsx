import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from "expo-audio";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { formatDurationMs } from "./VoiceNoteRecorder";

interface VoiceNoteBubbleProps {
  senderName: string;
  audioUri?: string;
  durationMs?: number;
  waveform?: number[];
  timestamp: string;
  chainageLabel?: string;
  isMe?: boolean;
}

const FALLBACK_WAVEFORM = [
  0.22, 0.48, 0.72, 0.38, 0.64, 0.85, 0.52, 0.3, 0.68, 0.9, 0.45, 0.35, 0.6,
  0.78, 0.42, 0.25, 0.55, 0.7, 0.4, 0.28,
];

export const VoiceNoteBubble: React.FC<VoiceNoteBubbleProps> = ({
  senderName,
  audioUri,
  durationMs = 0,
  waveform,
  timestamp,
  chainageLabel,
  isMe = true,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [totalMs, setTotalMs] = useState(durationMs);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          playerRef.current.remove();
        } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  const handleTogglePlay = useCallback(async () => {
    if (!audioUri) {
      Alert.alert(
        "Audio Unavailable",
        "No local audio file is attached to this note.",
      );
      return;
    }

    try {
      if (playerRef.current) {
        if (playerRef.current.playing) {
          playerRef.current.pause();
          setIsPlaying(false);
          return;
        }
        if (
          playerRef.current.duration > 0 &&
          playerRef.current.currentTime >= playerRef.current.duration - 0.05
        ) {
          playerRef.current.seekTo(0);
        }
        playerRef.current.play();
        setIsPlaying(true);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const player = createAudioPlayer(
        { uri: audioUri },
        { updateInterval: 100 },
      );
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.isLoaded) {
          setPositionMs(Math.round(status.currentTime * 1000));
          if (status.duration > 0) {
            setTotalMs(Math.round(status.duration * 1000));
          }
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionMs(0);
          }
        }
      });

      playerRef.current = player;
      player.play();
      setIsPlaying(true);
    } catch (err) {
      console.warn("VoiceNoteBubble playback error:", err);
      Alert.alert("Playback Error", "Unable to play this voice note.");
    }
  }, [audioUri]);

  const progressRatio = totalMs > 0 ? positionMs / totalMs : 0;
  const bars = waveform && waveform.length > 0 ? waveform : FALLBACK_WAVEFORM;

  return (
    <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
      <Text style={[styles.senderText, isMe && styles.senderTextMe]}>
        {senderName} · Voice Log
      </Text>

      <View style={styles.playerRow}>
        <TouchableOpacity
          style={[
            styles.playBtn,
            isMe ? styles.playBtnMe : styles.playBtnOther,
          ]}
          onPress={handleTogglePlay}
          activeOpacity={0.8}
          accessibilityLabel={
            isPlaying ? "Pause voice note" : "Play voice note"
          }
        >
          <Text style={[styles.playIcon, isMe && styles.playIconMe]}>
            {isPlaying ? "⏸" : "▶"}
          </Text>
        </TouchableOpacity>

        <View style={styles.waveWrap}>
          <WaveformVisualizer
            amplitudes={bars}
            isRecording={false}
            progressRatio={progressRatio}
            maxHeight={26}
            activeColor={isMe ? "#FFFFFF" : "#00338D"}
            inactiveColor={isMe ? "rgba(255,255,255,0.35)" : "#CBD5E1"}
          />
        </View>

        <Text style={[styles.durationText, isMe && styles.durationTextMe]}>
          {formatDurationMs(isPlaying ? positionMs : totalMs)}
        </Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.metaText, isMe && styles.metaTextMe]}>
          {chainageLabel ? `${chainageLabel} · ` : ""}
          {timestamp}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: "88%",
    gap: 6,
  },
  bubbleMe: {
    alignSelf: "flex-end",
    backgroundColor: "#00338D",
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderBottomLeftRadius: 4,
  },
  senderText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  senderTextMe: {
    color: "#BFDBFE",
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 220,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnMe: {
    backgroundColor: "#FFFFFF",
  },
  playBtnOther: {
    backgroundColor: "#00338D",
  },
  playIcon: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  playIconMe: {
    color: "#00338D",
  },
  waveWrap: {
    flex: 1,
    height: 30,
    justifyContent: "center",
  },
  durationText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155",
    fontVariant: ["tabular-nums"],
    minWidth: 36,
    textAlign: "right",
  },
  durationTextMe: {
    color: "#FFFFFF",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  metaText: {
    fontSize: 9,
    color: "#64748B",
  },
  metaTextMe: {
    color: "#BFDBFE",
  },
});
