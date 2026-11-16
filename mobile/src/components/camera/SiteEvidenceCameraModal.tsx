import React, { useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InSiteCamera } from './InSiteCamera';
import type { CameraCaptureResult } from './types';

export interface SiteEvidenceBatchSubmission {
  photos: CameraCaptureResult[];
  caption: string;
}

interface Props {
  visible: boolean;
  wbsCode: string;
  onSubmit: (batch: SiteEvidenceBatchSubmission) => void;
  onClose: () => void;
}

export const SiteEvidenceCameraModal: React.FC<Props> = ({
  visible,
  wbsCode,
  onSubmit,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [capturedPhotos, setCapturedPhotos] = useState<CameraCaptureResult[]>([]);
  const [isTakingPhoto, setIsTakingPhoto] = useState(true);
  const [caption, setCaption] = useState('');

  const resetAndClose = () => {
    setCapturedPhotos([]);
    setCaption('');
    setIsTakingPhoto(true);
    onClose();
  };

  const handlePhotoCaptured = (result: CameraCaptureResult) => {
    setCapturedPhotos((prev) => [...prev, result]);
    setIsTakingPhoto(false);
  };

  const handleRemovePhoto = (indexToRemove: number) => {
    setCapturedPhotos((prev) => {
      const next = prev.filter((_, idx) => idx !== indexToRemove);
      if (next.length === 0) {
        setIsTakingPhoto(true);
      }
      return next;
    });
  };

  const handleSubmitBatch = () => {
    if (capturedPhotos.length === 0) return;
    onSubmit({
      photos: capturedPhotos,
      caption: caption.trim(),
    });
    setCapturedPhotos([]);
    setCaption('');
    setIsTakingPhoto(true);
  };

  const latestGps = capturedPhotos.find((p) => p.gps)?.gps;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={resetAndClose}>
      {isTakingPhoto ? (
        <InSiteCamera
          captureType="shutter"
          geoTag={true}
          initialFacing="back"
          allowFlipCamera={true}
          allowFlashToggle={true}
          title={`WBS ${wbsCode} · Site Evidence`}
          subtitle={
            capturedPhotos.length > 0
              ? `Adding photo #${capturedPhotos.length + 1} to current batch`
              : 'Live geotagged capture only'
          }
          onCapture={handlePhotoCaptured}
          onCancel={() => {
            if (capturedPhotos.length > 0) {
              // Return to batch review if user already captured at least one photo
              setIsTakingPhoto(false);
            } else {
              resetAndClose();
            }
          }}
        />
      ) : (
        <View style={[styles.reviewRoot, { paddingTop: Math.max(insets.top + 8, 20) }]}>
          <StatusBar style="light" />
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>
                Site Evidence ({capturedPhotos.length}{' '}
                {capturedPhotos.length === 1 ? 'Photo' : 'Photos'})
              </Text>
              <TouchableOpacity onPress={resetAndClose} activeOpacity={0.7}>
                <Text style={styles.cancelText}>Discard</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.headerSub}>
              {latestGps
                ? `GPS Locked: ${latestGps.latitude.toFixed(5)}, ${latestGps.longitude.toFixed(5)}`
                : 'Captured offline · GPS pending'}
            </Text>
          </View>

          {/* Multi-Photo Grid Preview */}
          <ScrollView contentContainerStyle={styles.gridScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.photoGrid}>
              {capturedPhotos.map((photo, index) => (
                <View
                  key={`${photo.capturedAt}-${index}`}
                  style={[
                    styles.gridTile,
                    capturedPhotos.length === 1 && styles.gridTileSingle,
                  ]}
                >
                  <Image
                    source={{ uri: photo.dataUri }}
                    style={styles.gridImage}
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    style={styles.removeTileBtn}
                    onPress={() => handleRemovePhoto(index)}
                    activeOpacity={0.8}
                    accessibilityLabel={`Remove photo ${index + 1}`}
                  >
                    <Text style={styles.removeTileText}>✕</Text>
                  </TouchableOpacity>
                  <View style={styles.angleBadge}>
                    <Text style={styles.angleBadgeText}>#{index + 1}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Add Another Angle / Photo Button */}
            <TouchableOpacity
              style={styles.addAnotherBtn}
              onPress={() => setIsTakingPhoto(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.addAnotherText}>+ Add Another Angle / Photo</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Shared Caption & Submit Footer */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 12, 16) }]}>
            <Text style={styles.captionLabel}>
              Shared Description / Caption (Optional)
            </Text>
            <TextInput
              style={styles.captionInput}
              value={caption}
              onChangeText={setCaption}
              placeholder="Describe all captured angles (e.g. Invert slab rebar @ Ch 14+200)..."
              placeholderTextColor="#94A3B8"
              multiline
            />

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleSubmitBatch}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>
                Attach {capturedPhotos.length}{' '}
                {capturedPhotos.length === 1 ? 'Photo' : 'Photos'} to Thread
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  reviewRoot: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 3,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  cancelText: {
    color: '#FDA4AF',
    fontSize: 13,
    fontWeight: '700',
  },
  headerSub: {
    color: '#93C5FD',
    fontSize: 11,
  },
  gridScroll: {
    padding: 16,
    gap: 14,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridTile: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative',
  },
  gridTileSingle: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  removeTileBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeTileText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  angleBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(12, 35, 60, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  angleBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  addAnotherBtn: {
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  addAnotherText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    backgroundColor: '#1E293B',
    padding: 16,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 10,
  },
  captionLabel: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
  },
  captionInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    color: '#0F172A',
    minHeight: 68,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});

