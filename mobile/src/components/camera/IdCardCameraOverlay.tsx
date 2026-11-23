import React, { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InSiteCamera } from './InSiteCamera';
import type { CameraCaptureResult, DeviceOrientation } from './types';

export const ID_DOCUMENT_TYPES = [
  'NIN Slip / Card',
  "Driver's License",
  'Voter PVC',
  'Passport',
] as const;

export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export interface IdCardCapturePayload {
  idType: IdDocumentType;
  capture: CameraCaptureResult;
}

interface Props {
  initialIdType?: IdDocumentType;
  onIdCaptured: (payload: IdCardCapturePayload) => void;
  onCancel?: () => void;
}

export const IdCardCameraOverlay: React.FC<Props> = ({
  initialIdType = 'NIN Slip / Card',
  onIdCaptured,
  onCancel,
}) => {
  const insets = useSafeAreaInsets();
  const [selectedIdType, setSelectedIdType] = useState<IdDocumentType>(initialIdType);
  const [orientation, setOrientation] = useState<DeviceOrientation>('portrait');
  const [pendingCapture, setPendingCapture] = useState<CameraCaptureResult | null>(null);

  if (pendingCapture) {
    const quality = pendingCapture.qualityAssessment;
    return (
      <View
        style={[
          styles.previewContainer,
          {
            paddingTop: Math.max(insets.top + 8, 20),
            paddingBottom: Math.max(insets.bottom + 12, 16),
          },
        ]}
      >
        <StatusBar style="light" />
        <View style={styles.previewHeader}>
          <Text style={styles.previewHeaderTitle}>Review Captured {selectedIdType}</Text>
          <Text style={styles.previewHeaderSub}>
            Ensure text, portrait, and edges are sharp and legible.
          </Text>
        </View>

        <View style={styles.previewImageWrapper}>
          <Image
            source={{ uri: pendingCapture.uri }}
            style={styles.previewImage}
            resizeMode="contain"
          />
        </View>

        <View
          style={[
            styles.qualityBanner,
            quality.passed ? styles.qualityBannerPass : styles.qualityBannerWarn,
          ]}
        >
          <Text
            style={[
              styles.qualityTitle,
              quality.passed ? styles.qualityTitlePass : styles.qualityTitleWarn,
            ]}
          >
            {quality.passed
              ? `Quality Check Passed (${Math.round(quality.score * 100)}%)`
              : 'Low Clarity Warning'}
          </Text>
          <Text style={styles.qualityBody}>
            {quality.warnings.length > 0
              ? quality.warnings.join(' ')
              : `${pendingCapture.width}x${pendingCapture.height} · Formatted for encrypted upload.`}
          </Text>
        </View>

        <View style={styles.previewActions}>
          <TouchableOpacity
            style={styles.retakeBtn}
            onPress={() => setPendingCapture(null)}
            activeOpacity={0.8}
          >
            <Text style={styles.retakeBtnText}>Retake Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={() =>
              onIdCaptured({
                idType: selectedIdType,
                capture: pendingCapture,
              })
            }
            activeOpacity={0.8}
          >
            <Text style={styles.confirmBtnText}>Use This ID</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <InSiteCamera
      captureType="shutter"
      initialFacing="back"
      geoTag={false}
      allowFlipCamera={false}
      allowFlashToggle={true}
      onOrientationChange={setOrientation}
      onCapture={(capture) => setPendingCapture(capture)}
      onCancel={onCancel}
    >
      <View
        style={[
          styles.overlayRoot,
          {
            paddingTop: Math.max(insets.top + 50, 70),
            paddingBottom: Math.max(insets.bottom + 100, 120),
          },
        ]}
        pointerEvents="box-none"
      >
        {/* ID Type Selector Pills */}
        <View style={styles.idTypeBar}>
          <Text style={styles.idTypePrompt}>1. Select ID Type &amp; Align Card Inside Frame</Text>
          <View style={styles.pillsRow}>
            {ID_DOCUMENT_TYPES.map((type) => {
              const active = selectedIdType === type;
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setSelectedIdType(type)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ID-1 Card Framing Guide */}
        <View style={styles.frameCenterArea} pointerEvents="none">
          <View
            style={[
              styles.idCardFrame,
              orientation === 'landscape' && styles.idCardFrameLandscape,
            ]}
          >
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />

            {/* Subtle Portrait & Text Template Guides */}
            <View style={styles.templateContent}>
              <View style={styles.photoSlotGuide}>
                <Text style={styles.slotLabel}>PHOTO</Text>
              </View>
              <View style={styles.linesGuide}>
                <View style={styles.guideLineLong} />
                <View style={styles.guideLineShort} />
                <View style={styles.guideLineLong} />
              </View>
            </View>
          </View>

          <Text style={styles.frameHint}>
            Fill the frame with your {selectedIdType}. Avoid glare or shadows.
          </Text>
        </View>
      </View>
    </InSiteCamera>
  );
};

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  idTypeBar: {
    backgroundColor: 'rgba(12, 35, 60, 0.85)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 8,
  },
  idTypePrompt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pillActive: {
    backgroundColor: '#00715D',
    borderColor: '#38BDF8',
  },
  pillText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  frameCenterArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  idCardFrame: {
    width: '94%',
    maxWidth: 360,
    aspectRatio: 1.586, // ISO/IEC 7810 ID-1 card ratio
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#38BDF8',
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.16)',
    position: 'relative',
    justifyContent: 'center',
    padding: 18,
  },
  idCardFrameLandscape: {
    width: '62%',
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: '#10B981',
  },
  cornerTL: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  cornerTR: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
  cornerBL: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
  templateContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    opacity: 0.45,
  },
  photoSlotGuide: {
    width: 68,
    height: 84,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotLabel: {
    color: '#93C5FD',
    fontSize: 9,
    fontWeight: '700',
  },
  linesGuide: {
    flex: 1,
    gap: 10,
  },
  guideLineLong: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(147, 197, 253, 0.5)',
    width: '90%',
  },
  guideLineShort: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(147, 197, 253, 0.35)',
    width: '60%',
  },
  frameHint: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
    gap: 12,
  },
  previewHeader: {
    gap: 4,
  },
  previewHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  previewHeaderSub: {
    color: '#94A3B8',
    fontSize: 12,
  },
  previewImageWrapper: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  qualityBanner: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  qualityBannerPass: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  qualityBannerWarn: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  qualityTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  qualityTitlePass: {
    color: '#065F46',
  },
  qualityTitleWarn: {
    color: '#92400E',
  },
  qualityBody: {
    fontSize: 11,
    color: '#334155',
  },
  previewActions: {
    flexDirection: 'row',
    gap: 10,
  },
  retakeBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#475569',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  retakeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#00715D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

