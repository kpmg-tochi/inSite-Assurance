import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';

interface Props {
  onClose: () => void;
  onBatchConfirmed: () => void;
}

export const BacklogReviewModal: React.FC<Props> = ({ onClose, onBatchConfirmed }) => {
  const [backlogItems, setBacklogItems] = useState([
    {
      id: 'backlog-01',
      wbsCode: '02.03.1',
      title: 'Box Culvert Rebar Tying & Formwork',
      date: 'Today · 11:45 WAT',
      quantity: '12.0 m3 C25',
      photosCount: 2,
      selected: true,
    },
    {
      id: 'backlog-02',
      wbsCode: '01.02.4',
      title: 'Sub-base Compaction Layer 2 Density Test',
      date: 'Yesterday · 16:30 WAT',
      quantity: '450 m2',
      photosCount: 1,
      selected: true,
    },
    {
      id: 'backlog-03',
      wbsCode: '02.03.1',
      title: 'Blinding Concrete Pour & Excavation Clearance',
      date: '2 days ago',
      quantity: '8.5 m3',
      photosCount: 3,
      selected: true,
    },
  ]);

  const [isProcessing, setIsProcessing] = useState(false);

  const toggleItem = (id: string) => {
    setBacklogItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleProcessBatch = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      Alert.alert(
        'Backlog Synced',
        '3 field reports parsed with AI and confirmed. Added to the project ledger with Supported evidence rating.',
        [{ text: 'OK', onPress: onBatchConfirmed }]
      );
    }, 1200);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
          <View style={styles.badgeSuccess}>
            <Text style={styles.badgeSuccessText}>Account Verified</Text>
          </View>
        </View>
        <Text style={styles.title}>Queued Report Backlog</Text>
        <Text style={styles.subtitle}>
          Your contractor credentials have been approved! Review and confirm your queued field
          submissions before sending them to the Independent Monitor.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {backlogItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.itemCard, item.selected && styles.itemCardSelected]}
            onPress={() => toggleItem(item.id)}
            activeOpacity={0.8}
          >
            <View style={styles.itemTop}>
              <View style={styles.wbsPill}>
                <Text style={styles.wbsPillText}>WBS {item.wbsCode}</Text>
              </View>
              <Text style={styles.itemDate}>{item.date}</Text>
            </View>

            <Text style={styles.itemTitle}>{item.title}</Text>

            <View style={styles.itemMeta}>
              <Text style={styles.itemMetaText}>Reported: {item.quantity}</Text>
              <Text style={styles.itemMetaText}>📷 {item.photosCount} photos attached</Text>
            </View>
          </TouchableOpacity>
        ))}

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Batch AI Verification</Text>
          <Text style={styles.infoText}>
            Submitting this backlog will execute Whisper transcription and Azure Vision on your
            captured site evidence and map each quantity to the facility BOQ baseline.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, isProcessing && { opacity: 0.7 }]}
          onPress={handleProcessBatch}
          disabled={isProcessing}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>
            {isProcessing ? 'Processing Backlog AI...' : 'Parse & Confirm All Backlog Items'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  closeText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '700',
  },
  badgeSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  badgeSuccessText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    color: '#BFDBFE',
    marginTop: 4,
    lineHeight: 16,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  itemCardSelected: {
    borderColor: '#00338D',
    borderWidth: 1.5,
    backgroundColor: '#F8FAFC',
  },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wbsPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  wbsPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00338D',
  },
  itemDate: {
    fontSize: 10,
    color: '#94A3B8',
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  itemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  itemMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00338D',
    marginBottom: 3,
  },
  infoText: {
    fontSize: 11,
    color: '#1E3A8A',
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

