import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import type { MobileBaselinePack, VisitResponseAction } from '@insite/shared';
import { Avatar, BrandGradient, EmptyStateCard, InSiteLoader } from '../components/common';
import { PrimaryButton } from '../components/inputs/Buttons';
import { VisitCalendar, type CalendarMode } from '../components/visit/VisitCalendar';
import { VisitRow } from '../components/visit/VisitRow';
import { ProjectCard } from '../components/visit/ProjectCard';
import { SectionCard } from '../components/visit/VisitUi';
import { useProfile } from '../context/ProfileContext';
import { useOutboxStatus, useVisitData, useVisitSyncStatus } from '../hooks/useVisitData';
import { useAccountNotificationsQuery } from '../queries/notifications/useNotificationQueries';
import { loadBaselinePacks } from '../storage/baselineStore';
import { getCachedWindow, listVisits } from '../storage/visitStore';
import { outboxCountsByProject } from '../storage/outbox/outboxStore';
import { fetchVisitRange } from '../services/visitSync';
import { requestPushPermissionInContext } from '../services/pushNotificationService';
import type { RootStackParamList } from '../navigation/types';
import { homeMode, projectCardModel } from '../utils/homeLayout';
import {
  dotsByDay,
  groupVisitsByDay,
  monthOf,
  monthRange,
  projectToday,
  rangeInWindow,
  visitsNeedingAttention,
  visitView,
  weekDates,
  type VisitView,
} from '../utils/visitCalendar';
import { personaCopy } from '../utils/personaCopy';
import { showDefectsShortcut } from '../utils/defects';
import { formatDay, formatTime, greeting } from '../utils/visitText';
import { formatMobileErrorMessage } from '../utils/errorFormatter';
import type { StoredVisit } from '../utils/visitModel';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Redesign R5b: Home for every field role (D-R5.2, D-R5.7). Calendar (week ⇄ month), the selected
 * day's visits with their responses, and the account's projects; one ACTIVE project opens fully.
 * Everything is read from SQLite (visits, packs); pull to refresh re-lists projects, prepares each
 * and forces a visit download (`refreshAll`).
 */
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { account, projects, displayName, userInitials, refreshAll, activeContext, branding, pushIdentities } = useProfile();
  const copy = personaCopy(activeContext?.fieldPersonaType, branding.terminology);
  const sync = useVisitSyncStatus();
  const outbox = useOutboxStatus();
  const projectIds = useMemo(() => projects.map((p) => p.projectId), [projects]);
  const projectKey = projectIds.join(',');

  const { data, loading, reload } = useVisitData(
    async () => {
      const [packs, visits, storedWindow] = await Promise.all([loadBaselinePacks(projectIds), listVisits(), getCachedWindow()]);
      return { packs, visits, storedWindow };
    },
    [projectKey],
    ['visits', 'packs', 'drafts']
  );

  const [counts, setCounts] = useState<Map<string, { pending: number; dead: number }>>(new Map());
  useEffect(() => {
    outboxCountsByProject().then(setCounts).catch(() => undefined);
  }, [outbox.pendingCount, outbox.deadCount]);

  const { data: notificationData } = useAccountNotificationsQuery(projectIds, Boolean(account));
  const notifications = notificationData?.items ?? [];
  const unread = notifications.filter((n) => !n.isRead).length;

  const packs = useMemo(() => data?.packs ?? new Map<string, MobileBaselinePack>(), [data]);
  const todayFor = useCallback((projectId: string) => projectToday(packs.get(projectId)?.timezone), [packs]);
  const firstZone = projectIds.map((id) => packs.get(id)?.timezone).find(Boolean) ?? null;
  const homeToday = projectToday(firstZone);

  const storedById = useMemo(() => new Map((data?.visits ?? []).map((v) => [v.id, v] as const)), [data]);
  const views = useMemo<VisitView[]>(() => (data?.visits ?? []).map((v) => visitView(v, todayFor(v.projectId))), [data, todayFor]);
  const byDay = useMemo(() => groupVisitsByDay(views), [views]);
  const dots = useMemo(() => dotsByDay(views), [views]);
  const attention = useMemo(() => visitsNeedingAttention(views), [views]);

  const [selected, setSelected] = useState<string | null>(null);
  const selectedDate = selected ?? homeToday;
  const [mode, setMode] = useState<CalendarMode>('WEEK');
  const [visibleMonth, setVisibleMonth] = useState<string>(monthOf(homeToday));

  // D-R5.5: outside the cached window, fetch the range online (no forms); offline, say so.
  const windowFrom = sync.window?.from ?? data?.storedWindow?.from ?? null;
  const windowTo = sync.window?.to ?? data?.storedWindow?.to ?? null;
  const cachedWindow = useMemo(() => (windowFrom && windowTo ? { from: windowFrom, to: windowTo } : null), [windowFrom, windowTo]);
  const shownRange = useMemo(() => {
    if (mode === 'MONTH') return monthRange(visibleMonth);
    const w = weekDates(selectedDate);
    return { from: w[0], to: w[6] };
  }, [mode, visibleMonth, selectedDate]);
  const fetched = useRef(new Set<string>());
  const [rangeFailed, setRangeFailed] = useState<string | null>(null);
  const rangeKey = `${shownRange.from}:${shownRange.to}`;
  const outsideWindow = !rangeInWindow(shownRange, cachedWindow);
  useEffect(() => {
    if (!outsideWindow || fetched.current.has(rangeKey) || !cachedWindow) return;
    if (!outbox.isOnline) {
      setRangeFailed(rangeKey);
      return;
    }
    let cancelled = false;
    fetchVisitRange(shownRange.from, shownRange.to)
      .then(() => {
        fetched.current.add(rangeKey);
        if (!cancelled) {
          setRangeFailed(null);
          reload();
        }
      })
      .catch(() => {
        if (!cancelled) setRangeFailed(rangeKey);
      });
    return () => {
      cancelled = true;
    };
  }, [outsideWindow, rangeKey, outbox.isOnline, cachedWindow, shownRange.from, shownRange.to, reload]);
  const calendarNotice =
    outsideWindow && rangeFailed === rangeKey && cachedWindow
      ? `Showing what is on this phone. Visits from ${formatDay(cachedWindow.from)} to ${formatDay(cachedWindow.to)} are kept offline; connect to see the rest.`
      : null;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      fetched.current.clear();
      await refreshAll();
    } catch (err) {
      Toast.show({ type: 'error', props: { title: 'Could not refresh', message: formatMobileErrorMessage(err) } });
    } finally {
      reload();
      setRefreshing(false);
    }
  };

  const canSubmitOn = useCallback(
    (projectId: string) => Boolean(projects.find((p) => p.projectId === projectId)?.permissions.includes('visits:submit')),
    [projects]
  );
  const layout = homeMode(projects.map((p) => ({ projectId: p.projectId, projectStatus: packs.get(p.projectId)?.projectStatus })));
  const singleProjectId = layout.mode === 'SINGLE' ? layout.projectId : null;
  const showProjectOnRows = projects.length > 1;
  const canUnscheduled = projects.some((p) => p.permissions.includes('visits:submit'));

  const openProject = (projectId: string) => {
    void requestPushPermissionInContext(pushIdentities);
    navigation.navigate('Project', { projectId });
  };
  const openVisit = (visitId: string) => navigation.navigate('Visit', { visitId });
  const respond = (v: StoredVisit, action: VisitResponseAction) => navigation.navigate('VisitRespond', { visitId: v.id, action });

  const dayVisits = byDay.get(selectedDate) ?? [];
  const cards = projects.map((p) => {
    const pack = packs.get(p.projectId) ?? null;
    return {
      project: p,
      pack,
      model: projectCardModel({ projectId: p.projectId, code: p.projectCodePrefix, name: p.projectName }, pack, views, todayFor(p.projectId)),
    };
  });
  // D-R5.7: the one active project first, shown fully; other (not active) projects stay listed below.
  const orderedCards = singleProjectId
    ? [...cards.filter((c) => c.project.projectId === singleProjectId), ...cards.filter((c) => c.project.projectId !== singleProjectId)]
    : cards;

  const firstName = displayName.split(' ')[0] ?? '';
  let syncLine = copy.homeSubtitle;
  if (sync.isSyncing) syncLine = 'Updating your visits…';
  else if (sync.lastError) syncLine = 'Not updated: showing what is on this phone';
  else if (sync.lastSyncedAt) syncLine = `${copy.homeSubtitle} · updated ${formatTime(sync.lastSyncedAt)}`;
  const outboxCount = outbox.pendingCount + outbox.deadCount;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
        <BrandGradient />
        <View style={styles.headerRow}>
          <View style={styles.headerTexts}>
            <Text style={styles.greeting} accessibilityRole="header">
              {greeting(new Date().getHours())}
              {firstName ? `, ${firstName}` : ''}
            </Text>
            <Text style={styles.headerSubtitle}>{syncLine}</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate('NotificationsModal')}
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <Feather name="bell" size={16} color="#FFFFFF" />
              {unread > 0 && <View style={styles.dot} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate('Outbox')}
              accessibilityRole="button"
              accessibilityLabel={
                outboxCount > 0
                  ? `Outbox, ${outboxCount} waiting to send${outbox.deadCount ? `, ${outbox.deadCount} failed` : ''}`
                  : 'Outbox, nothing waiting'
              }
            >
              <Feather name="upload-cloud" size={16} color="#FFFFFF" />
              {outboxCount > 0 && (
                <View style={[styles.badge, outbox.deadCount > 0 && styles.badgeDead]}>
                  <Text style={styles.badgeText}>{outboxCount > 99 ? '99+' : outboxCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <Avatar
              size="xs"
              forceInitials={userInitials}
              showOnlineDot={outbox.isOnline}
              onPress={() => navigation.navigate('ProfileModal')}
              accessibilityLabel="Profile, settings and sign out"
            />
          </View>
        </View>
        {(outbox.pausedReason || !outbox.isOnline) && (
          <Text style={styles.headerNote}>{outbox.pausedReason ?? 'Offline. Everything you do is saved on this phone and sent later.'}</Text>
        )}
      </View>

      <View style={styles.content}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        >
          {loading && !data ? (
            <InSiteLoader size="md" label="Loading your visits..." />
          ) : projects.length === 0 ? (
            <EmptyStateCard
              title="No projects assigned"
              description="Ask your administrator to assign you to a project, then pull down to refresh."
              actionLabel="Refresh"
              onAction={() => void onRefresh()}
            />
          ) : (
            <>
              {attention.length > 0 && (
                <TouchableOpacity
                  style={styles.attention}
                  onPress={() => (attention.length === 1 ? openVisit(attention[0].id) : setSelected(attention[0].date))}
                  accessibilityRole="button"
                  accessibilityLabel={`${attention.length} visit${attention.length === 1 ? '' : 's'} overdue or returned. Show the first.`}
                >
                  <Feather name="alert-circle" size={16} color="#B91C1C" />
                  <Text style={styles.attentionText}>
                    {attention.length} visit{attention.length === 1 ? '' : 's'} overdue or returned for correction. Oldest: {attention[0].kindLabel},{' '}
                    {formatDay(attention[0].date)}.
                  </Text>
                </TouchableOpacity>
              )}

              <VisitCalendar
                today={homeToday}
                selectedDate={selectedDate}
                onSelectDate={setSelected}
                dots={dots}
                mode={mode}
                onModeChange={setMode}
                onVisibleMonthChange={setVisibleMonth}
                notice={calendarNotice}
              />

              <SectionCard
                title={selectedDate === homeToday ? `Today, ${formatDay(selectedDate)}` : formatDay(selectedDate, true)}
                subtitle={dayVisits.length > 0 ? `${dayVisits.length} visit${dayVisits.length === 1 ? '' : 's'}` : copy.noVisitsOnDay}
              >
                {dayVisits.map((view) => {
                  const stored = storedById.get(view.id);
                  if (!stored) return null;
                  return (
                    <VisitRow
                      key={view.id}
                      view={view}
                      stored={stored}
                      canSubmit={canSubmitOn(view.projectId)}
                      workWeekDays={packs.get(view.projectId)?.workWeekDays}
                      showProject={showProjectOnRows}
                      onOpen={() => openVisit(view.id)}
                      onRespond={(action) => respond(stored, action)}
                    />
                  );
                })}
              </SectionCard>

              {canUnscheduled && (
                <PrimaryButton
                  text={`+ ${copy.unscheduledVisitButton}`}
                  onPress={() => navigation.navigate('UnscheduledVisit', singleProjectId ? { projectId: singleProjectId } : undefined)}
                  accessibilityLabel={`${copy.unscheduledVisitButton}. ${copy.unscheduledVisitHelp}`}
                />
              )}

              <Text style={styles.sectionTitle} accessibilityRole="header">
                {singleProjectId && projects.length === 1 ? 'My project' : copy.myProjectsTitle}
              </Text>
              {orderedCards.map(({ project, pack, model }) => (
                <ProjectCard
                  key={project.projectId}
                  model={model}
                  full={project.projectId === singleProjectId}
                  unsent={counts.get(project.projectId) ?? null}
                  showDefects={showDefectsShortcut(pack?.constructionPhase, pack?.openDefectCount, project.permissions)}
                  onOpen={() => openProject(project.projectId)}
                  onOpenVisit={openVisit}
                  onSiteLog={() => navigation.navigate('SiteLog', { projectId: project.projectId })}
                  onDefects={() => navigation.navigate('Defects', { projectId: project.projectId })}
                />
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1E1B4B' },
  header: { paddingHorizontal: 20, paddingBottom: 30, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerTexts: { flex: 1 },
  greeting: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, color: 'rgba(255, 255, 255, 0.78)', marginTop: 2 },
  headerNote: { fontSize: 11, color: '#FDE68A', marginTop: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#E11D48' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDead: { backgroundColor: '#DC2626' },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  content: {
    flex: 1,
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  body: { padding: 16, gap: 14 },
  attention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  attentionText: { flex: 1, fontSize: 12, color: '#9F1239', lineHeight: 17 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginTop: 4 },
});
