import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { EmptyStateCard, GradientHeaderLayout, InSiteLoader } from '../components/common';
import { BackButton } from '../components/inputs/Buttons';
import { VoiceNoteBubble } from '../components/audio';
import { OutlineButton, StatusBadges, visitUiStyles } from '../components/visit/VisitUi';
import { useProfile } from '../context/ProfileContext';
import { useOutboxStatus, useVisitData } from '../hooks/useVisitData';
import { hydrateBaselinePack } from '../storage/baselineStore';
import { listSiteLogEntries, siteLogEntryOutboxState } from '../storage/siteLogStore';
import { captureDisplayUri, getCaptures, type CaptureRecord } from '../storage/captureStore';
import { geofenceBadgeText } from '../services/locationService';
import type { RootStackParamList } from '../navigation/types';
import { personaCopy } from '../utils/personaCopy';
import { formatTime, siteLogStateBadge } from '../utils/visitText';
import type { SiteLogRecord } from '../utils/siteLog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KIND_TEXT: Record<SiteLogRecord['kind'], { label: string; icon: keyof typeof Feather.glyphMap }> = {
  PHOTO: { label: 'Photo', icon: 'camera' },
  VOICE: { label: 'Voice note', icon: 'mic' },
  NOTE: { label: 'Note', icon: 'file-text' },
};

/**
 * Redesign R5d (D-R5.22): a project's site log on this phone, newest first, each with its upload
 * state. A voice note shows the server's transcript once the server produced one (Whisper, D-R5.13);
 * none is ever made up on the phone. New entries: photo, voice note or note, offline.
 */
export function SiteLogScreen() {
  const navigation = useNavigation<Nav>();
  const { projectId } = useRoute<RouteProp<RootStackParamList, 'SiteLog'>>().params;
  const { projects, branding, displayName } = useProfile();
  const project = projects.find((p) => p.projectId === projectId) ?? null;
  const copy = personaCopy(project?.fieldPersonaType, branding.terminology);
  const outbox = useOutboxStatus();

  const { data, loading, reload } = useVisitData(
    async () => {
      const [entries, pack] = await Promise.all([listSiteLogEntries(projectId), hydrateBaselinePack(projectId)]);
      const captureIds = entries.map((e) => e.captureId).filter((id): id is string => Boolean(id));
      const captures = new Map((await getCaptures(captureIds)).map((c) => [c.id, c] as const));
      const rows = new Map(await Promise.all(entries.map(async (e) => [e.id, await siteLogEntryOutboxState(e.id)] as const)));
      return { entries, pack, captures, rows };
    },
    [projectId],
    ['siteLog', 'captures', 'packs']
  );
  // Upload states follow the outbox as it sends.
  useEffect(() => {
    reload();
  }, [outbox.pendingCount, outbox.deadCount, reload]);

  const add = (kind: 'PHOTO' | 'VOICE' | 'NOTE') => navigation.navigate('SiteLogEntry', { projectId, kind });

  return (
    <GradientHeaderLayout
      title="Site log"
      subtitle={data?.pack?.codePrefix ?? project?.projectCodePrefix}
      leftAction={<BackButton onPress={() => navigation.goBack()} />}
      contentContainerStyle={styles.body}
    >
      <Text style={visitUiStyles.muted}>{copy.siteLogSubtitle}</Text>
      <View style={styles.addRow}>
        <OutlineButton text="Photo" icon="camera" onPress={() => add('PHOTO')} accessibilityLabel="Add a site log photo" style={styles.add} />
        <OutlineButton text="Voice note" icon="mic" onPress={() => add('VOICE')} accessibilityLabel="Add a site log voice note" style={styles.add} />
        <OutlineButton text="Note" icon="edit-3" onPress={() => add('NOTE')} accessibilityLabel="Add a site log note" style={styles.add} />
      </View>
      {loading && !data ? (
        <InSiteLoader size="md" />
      ) : !data || data.entries.length === 0 ? (
        <EmptyStateCard title="Nothing logged yet" description="Entries you make on this phone appear here." />
      ) : (
        data.entries.map((e) => (
          <EntryCard key={e.id} entry={e} capture={e.captureId ? data.captures.get(e.captureId) ?? null : null} row={data.rows.get(e.id) ?? null} author={displayName} />
        ))
      )}
    </GradientHeaderLayout>
  );
}

function EntryCard({
  entry,
  capture,
  row,
  author,
}: {
  entry: SiteLogRecord;
  capture: CaptureRecord | null;
  row: Awaited<ReturnType<typeof siteLogEntryOutboxState>>;
  author: string;
}) {
  const kind = KIND_TEXT[entry.kind];
  const uri = capture ? captureDisplayUri(capture) : null;
  const place =
    entry.latitude == null && !capture?.fix
      ? 'No location'
      : geofenceBadgeText(capture?.server?.geofenceStatus ?? entry.geofenceStatus, null) ?? 'Location recorded';
  const transcript = capture?.server?.transcriptionStatus === 'DONE' ? capture.server.transcript?.trim() || null : null;
  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.cardHeader}>
        <Feather name={kind.icon} size={16} color="#1E3A8A" />
        <Text style={visitUiStyles.strong}>{kind.label}</Text>
        <Text style={[visitUiStyles.muted, styles.flex]}>
          {formatTime(entry.capturedAt)} · {place}
        </Text>
      </View>
      {entry.kind === 'PHOTO' &&
        (uri ? (
          <Image source={{ uri }} style={styles.photo} resizeMode="cover" accessibilityLabel={`Site photo taken ${formatTime(entry.capturedAt)}`} />
        ) : (
          <Text style={visitUiStyles.muted}>The photo file was cleared from this phone after upload.</Text>
        ))}
      {entry.kind === 'VOICE' && (
        <>
          <VoiceNoteBubble
            senderName={author}
            audioUri={uri ?? undefined}
            durationMs={capture?.durationSeconds ? capture.durationSeconds * 1000 : 0}
            timestamp={formatTime(entry.capturedAt)}
          />
          {transcript ? (
            <View style={styles.transcript}>
              <Text style={styles.transcriptLabel}>Transcript (made on the server)</Text>
              <Text style={visitUiStyles.body}>{transcript}</Text>
            </View>
          ) : null}
        </>
      )}
      {entry.text ? <Text style={visitUiStyles.body}>{entry.text}</Text> : null}
      <StatusBadges badges={[siteLogStateBadge(entry, row)]} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingBottom: 40 },
  addRow: { flexDirection: 'row', gap: 8 },
  add: { flex: 1 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, textAlign: 'right' },
  photo: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#E2E8F0' },
  transcript: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, gap: 4 },
  transcriptLabel: { fontSize: 10, fontWeight: '800', color: '#64748B', textTransform: 'uppercase' },
});
