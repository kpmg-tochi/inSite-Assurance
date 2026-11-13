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
import { submitIncidentReport } from '../services/incidentService';

interface Props {
  projectId: string;
  sessionToken: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export const SpecialIncidentModal: React.FC<Props> = ({
  projectId,
  sessionToken,
  onClose,
  onSubmitted,
}) => {
  const [category, setCategory] = useState<'WHISTLEBLOWING' | 'SITE_EMERGENCY' | 'CRITICAL_DELAY' | 'MATERIAL_FAILURE'>(
    'WHISTLEBLOWING'
  );
  const [severity, setSeverity] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM'>('HIGH');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isConfidential, setIsConfidential] = useState(true);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Required', 'Please describe the incident or escalation reason.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitIncidentReport(projectId, sessionToken, {
        projectId,
        category,
        severity,
        title: title.trim() || `${category.replace('_', ' ')} Report`,
        description: description.trim(),
        isConfidentialWhistleblower: isConfidential,
        photoEvidenceUrls: hasPhoto
          ? ['https://images.unsplash.com/photo-1541888946425-d0fbb1861564?auto=format&fit=crop&w=600&q=80']
          : [],
        deviceGpsCoordinates: {
          latitude: 6.4698,
          longitude: 3.5852,
          accuracyMeters: 4.2,
        },
      });

      if (result.success) {
        Alert.alert(
          'Incident Transmitted',
          isConfidential
            ? 'Protected disclosure submitted with Confidential Shield. Routed strictly to Independent Monitor and Lender.'
            : 'Escalation alert submitted to facility governance log.',
          [{ text: 'OK', onPress: onSubmitted }]
        );
      }
    } catch (e: any) {
      Alert.alert('Submission Error', e.message || 'Failed to submit incident report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.iconTag}>
            <Text style={styles.iconTagText}>!</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.title}>Special Incident &amp; Escalation</Text>
            <Text style={styles.subtitle}>Direct Alert to Monitor &amp; Lender</Text>
          </View>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close ✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Category Picker */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Select Escalation Category *</Text>
          <View style={styles.categoryGrid}>
            {[
              { key: 'WHISTLEBLOWING', label: 'Whistleblowing / Fraud' },
              { key: 'SITE_EMERGENCY', label: 'Site Safety Emergency' },
              { key: 'CRITICAL_DELAY', label: 'Critical Delay Blocker' },
              { key: 'MATERIAL_FAILURE', label: 'Material Quality Failure' },
            ].map((cat) => (
              <TouchableOpacity
                key={cat.key}
                style={[
                  styles.categoryBtn,
                  category === cat.key && styles.categoryBtnActive,
                ]}
                onPress={() => setCategory(cat.key as any)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.categoryBtnText,
                    category === cat.key && styles.categoryBtnTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Confidential Whistleblower Shield Card */}
        <TouchableOpacity
          style={styles.shieldCard}
          onPress={() => setIsConfidential(!isConfidential)}
          activeOpacity={0.8}
        >
          <View style={styles.shieldTop}>
            <Text style={styles.shieldTitle}>
              Confidential Shield: {isConfidential ? 'ENABLED' : 'DISABLED'}
            </Text>
            <View style={[styles.switch, isConfidential && styles.switchOn]}>
              <View style={[styles.switchKnob, isConfidential && styles.switchKnobOn]} />
            </View>
          </View>
          <Text style={styles.shieldBody}>
            When enabled, this submission is strictly hidden from the contractor portal and routed
            directly to the Independent Project Monitor and Lender Credit Risk Officer under statutory
            whistleblower protection.
          </Text>
        </TouchableOpacity>

        {/* Incident Details */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Incident Headline (Optional)</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Sub-standard steel rebar batch delivered on site"
            placeholderTextColor="#94A3B8"
          />

          <View style={{ marginTop: 12 }}>
            <Text style={styles.fieldLabel}>Incident Description &amp; Evidence Summary *</Text>
            <TextInput
              style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Provide exact location, chainage, contractor personnel involved, and observed defect or safety risk..."
              placeholderTextColor="#94A3B8"
              multiline
            />
          </View>
        </View>

        {/* Optional Photo Attachment */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Photo Evidence Attachment</Text>
          <TouchableOpacity
            style={[styles.photoButton, hasPhoto && styles.photoButtonAttached]}
            onPress={() => setHasPhoto(!hasPhoto)}
            activeOpacity={0.8}
          >
            <Text style={styles.photoButtonText}>
              {hasPhoto ? '✓ Photo Evidence Attached (Ch 14+200)' : '📷 Snap Supporting Photo'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          activeOpacity={0.8}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? 'Transmitting Escalation...' : 'Transmit Escalation to Monitor & Lender'}
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
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconTag: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#E11D48',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F43F5E',
  },
  iconTagText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 11,
    color: '#93C5FD',
  },
  closeText: {
    fontSize: 13,
    color: '#93C5FD',
    fontWeight: '700',
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
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryBtn: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  categoryBtnActive: {
    backgroundColor: '#E11D48',
    borderColor: '#E11D48',
  },
  categoryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  categoryBtnTextActive: {
    color: '#FFFFFF',
  },
  shieldCard: {
    backgroundColor: '#FFF1F2',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FECDD3',
    gap: 6,
  },
  shieldTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shieldTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#9F1239',
  },
  switch: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#CBD5E1',
    padding: 2,
  },
  switchOn: {
    backgroundColor: '#E11D48',
  },
  switchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  switchKnobOn: {
    marginLeft: 16,
  },
  shieldBody: {
    fontSize: 11,
    color: '#881337',
    lineHeight: 16,
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
  photoButton: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
  },
  photoButtonAttached: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderStyle: 'solid',
  },
  photoButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00338D',
  },
  submitButton: {
    backgroundColor: '#E11D48',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

