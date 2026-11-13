import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { WbsItemRecord } from '../storage/wbsRepository';

interface Props {
  wbsItem: WbsItemRecord;
  onConfirmed: (quantity: number, summary: string) => void;
  onCancel: () => void;
}

export const ConfirmAiSummarySheet: React.FC<Props> = ({
  wbsItem,
  onConfirmed,
  onCancel,
}) => {
  const [quantity, setQuantity] = useState('12.0');
  const [unit, setUnit] = useState(wbsItem.unit || 'm3');
  const [summary, setSummary] = useState(
    'Box culvert invert slab pour completed at Ch 14+200 using C25 ready-mix concrete.'
  );
  const [blockers, setBlockers] = useState(
    'Transit mixer delayed by 45 mins due to expressway checkpoint traffic.'
  );
  const [holdPointSigned, setHoldPointSigned] = useState(true);

  const handleConfirm = () => {
    const qNum = parseFloat(quantity);
    if (isNaN(qNum) || qNum <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid positive quantity.');
      return;
    }
    onConfirmed(qNum, summary);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Human Sign-Off Required</Text>
          </View>
        </View>
        <Text style={styles.title}>Confirm AI Daily Summary</Text>
        <Text style={styles.subtitle}>
          Review and edit the extracted quantities before syncing to the reconciliation ledger.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* WBS Target Card */}
        <View style={styles.card}>
          <View style={styles.wbsTag}>
            <Text style={styles.wbsTagText}>WBS {wbsItem.wbsCode}</Text>
          </View>
          <Text style={styles.wbsTitle}>{wbsItem.description}</Text>
        </View>

        {/* AI Parsed Summary Card */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Workday Summary *</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            value={summary}
            onChangeText={setSummary}
            multiline
          />
        </View>

        {/* Quantities Form */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Reported Quantity for Today *</Text>
          <View style={styles.quantityRow}>
            <TextInput
              style={[styles.input, styles.quantityInput]}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.unitInput]}
              value={unit}
              onChangeText={setUnit}
            />
          </View>

          {/* Hold-point Checkbox */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setHoldPointSigned(!holdPointSigned)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, holdPointSigned && styles.checkboxActive]}>
              {holdPointSigned && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              I certify that rebar bar-bending schedule and invert levels complied with Hold-Point
              standards.
            </Text>
          </TouchableOpacity>
        </View>

        {/* Delays & Blockers */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Site Blockers &amp; Weather Notes</Text>
          <TextInput
            style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
            value={blockers}
            onChangeText={setBlockers}
            multiline
          />
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleConfirm}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Sign Off &amp; Sync Report</Text>
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
  cancelText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  badgeText: {
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  wbsTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  wbsTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00338D',
  },
  wbsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  quantityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quantityInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#00338D',
  },
  unitInput: {
    width: 100,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: '#0F172A',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: '#00338D',
    borderColor: '#00338D',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 11,
    color: '#334155',
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: '#00338D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

