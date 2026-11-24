import React from 'react';
import { ActivityIndicator, FlatList, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SiteLogRecord } from '../../utils/siteLog';
import { PICK_FROM_SITE_LOG_EXPLANATION } from '../../utils/formUiModel';
import { FORM_COLORS, formStyles } from './formStyles';

export interface SiteLogPhotoPickerProps {
  visible: boolean;
  loading: boolean;
  /** The slot being filled ("Block A"). */
  slotLabel: string;
  visitDay: string;
  /** From `pickablePhotosForField`, with the photo file to show. */
  entries: Array<{ entry: SiteLogRecord; uri: string | null; statusText: string | null; timeText: string }>;
  /** Photos of the day already sent to the site log (cannot be picked). */
  sentCount: number;
  error: string | null;
  onPick: (entryId: string) => void;
  onClose: () => void;
}

/**
 * "Pick from site log" (D-R5.22): unsent site log photos of this project taken on the visit day. The
 * server refuses a capture that is already a site log entry as an answer, so only unsent entries can
 * move into the form; the sheet says so.
 */
export function SiteLogPhotoPicker({ visible, loading, slotLabel, visitDay, entries, sentCount, error, onPick, onClose }: SiteLogPhotoPickerProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[styles.container, { paddingTop: 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Pick from site log
          </Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the site log picker">
            <Text style={formStyles.link}>Close</Text>
          </TouchableOpacity>
        </View>
        <Text style={formStyles.meta}>
          For: {slotLabel} · photos of {visitDay}
        </Text>
        <Text style={[formStyles.meta, { marginTop: 8 }]}>{PICK_FROM_SITE_LOG_EXPLANATION}</Text>
        {sentCount > 0 && (
          <Text style={[formStyles.meta, { marginTop: 8 }]}>
            {sentCount} photo{sentCount === 1 ? '' : 's'} of this day {sentCount === 1 ? 'is' : 'are'} already in the site log and cannot be used here.
          </Text>
        )}
        {error ? <Text style={formStyles.error}>{error}</Text> : null}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel="Loading site log photos" />
        ) : (
          <FlatList
            style={{ marginTop: 12 }}
            data={entries}
            keyExtractor={(e) => e.entry.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 12 }}
            contentContainerStyle={{ gap: 12 }}
            ListEmptyComponent={<Text style={formStyles.meta}>No unsent site log photos from this day.</Text>}
            renderItem={({ item, index }) => {
              return (
                <TouchableOpacity
                  style={styles.tile}
                  onPress={() => onPick(item.entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use site log photo ${index + 1}, taken at ${item.timeText}${item.statusText ? `, ${item.statusText}` : ''}${item.entry.text ? `, ${item.entry.text}` : ''}`}
                >
                  {item.uri ? <Image source={{ uri: item.uri }} style={styles.image} /> : <View style={[styles.image, styles.noImage]}><Text style={formStyles.meta}>No file</Text></View>}
                  <Text style={formStyles.meta}>Taken {item.timeText}</Text>
                  {item.statusText ? <Text style={[formStyles.meta, { color: FORM_COLORS.error }]}>{item.statusText}</Text> : null}
                  {item.entry.text ? (
                    <Text style={formStyles.meta} numberOfLines={2}>
                      {item.entry.text}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FORM_COLORS.page, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: FORM_COLORS.text },
  tile: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 8 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: '#E2E8F0' },
  noImage: { alignItems: 'center', justifyContent: 'center' },
});
