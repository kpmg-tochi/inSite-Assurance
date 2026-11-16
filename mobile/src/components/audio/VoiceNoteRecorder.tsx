import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
  AudioPlayer,
} from "expo-audio";
import { WaveformVisualizer } from "./WaveformVisualizer";

export interface VoiceRecordingResult {
  uri: string;
  durationMs: number;
  mimeType: string;
  fileName: string;
  waveform: number[];
}

interface VoiceNoteRecorderProps {
  /** Maximum recording length in milliseconds (default 180,000 ms = 3 min). */
  maxDurationMs?: number;
  /** Primary button label when attaching the recorded note. */
  submitLabel?: string;
  /** Called when the user confirms and attaches the recorded voice note. */
  onRecordingComplete: (result: VoiceRecordingResult) => void;
  /** Called when the user cancels without attaching. */
  onCancel?: () => void;
}

type RecorderPhase = "IDLE" | "RECORDING" | "REVIEW";

const MAX_STORED_WAVEFORM_SAMPLES = 240;

/**
 * Normalizes expo-av dBFS metering (typically -160..0, speech -55..-5)
 * into a responsive [0.06, 1] bar height for both iOS and budget Android mics.
 */
function normalizeDbMetering(db?: number): number {
  if (typeof db !== "number" || Number.isNaN(db)) {
    return 0.12;
  }
  const minDb = -60;
  const maxDb = 0;
  const clamped = Math.max(minDb, Math.min(maxDb, db));
  const linear = (clamped - minDb) / (maxDb - minDb);
  return Math.max(0.06, Number(Math.pow(linear, 0.65).toFixed(3)));
}

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export const VoiceNoteRecorder: React.FC<VoiceNoteRecorderProps> = ({
  maxDurationMs = 180_000,
  submitLabel = "Attach Voice Note",
  onRecordingComplete,
  onCancel,
}) => {
  const [phase, setPhase] = useState<RecorderPhase>("IDLE");
  const [isBusy, setIsBusy] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [amplitudes, setAmplitudes] = useState<number[]>([]);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);

  // Playback preview state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  const previewPlayerRef = useRef<AudioPlayer | null>(null);
  const meterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStoppingRef = useRef(false);

  const unloadSound = useCallback(async () => {
    if (previewPlayerRef.current) {
      try {
        previewPlayerRef.current.pause();
        previewPlayerRef.current.remove();
      } catch {
        // Ignore cleanup errors
      }
      previewPlayerRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackPositionMs(0);
  }, []);

  const cleanupRecorder = useCallback(async () => {
    if (meterIntervalRef.current) {
      clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }
    try {
      if (recorder.isRecording) {
        await recorder.stop();
      }
    } catch {
      // Ignore cleanup errors
    }
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // Ignore cleanup errors
    }
  }, [recorder]);

  useEffect(() => {
    return () => {
      cleanupRecorder();
      unloadSound();
    };
  }, [cleanupRecorder, unloadSound]);

  const stopRecording = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    setIsBusy(true);

    if (meterIntervalRef.current) {
      clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }

    try {
      const finalStatus = recorder.getStatus();
      await recorder.stop();
      const uri = recorder.uri;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!uri) {
        throw new Error("Recorded audio URI was empty.");
      }

      if (finalStatus.durationMillis > 0) {
        setDurationMs(finalStatus.durationMillis);
      }
      setRecordedUri(uri);
      setPhase("REVIEW");
    } catch (err: any) {
      console.error("Failed to stop recording:", err);
      Alert.alert(
        "Recording Error",
        err?.message || "Unable to finalize voice recording.",
      );
      setPhase("IDLE");
    } finally {
      isStoppingRef.current = false;
      setIsBusy(false);
    }
  }, [recorder]);

  const startRecording = useCallback(async () => {
    if (isBusy || phase === "RECORDING") return;
    setIsBusy(true);

    try {
      await unloadSound();
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Microphone Permission Required",
          "InSite Assurance needs microphone access to record field voice logs.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      setAmplitudes([]);
      setDurationMs(0);
      setRecordedUri(null);

      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("RECORDING");

      if (meterIntervalRef.current) clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = setInterval(() => {
        const status = recorder.getStatus();
        if (!status.isRecording) return;
        setDurationMs(status.durationMillis);

        const sample = normalizeDbMetering(status.metering);
        setAmplitudes((prev) => {
          const next = [...prev, sample];
          if (next.length > MAX_STORED_WAVEFORM_SAMPLES) {
            return next.slice(next.length - MAX_STORED_WAVEFORM_SAMPLES);
          }
          return next;
        });

        if (status.durationMillis >= maxDurationMs && !isStoppingRef.current) {
          stopRecording();
        }
      }, 120);
    } catch (err: any) {
      console.error("Failed to start recording:", err);
      Alert.alert(
        "Microphone Unavailable",
        err?.message || "Could not start audio recording on this device.",
      );
      await cleanupRecorder();
      setPhase("IDLE");
    } finally {
      setIsBusy(false);
    }
  }, [
    isBusy,
    phase,
    unloadSound,
    recorder,
    maxDurationMs,
    stopRecording,
    cleanupRecorder,
  ]);

  const togglePreviewPlayback = useCallback(async () => {
    if (!recordedUri) return;

    try {
      if (previewPlayerRef.current) {
        if (previewPlayerRef.current.playing) {
          previewPlayerRef.current.pause();
          setIsPlaying(false);
          return;
        }
        if (
          previewPlayerRef.current.duration > 0 &&
          previewPlayerRef.current.currentTime >=
            previewPlayerRef.current.duration - 0.05
        ) {
          previewPlayerRef.current.seekTo(0);
        }
        previewPlayerRef.current.play();
        setIsPlaying(true);
        return;
      }

      const player = createAudioPlayer(
        { uri: recordedUri },
        { updateInterval: 100 },
      );
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.isLoaded) {
          setPlaybackPositionMs(Math.round(status.currentTime * 1000));
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPlaybackPositionMs(0);
          }
        }
      });
      previewPlayerRef.current = player;
      player.play();
      setIsPlaying(true);
    } catch (err) {
      console.warn("Voice preview playback failed:", err);
      Alert.alert("Playback Error", "Unable to play back the recorded audio.");
    }
  }, [recordedUri]);

  const handleDiscardAndReset = useCallback(async () => {
    await unloadSound();
    setRecordedUri(null);
    setAmplitudes([]);
    setDurationMs(0);
    setPhase("IDLE");
  }, [unloadSound]);

  const handleConfirmAttach = useCallback(async () => {
    if (!recordedUri) return;
    await unloadSound();
    const fileName = `voice-log-${Date.now()}.m4a`;
    onRecordingComplete({
      uri: recordedUri,
      durationMs,
      mimeType: "audio/mp4",
      fileName,
      waveform:
        amplitudes.length > 0 ? amplitudes : [0.2, 0.45, 0.6, 0.35, 0.5],
    });
  }, [recordedUri, unloadSound, durationMs, amplitudes, onRecordingComplete]);

  const progressRatio =
    phase === "REVIEW" && durationMs > 0 ? playbackPositionMs / durationMs : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              phase === "RECORDING"
                ? styles.dotLive
                : phase === "REVIEW"
                  ? styles.dotReady
                  : styles.dotIdle,
            ]}
          />
          <Text style={styles.statusText}>
            {phase === "RECORDING"
              ? "Recording Field Voice Note"
              : phase === "REVIEW"
                ? "Review & Attach Voice Note"
                : "Tap Record to Capture Voice Log"}
          </Text>
        </View>
        <Text style={styles.timerText}>
          {formatDurationMs(
            phase === "REVIEW" && isPlaying ? playbackPositionMs : durationMs,
          )}
          <Text style={styles.timerMax}>
            {" "}
            / {formatDurationMs(maxDurationMs)}
          </Text>
        </Text>
      </View>

      {/* Waveform Display */}
      <View style={styles.waveformBox}>
        {phase === "REVIEW" && (
          <TouchableOpacity
            style={styles.playBtn}
            onPress={togglePreviewPlayback}
            activeOpacity={0.8}
            accessibilityLabel={
              isPlaying ? "Pause voice preview" : "Play voice preview"
            }
          >
            <Text style={styles.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
          </TouchableOpacity>
        )}
        <WaveformVisualizer
          amplitudes={amplitudes}
          isRecording={phase === "RECORDING"}
          progressRatio={progressRatio}
          activeColor={phase === "RECORDING" ? "#DC2626" : "#00338D"}
          inactiveColor="#CBD5E1"
        />
      </View>

      {/* Controls */}
      <View style={styles.controlsRow}>
        {onCancel && phase !== "RECORDING" && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={async () => {
              await unloadSound();
              onCancel();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        {phase === "IDLE" && (
          <TouchableOpacity
            style={[styles.recordBtn, isBusy && styles.disabledBtn]}
            onPress={startRecording}
            disabled={isBusy}
            activeOpacity={0.85}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.recordBtnText}>● Start Recording</Text>
            )}
          </TouchableOpacity>
        )}

        {phase === "RECORDING" && (
          <TouchableOpacity
            style={[styles.stopBtn, isBusy && styles.disabledBtn]}
            onPress={stopRecording}
            disabled={isBusy}
            activeOpacity={0.85}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.stopBtnText}>■ Stop &amp; Preview</Text>
            )}
          </TouchableOpacity>
        )}

        {phase === "REVIEW" && (
          <>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleDiscardAndReset}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryBtnText}>Re-record</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={handleConfirmAttach}
              activeOpacity={0.85}
            >
              <Text style={styles.attachBtnText}>{submitLabel}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    padding: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotIdle: {
    backgroundColor: "#94A3B8",
  },
  dotLive: {
    backgroundColor: "#DC2626",
  },
  dotReady: {
    backgroundColor: "#059669",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0C233C",
  },
  timerText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0C233C",
    fontVariant: ["tabular-nums"],
  },
  timerMax: {
    color: "#64748B",
    fontWeight: "600",
  },
  waveformBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 54,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#00338D",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
  },
  recordBtn: {
    flex: 1,
    backgroundColor: "#DC2626",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  recordBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  stopBtn: {
    flex: 1,
    backgroundColor: "#0C233C",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  stopBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  attachBtn: {
    flex: 1,
    backgroundColor: "#00338D",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  attachBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  secondaryBtn: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  secondaryBtnText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.65,
  },
});
