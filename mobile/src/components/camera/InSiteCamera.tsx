import { APPLICATION_NAME } from "../../config/appName";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { CameraView, type CameraType, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { acquireFix } from "../../services/locationService";
import { readHeading, startHeadingWatch } from "../../services/headingService";
import { compressPhoto } from "../../services/photoCompressor";
import { assessCapturedImageQuality } from "./qualityAssessment";
import type {
  CameraCaptureResult,
  CameraFlashSetting,
  CameraGpsMetadata,
  DeviceOrientation,
  InSiteCameraHandle,
  InSiteCameraProps,
} from "./types";

/** The fix at the shutter, or undefined when there is none. Never a substitute value. */
async function captureGpsMetadata(): Promise<CameraGpsMetadata | undefined> {
  const fix = await acquireFix().catch(() => null);
  return fix ?? undefined;
}

export const InSiteCamera = forwardRef<InSiteCameraHandle, InSiteCameraProps>(
  (
    {
      captureType,
      geoTag = false,
      onCapture,
      onCancel,
      initialFacing = "back",
      allowFlipCamera = true,
      allowFlashToggle = true,
      jpegQuality = 0.82,
      title,
      subtitle,
      onCameraReadyChange,
      onOrientationChange,
      children,
    },
    ref,
  ) => {
    const cameraViewRef = useRef<CameraView | null>(null);
    const [permission, requestPermission] = useCameraPermissions();
    const [facing, setFacing] = useState<CameraType>(initialFacing);
    const [flashSetting, setFlashSetting] = useState<CameraFlashSetting>("off");
    const [cameraReady, setCameraReady] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);

    const { width, height } = useWindowDimensions();
    const orientation: DeviceOrientation =
      width > height ? "landscape" : "portrait";

    useEffect(() => {
      onOrientationChange?.(orientation);
    }, [orientation, onOrientationChange]);

    useEffect(() => {
      if (geoTag) {
        Location.requestForegroundPermissionsAsync().catch(() => {});
      }
    }, [geoTag]);

    // UBEC IRL: the compass runs while a geotagging camera is open, so the shutter reads it at once.
    useEffect(() => {
      if (!geoTag) return;
      return startHeadingWatch();
    }, [geoTag]);

    const handleCameraReady = useCallback(() => {
      setCameraReady(true);
      onCameraReadyChange?.(true);
    }, [onCameraReadyChange]);

    const cycleFlashSetting = useCallback(() => {
      setFlashSetting((prev) => {
        if (facing === "front") {
          // Torch is not supported on front lens; toggle off <-> capture flash
          return prev === "off" ? "on" : "off";
        }
        if (prev === "off") return "on";
        if (prev === "on") return "torch";
        return "off";
      });
    }, [facing]);

    const toggleFacing = useCallback(() => {
      setFacing((prev) => {
        const next: CameraType = prev === "back" ? "front" : "back";
        if (next === "front" && flashSetting === "torch") {
          setFlashSetting("off");
        }
        return next;
      });
    }, [flashSetting]);

    const takePicture =
      useCallback(async (): Promise<CameraCaptureResult | null> => {
        if (!cameraViewRef.current || !cameraReady || isCapturing) {
          return null;
        }

        setIsCapturing(true);
        try {
          const capturedAt = new Date().toISOString();
          const [photo, gps, heading] = await Promise.all([
            cameraViewRef.current.takePictureAsync({
              quality: jpegQuality,
              base64: false,
              // EXIF is dropped by the compression below; GPS comes from the location service.
              exif: false,
            }),
            geoTag ? captureGpsMetadata() : Promise.resolve(undefined),
            geoTag ? readHeading().catch(() => null) : Promise.resolve(null),
          ]);

          if (!photo || !photo.uri) {
            throw new Error("Camera returned an empty image frame.");
          }

          // UBEC IRL: the stored (hashed, signed, uploaded) file is the compressed one.
          const stored = await compressPhoto({
            uri: photo.uri,
            width: photo.width,
            height: photo.height,
          });

          const qualityAssessment = assessCapturedImageQuality({
            width: stored.width,
            height: stored.height,
            byteSize: stored.byteSize,
            expectedOrientation: orientation,
          });

          const result: CameraCaptureResult = {
            uri: stored.uri,
            byteSize: stored.byteSize,
            width: stored.width,
            height: stored.height,
            orientation,
            facing,
            capturedAt,
            gps,
            heading: geoTag ? heading : null,
            compressed: stored.compressed,
            qualityAssessment,
          };

          onCapture(result);
          return result;
        } catch (err: any) {
          console.error("InSiteCamera capture error:", err);
          Alert.alert(
            "Camera Error",
            err?.message || "Unable to capture live photo.",
          );
          return null;
        } finally {
          setIsCapturing(false);
        }
      }, [
        cameraReady,
        isCapturing,
        jpegQuality,
        geoTag,
        orientation,
        facing,
        onCapture,
      ]);

    useImperativeHandle(
      ref,
      () => ({
        takePicture,
        isCameraReady: () => cameraReady,
      }),
      [takePicture, cameraReady],
    );

    const permissionGranted = Boolean(
      (permission as any)?.granted || (permission as any)?.status === "granted",
    );
    const canAskAgain = (permission as any)?.canAskAgain !== false;

    if (!permission) {
      return (
        <View style={styles.permissionContainer}>
          <ActivityIndicator size="large" color="#FFBF00" />
          <Text style={styles.permissionSubtitle}>
            Initializing camera hardware...
          </Text>
        </View>
      );
    }

    if (!permissionGranted) {
      return (
        <View style={styles.permissionContainer}>
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>
              Live Camera Access Required
            </Text>
            <Text style={styles.permissionBody}>
              {APPLICATION_NAME} requires direct camera access. Gallery uploads
              are disabled to preserve evidentiary integrity.
            </Text>

            <TouchableOpacity
              style={styles.permissionButton}
              onPress={() => {
                if (canAskAgain) {
                  requestPermission();
                } else {
                  Linking.openSettings();
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.permissionButtonText}>
                {canAskAgain
                  ? "Grant Camera Permission"
                  : "Open Device Settings"}
              </Text>
            </TouchableOpacity>

            {onCancel && (
              <TouchableOpacity
                style={styles.permissionCancelButton}
                onPress={onCancel}
                activeOpacity={0.7}
              >
                <Text style={styles.permissionCancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    const flashLabel =
      flashSetting === "off"
        ? "Flash Off"
        : flashSetting === "on"
          ? "Flash On"
          : "Torch On";

    return (
      <View style={styles.container}>
        <CameraView
          ref={cameraViewRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flashSetting === "on" ? "on" : "off"}
          enableTorch={flashSetting === "torch"}
          onCameraReady={handleCameraReady}
        />

        {/* Custom Overlay Slot (ID Guide, Face Oval, or Site Framing) */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {children}
        </View>

        {/* Top Utility Bar */}
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topLeftGroup}>
            {onCancel && (
              <TouchableOpacity
                style={styles.utilityPill}
                onPress={onCancel}
                activeOpacity={0.8}
                accessibilityLabel="Close camera"
              >
                <Text style={styles.utilityPillText}>✕ Close</Text>
              </TouchableOpacity>
            )}
            <View style={styles.orientationPill}>
              <Text style={styles.orientationPillText}>
                {orientation === "portrait" ? "Portrait" : "Landscape"}
                {geoTag ? " · GPS On" : ""}
              </Text>
            </View>
          </View>

          <View style={styles.topRightGroup}>
            {allowFlashToggle && (
              <TouchableOpacity
                style={[
                  styles.utilityPill,
                  flashSetting !== "off" && styles.utilityPillActive,
                ]}
                onPress={cycleFlashSetting}
                activeOpacity={0.8}
              >
                <Text style={styles.utilityPillText}>⚡ {flashLabel}</Text>
              </TouchableOpacity>
            )}

            {allowFlipCamera && (
              <TouchableOpacity
                style={styles.utilityPill}
                onPress={toggleFacing}
                activeOpacity={0.8}
                accessibilityLabel="Switch front or back camera"
              >
                <Text style={styles.utilityPillText}>
                  {facing === "back" ? "↻ Selfie" : "↻ Main"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Optional Title Banner */}
        {(title || subtitle) && (
          <View style={styles.titleOverlay} pointerEvents="none">
            {title && <Text style={styles.titleText}>{title}</Text>}
            {subtitle && <Text style={styles.subtitleText}>{subtitle}</Text>}
          </View>
        )}

        {/* Bottom Shutter Bar (Only shown when captureType === 'shutter') */}
        {captureType === "shutter" && (
          <View
            style={[
              styles.bottomBar,
              orientation === "landscape" && styles.bottomBarLandscape,
            ]}
          >
            <TouchableOpacity
              style={[
                styles.shutterOuter,
                (!cameraReady || isCapturing) && { opacity: 0.55 },
              ]}
              onPress={takePicture}
              disabled={!cameraReady || isCapturing}
              activeOpacity={0.75}
              accessibilityLabel="Capture photo"
            >
              {isCapturing ? (
                <ActivityIndicator size="small" color="#00715D" />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  },
);

InSiteCamera.displayName = "InSiteCamera";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    position: "relative",
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: "#122F2A",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permissionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    gap: 12,
  },
  permissionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#122F2A",
  },
  permissionSubtitle: {
    fontSize: 13,
    color: "#A7D8CB",
    marginTop: 12,
  },
  permissionBody: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 18,
  },
  permissionButton: {
    backgroundColor: "#00715D",
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  permissionButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  permissionCancelButton: {
    paddingVertical: 10,
    alignItems: "center",
  },
  permissionCancelText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  topBar: {
    position: "absolute",
    top: 44,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 20,
  },
  topLeftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  utilityPill: {
    backgroundColor: "rgba(12, 35, 60, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  utilityPillActive: {
    backgroundColor: "#00715D",
    borderColor: "#FFBF00",
  },
  utilityPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  orientationPill: {
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  orientationPillText: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "600",
  },
  titleOverlay: {
    position: "absolute",
    top: 90,
    left: 20,
    right: 20,
    alignItems: "center",
    zIndex: 15,
  },
  titleText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    textAlign: "center",
  },
  subtitleText: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    textAlign: "center",
  },
  bottomBar: {
    position: "absolute",
    bottom: 26,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 10,
    zIndex: 20,
  },
  bottomBarLandscape: {
    bottom: 16,
  },
  liveOnlyBadge: {
    color: "#E2E8F0",
    backgroundColor: "rgba(12, 35, 60, 0.72)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
  },
});
