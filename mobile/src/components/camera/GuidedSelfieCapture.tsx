import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { GuidedSelfieSet } from '@insite/shared';
import { InSiteCamera } from './InSiteCamera';
import type { CameraCaptureResult, InSiteCameraHandle } from './types';

/**
 * Guided selfie capture (D-4.2). The person takes three photos (front, left, right) when
 * prompted. The app does not detect faces or liveness and makes no claim that it did: a reviewer
 * compares the three poses with the ID photo by eye.
 */

type Pose = 'FRONT' | 'LEFT' | 'RIGHT' | 'DONE';

export interface GuidedSelfieResult {
  front: CameraCaptureResult;
  left: CameraCaptureResult;
  right: CameraCaptureResult;
  selfieSet: GuidedSelfieSet;
}

interface Props {
  onCaptured: (result: GuidedSelfieResult) => void;
  onCancel?: () => void;
}

const POSE_META: Record<Pose, { title: string; instruction: string; badge: string; borderColor: string; progressPct: number }> = {
  FRONT: {
    title: '1. Look straight ahead',
    instruction: 'Centre your face in the oval with your eyes open and even lighting, then tap Capture.',
    badge: 'Photo 1 of 3',
    borderColor: '#38BDF8',
    progressPct: 30,
  },
  LEFT: {
    title: '2. Turn your head to the left',
    instruction: 'Turn your head slightly left, then tap Capture.',
    badge: 'Photo 2 of 3',
    borderColor: '#F59E0B',
    progressPct: 65,
  },
  RIGHT: {
    title: '3. Turn your head to the right',
    instruction: 'Turn your head slightly right, then tap Capture.',
    badge: 'Photo 3 of 3',
    borderColor: '#F59E0B',
    progressPct: 90,
  },
  DONE: {
    title: 'Selfie set captured',
    instruction: 'A reviewer will compare these photos with your ID.',
    badge: 'Done',
    borderColor: '#10B981',
    progressPct: 100,
  },
};

export const GuidedSelfieCapture: React.FC<Props> = ({ onCaptured, onCancel }) => {
  const cameraRef = useRef<InSiteCameraHandle | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [pose, setPose] = useState<Pose>('FRONT');
  const shots = useRef<{ front?: CameraCaptureResult; left?: CameraCaptureResult }>({});

  const handleCapture = (capture: CameraCaptureResult) => {
    if (pose === 'FRONT') {
      shots.current.front = capture;
      setPose('LEFT');
    } else if (pose === 'LEFT') {
      shots.current.left = capture;
      setPose('RIGHT');
    } else if (pose === 'RIGHT') {
      const front = shots.current.front!;
      const left = shots.current.left!;
      setPose('DONE');
      onCaptured({
        front,
        left,
        right: capture,
        selfieSet: {
          captureMethod: 'GUIDED_SELFIE',
          frontCapturedAt: front.capturedAt,
          leftCapturedAt: left.capturedAt,
          rightCapturedAt: capture.capturedAt,
        },
      });
    }
  };

  const meta = POSE_META[pose];

  return (
    <InSiteCamera
      ref={cameraRef}
      captureType="live"
      initialFacing="front"
      geoTag={false}
      allowFlipCamera={false}
      allowFlashToggle={true}
      onCameraReadyChange={setCameraReady}
      onCapture={handleCapture}
      onCancel={onCancel}
    >
      <View style={styles.overlayRoot} pointerEvents="box-none">
        <View style={styles.promptCard}>
          <View style={styles.promptTopRow}>
            <Text style={styles.promptBadge}>{meta.badge}</Text>
            <Text style={styles.autoTag}>{cameraReady ? 'GUIDED SELFIE' : 'STARTING CAMERA...'}</Text>
          </View>
          <Text style={styles.promptTitle}>{meta.title}</Text>
          <Text style={styles.promptInstruction}>{meta.instruction}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${meta.progressPct}%` }]} />
          </View>
        </View>

        <View style={styles.ovalStage} pointerEvents="none">
          <View style={[styles.ovalFrame, { borderColor: meta.borderColor }]}>
            {pose === 'LEFT' && <Text style={styles.directionalArrow}>←</Text>}
            {pose === 'RIGHT' && <Text style={styles.directionalArrow}>→</Text>}
          </View>
        </View>

        <View style={styles.bottomActions}>
          {pose !== 'DONE' && (
            <TouchableOpacity
              style={styles.manualBtn}
              onPress={() => cameraRef.current?.takePicture()}
              disabled={!cameraReady}
              activeOpacity={0.8}
            >
              <Text style={styles.manualBtnText}>
                Capture {pose === 'FRONT' ? 'front' : pose === 'LEFT' ? 'left' : 'right'} photo
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </InSiteCamera>
  );
};

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
  },
  promptCard: {
    backgroundColor: 'rgba(12, 35, 60, 0.88)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    gap: 6,
  },
  promptTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  promptBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#93C5FD',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  autoTag: {
    fontSize: 9,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.6,
  },
  promptTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  promptInstruction: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  progressTrack: {
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 9999,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 9999,
  },
  ovalStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovalFrame: {
    width: 225,
    height: 295,
    borderRadius: 140,
    borderWidth: 3.5,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionalArrow: {
    fontSize: 48,
    fontWeight: '900',
    color: '#F59E0B',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 8,
  },
  bottomActions: {
    alignItems: 'center',
    gap: 8,
  },
  manualBtn: {
    backgroundColor: '#00715D',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  manualBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
