import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  SiteEvidenceCameraModal,
  type SiteEvidenceBatchSubmission,
} from '../components/camera';
import {
  VoiceNoteBubble,
  VoiceNoteRecorder,
  formatDurationMs,
  type VoiceRecordingResult,
} from '../components/audio';
import { EmptyStateCard, InSiteLoader, Pill } from '../components/common';
import { BackButton } from '../components/inputs/Buttons';
import { captureCurrentGeotag } from '../services/locationService';
import { useProfile } from '../context/ProfileContext';
import {
  useSendWbsMessageMutation,
  useWbsChatMessagesQuery,
} from '../queries/wbs/useWbsQueries';
import type { RootStackParamList } from '../navigation/types';

export const WbsChatThreadScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WbsThread'>>();
  const { wbsItem } = route.params;
  const { profile } = useProfile();

  const userName = profile?.fullName || 'Field Engineer';
  const onBack = () => navigation.goBack();
  const onOpenEodConfirmation = () =>
    navigation.navigate('EodConfirmModal', { wbsItem });
  const [inputText, setInputText] = useState('');
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const insets = useSafeAreaInsets();

  const { data: messages = [], isLoading: loadingMessages } =
    useWbsChatMessagesQuery(wbsItem.id);
  const sendMessageMutation = useSendWbsMessageMutation(wbsItem.id);

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const textToSend = inputText.trim();
    setInputText('');

    await sendMessageMutation.mutateAsync({
      wbsItemId: wbsItem.id,
      senderName: userName,
      senderRole: 'ENGINEER',
      messageType: 'TEXT_COMMENT',
      textContent: textToSend,
      timestamp: 'Just now',
    });
  };

  const handleSnapPhoto = () => {
    setShowCameraModal(true);
  };

  const handleBatchCaptured = async (batch: SiteEvidenceBatchSubmission) => {
    if (batch.photos.length === 0) return;
    const firstGps = batch.photos.find((p) => p.gps)?.gps;
    const photoUris = batch.photos.map((p) => p.dataUri);

    await sendMessageMutation.mutateAsync({
      wbsItemId: wbsItem.id,
      senderName: userName,
      senderRole: 'ENGINEER',
      messageType: 'PHOTO',
      mediaUri: photoUris[0],
      mediaUris: photoUris,
      caption:
        batch.caption ||
        (photoUris.length > 1
          ? `${photoUris.length} site photos captured`
          : `Site progress photo (${batch.photos[0].orientation})`),
      latitude: firstGps?.latitude ?? 6.4698,
      longitude: firstGps?.longitude ?? 3.5852,
      chainageLabel: firstGps
        ? `GPS ${firstGps.latitude.toFixed(4)}, ${firstGps.longitude.toFixed(4)}`
        : 'Ch 14+200',
      timestamp: 'Just now',
    });

    setShowCameraModal(false);
  };

  const handleVoiceNoteRecorded = async (result: VoiceRecordingResult) => {
    const gps = await captureCurrentGeotag(`VOICE_NOTE:${wbsItem.wbsCode}`);
    await sendMessageMutation.mutateAsync({
      wbsItemId: wbsItem.id,
      senderName: userName,
      senderRole: 'ENGINEER',
      messageType: 'VOICE_NOTE',
      mediaUri: result.uri,
      durationMs: result.durationMs,
      waveform: result.waveform,
      textContent: `Voice log (${formatDurationMs(result.durationMs)})`,
      latitude: gps?.latitude,
      longitude: gps?.longitude,
      chainageLabel: gps
        ? gps.chainageLabel ||
          `GPS ${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}`
        : 'Ch 14+200',
      timestamp: 'Just now',
    });

    setShowVoiceRecorder(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Dynamic Gradient Thread Header */}
      <LinearGradient
        colors={['#0891B2', '#1E3A8A', '#312E81', '#1E1B4B']}
        locations={[0, 0.35, 0.75, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.9 }}
        style={[styles.headerGradient, { paddingTop: Math.max(insets.top + 8, 20) }]}
      >
        <View style={styles.headerTop}>
          <BackButton onPress={onBack} text="WBS Inbox" />
          <Pill variant="positive" text="In-Zone · Ch 14+200" />
        </View>

        <Text style={styles.threadWbsTitle}>WBS {wbsItem.wbsCode}</Text>
        <Text style={styles.threadWbsDesc} numberOfLines={1}>
          {wbsItem.description}
        </Text>
      </LinearGradient>

      {/* Curved Chat Stream Container */}
      <View style={styles.curvedContainer}>
        <ScrollView contentContainerStyle={styles.chatStream} showsVerticalScrollIndicator={false}>
        {loadingMessages ? (
          <InSiteLoader size="sm" label="Loading WBS thread..." />
        ) : messages.length === 0 ? (
          <EmptyStateCard
            title={`WBS ${wbsItem.wbsCode} Thread Ready`}
            description="Snap a live site photo, record a voice log, or post a progress/delay note below."
          />
        ) : null}
        {messages.map((msg) => {
          if (msg.messageType === 'MORNING_BRIEF') {
            return (
              <View key={msg.id} style={styles.briefCard}>
                <View style={styles.briefBadgeRow}>
                  <Text style={styles.briefBadgeText}>Workday Start · 08:00 WAT</Text>
                </View>
                <Text style={styles.briefTitle}>Morning Deliverable Brief</Text>
                <Text style={styles.briefBody}>{msg.textContent}</Text>
              </View>
            );
          }

          if (msg.messageType === 'EOD_PROMPT') {
            return (
              <View key={msg.id} style={styles.eodCard}>
                <View style={styles.briefBadgeRow}>
                  <Text style={styles.briefBadgeText}>Workday End · 17:00 WAT</Text>
                </View>
                <Text style={styles.eodTitle}>End-of-Day Wrap-Up</Text>
                <Text style={styles.eodBody}>{msg.textContent}</Text>
                <TouchableOpacity
                  style={styles.eodButton}
                  onPress={onOpenEodConfirmation}
                  activeOpacity={0.8}
                >
                  <Text style={styles.eodButtonText}>Record EOD Summary &amp; Submit</Text>
                </TouchableOpacity>
              </View>
            );
          }

          if (msg.messageType === 'PHOTO') {
            const photoList =
              msg.mediaUris && msg.mediaUris.length > 0
                ? msg.mediaUris
                : msg.mediaUri
                ? [msg.mediaUri]
                : [];
            const isGrid = photoList.length > 1;

            return (
              <View key={msg.id} style={styles.photoMessageContainer}>
                {isGrid ? (
                  <View style={styles.photoBubbleGrid}>
                    {photoList.map((uri, idx) => {
                      const isOddFullSpan =
                        photoList.length % 2 === 1 && idx === 0;
                      return (
                        <Image
                          key={`${msg.id}-img-${idx}`}
                          source={{ uri }}
                          style={[
                            styles.photoGridItem,
                            isOddFullSpan && styles.photoGridItemFull,
                          ]}
                          resizeMode="cover"
                        />
                      );
                    })}
                  </View>
                ) : (
                  photoList[0] && (
                    <Image
                      source={{ uri: photoList[0] }}
                      style={styles.photoImage}
                      resizeMode="cover"
                    />
                  )
                )}

                <View style={styles.photoCaptionBox}>
                  {Boolean(msg.caption) && (
                    <Text style={styles.photoCaptionText}>{msg.caption}</Text>
                  )}
                  <View style={styles.photoMetaRow}>
                    <Text style={styles.photoMetaText}>
                      {msg.chainageLabel || 'Ch 14+200'} · GPS Verified
                    </Text>
                    <Text style={styles.photoMetaText}>{msg.timestamp}</Text>
                  </View>
                </View>
              </View>
            );
          }

          if (msg.messageType === 'VOICE_NOTE') {
            return (
              <VoiceNoteBubble
                key={msg.id}
                senderName={msg.senderName}
                audioUri={msg.mediaUri}
                durationMs={msg.durationMs}
                waveform={msg.waveform}
                timestamp={msg.timestamp}
                chainageLabel={msg.chainageLabel}
                isMe={msg.senderRole === 'ENGINEER'}
              />
            );
          }

          // Text comment bubble
          const isMe = msg.senderRole === 'ENGINEER';
          return (
            <View
              key={msg.id}
              style={[styles.chatBubble, isMe ? styles.chatBubbleMe : styles.chatBubbleOther]}
            >
              <Text style={[styles.bubbleSender, isMe && styles.bubbleSenderMe]}>
                {msg.senderName}
              </Text>
              <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
                {msg.textContent}
              </Text>
              <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                {msg.timestamp}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Bottom Composer */}
      <View style={[styles.composerContainer, { paddingBottom: Math.max(insets.bottom + 6, 12) }]}>
        {showVoiceRecorder && (
          <View style={styles.voiceRecorderWrapper}>
            <VoiceNoteRecorder
              submitLabel="Send Voice Log"
              onRecordingComplete={handleVoiceNoteRecorded}
              onCancel={() => setShowVoiceRecorder(false)}
            />
          </View>
        )}

        <View style={styles.composerRow}>
          <TouchableOpacity
            style={styles.cameraIconBtn}
            onPress={handleSnapPhoto}
            activeOpacity={0.8}
            accessibilityLabel="Snap in-app camera photo"
          >
            <Text style={styles.cameraIconText}>📷</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.cameraIconBtn,
              showVoiceRecorder && styles.micIconBtnActive,
            ]}
            onPress={() => setShowVoiceRecorder((prev) => !prev)}
            activeOpacity={0.8}
            accessibilityLabel="Record field voice note"
          >
            <Text style={styles.cameraIconText}>🎤</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.composerInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder={`Message or delay note for WBS ${wbsItem.wbsCode}...`}
            placeholderTextColor="#94A3B8"
          />

          <TouchableOpacity
            style={styles.sendIconBtn}
            onPress={handleSendText}
            activeOpacity={0.8}
            accessibilityLabel="Send comment"
          >
            <Text style={styles.sendIconText}>➤</Text>
          </TouchableOpacity>
        </View>

        {/* EOD Action Quick Bar */}
        <TouchableOpacity
          style={styles.quickEodBar}
          onPress={onOpenEodConfirmation}
          activeOpacity={0.8}
        >
          <Text style={styles.quickEodBarText}>Wrap Up Workday &amp; Submit AI Summary →</Text>
        </TouchableOpacity>
      </View>
    </View>

      {/* Modular Site Evidence Camera & Batch Caption Modal */}
      <SiteEvidenceCameraModal
        visible={showCameraModal}
        wbsCode={wbsItem.wbsCode}
        onSubmit={handleBatchCaptured}
        onClose={() => setShowCameraModal(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1B4B',
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  curvedContainer: {
    flex: 1,
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButtonWrap: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButton: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38BDF8',
  },
  inZoneBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  inZoneBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  threadWbsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  threadWbsDesc: {
    fontSize: 11,
    color: '#BFDBFE',
    marginTop: 2,
  },
  chatStream: {
    padding: 16,
    gap: 12,
  },
  briefCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    gap: 6,
  },
  briefBadgeRow: {
    alignSelf: 'flex-start',
  },
  briefBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00338D',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  briefTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0C233C',
  },
  briefBody: {
    fontSize: 11,
    color: '#334155',
    lineHeight: 16,
  },
  eodCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#00338D',
    gap: 6,
  },
  eodTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#00338D',
  },
  eodBody: {
    fontSize: 11,
    color: '#334155',
    lineHeight: 16,
  },
  eodButton: {
    backgroundColor: '#00338D',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  eodButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  photoMessageContainer: {
    alignSelf: 'flex-end',
    width: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  photoImage: {
    width: '100%',
    height: 160,
  },
  photoCaptionBox: {
    padding: 10,
    gap: 4,
  },
  photoCaptionText: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '600',
    lineHeight: 15,
  },
  photoMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photoMetaText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  chatBubble: {
    maxWidth: '82%',
    borderRadius: 14,
    padding: 12,
    gap: 3,
  },
  chatBubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: '#00338D',
  },
  chatBubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bubbleSender: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  bubbleSenderMe: {
    color: '#BFDBFE',
  },
  bubbleText: {
    fontSize: 12,
    color: '#0F172A',
    lineHeight: 17,
  },
  bubbleTextMe: {
    color: '#FFFFFF',
  },
  bubbleTime: {
    fontSize: 9,
    color: '#94A3B8',
    alignSelf: 'flex-end',
  },
  bubbleTimeMe: {
    color: '#93C5FD',
  },
  composerContainer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 12,
    gap: 8,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cameraIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIconBtnActive: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  voiceRecorderWrapper: {
    marginBottom: 4,
  },
  cameraIconText: {
    fontSize: 18,
  },
  composerInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12,
    color: '#0F172A',
  },
  sendIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#00338D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIconText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  quickEodBar: {
    backgroundColor: '#0C233C',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  quickEodBarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  photoBubbleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    backgroundColor: '#E2E8F0',
  },
  photoGridItem: {
    width: '49%',
    height: 115,
    flexGrow: 1,
  },
  photoGridItemFull: {
    width: '100%',
    height: 145,
  },
});

