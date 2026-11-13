import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  getWbsChatMessages,
  sendWbsChatMessage,
  WbsChatMessageRecord,
  WbsItemRecord,
} from '../storage/wbsRepository';

interface Props {
  wbsItem: WbsItemRecord;
  userName: string;
  onBack: () => void;
  onOpenEodConfirmation: () => void;
}

export const WbsChatThreadScreen: React.FC<Props> = ({
  wbsItem,
  userName,
  onBack,
  onOpenEodConfirmation,
}) => {
  const [messages, setMessages] = useState<WbsChatMessageRecord[]>([]);
  const [inputText, setInputText] = useState('');

  const loadMessages = async () => {
    const list = await getWbsChatMessages(wbsItem.id);
    setMessages(list);
  };

  useEffect(() => {
    loadMessages();
  }, [wbsItem.id]);

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const textToSend = inputText.trim();
    setInputText('');

    const newMsg = await sendWbsChatMessage({
      wbsItemId: wbsItem.id,
      senderName: userName,
      senderRole: 'ENGINEER',
      messageType: 'TEXT_COMMENT',
      textContent: textToSend,
      timestamp: 'Just now',
    });

    setMessages((prev) => [...prev, newMsg]);
  };

  const handleSnapPhoto = async () => {
    Alert.prompt
      ? Alert.prompt(
          'Photo Caption (Optional)',
          'Add an engineering note or chainage reference:',
          async (caption) => {
            const newMsg = await sendWbsChatMessage({
              wbsItemId: wbsItem.id,
              senderName: userName,
              senderRole: 'ENGINEER',
              messageType: 'PHOTO',
              mediaUri:
                'https://images.unsplash.com/photo-1541888946425-d0fbb1861564?auto=format&fit=crop&w=600&q=80',
              caption: caption || 'Site progress photo at Ch 14+200',
              latitude: 6.4698,
              longitude: 3.5852,
              chainageLabel: 'Ch 14+200',
              timestamp: 'Just now',
            });
            setMessages((prev) => [...prev, newMsg]);
          }
        )
      : (async () => {
          const newMsg = await sendWbsChatMessage({
            wbsItemId: wbsItem.id,
            senderName: userName,
            senderRole: 'ENGINEER',
            messageType: 'PHOTO',
            mediaUri:
              'https://images.unsplash.com/photo-1541888946425-d0fbb1861564?auto=format&fit=crop&w=600&q=80',
            caption: 'Site photo captured · GPS In-Zone',
            latitude: 6.4698,
            longitude: 3.5852,
            chainageLabel: 'Ch 14+200',
            timestamp: 'Just now',
          });
          setMessages((prev) => [...prev, newMsg]);
        })();
  };

  return (
    <View style={styles.container}>
      {/* Thread Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
            <Text style={styles.backButton}>← WBS Inbox</Text>
          </TouchableOpacity>
          <View style={styles.inZoneBadge}>
            <Text style={styles.inZoneBadgeText}>In-Zone · Ch 14+200</Text>
          </View>
        </View>

        <Text style={styles.threadWbsTitle}>WBS {wbsItem.wbsCode}</Text>
        <Text style={styles.threadWbsDesc} numberOfLines={1}>
          {wbsItem.description}
        </Text>
      </View>

      {/* Chat Stream */}
      <ScrollView contentContainerStyle={styles.chatStream} showsVerticalScrollIndicator={false}>
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
            return (
              <View key={msg.id} style={styles.photoMessageContainer}>
                <Image
                  source={{ uri: msg.mediaUri }}
                  style={styles.photoImage}
                  resizeMode="cover"
                />
                <View style={styles.photoCaptionBox}>
                  <Text style={styles.photoCaptionText}>{msg.caption}</Text>
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
      <View style={styles.composerContainer}>
        <View style={styles.composerRow}>
          <TouchableOpacity
            style={styles.cameraIconBtn}
            onPress={handleSnapPhoto}
            activeOpacity={0.8}
            accessibilityLabel="Snap in-app camera photo"
          >
            <Text style={styles.cameraIconText}>📷</Text>
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
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#0C233C',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButton: {
    fontSize: 12,
    fontWeight: '700',
    color: '#93C5FD',
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
});

