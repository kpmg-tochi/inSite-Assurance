import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyStateCard, GradientHeaderLayout, InSiteLoader, Pill } from '../components/common';
import { BackButton, HomeButton } from '../components/inputs/Buttons';
import { DetailLine, LinkRow, SectionCard, visitUiStyles } from '../components/visit/VisitUi';
import { useProfile } from '../context/ProfileContext';
import { useVisitData } from '../hooks/useVisitData';
import { hydrateBaselinePack } from '../storage/baselineStore';
import { listVisits } from '../storage/visitStore';
import type { RootStackParamList } from '../navigation/types';
import { interventionYearOfCode, mobilisationProgress, unitsByFacility } from '../utils/homeLayout';
import { formatProjectCode } from '@insite/shared';
import { projectToday, visitView } from '../utils/visitCalendar';
import { personaCopy } from '../utils/personaCopy';
import { showDefectsShortcut } from '../utils/defects';
import { formatDay, SEVERITY_TEXT, SPRINT_OUTCOME_TEXT, SPRINT_STATUS_TEXT, visitBadges } from '../utils/visitText';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Redesign R5b: one project (D-R5.2). Details, upcoming visits, sprints, units by facility, open
 * findings (read-only, D-R5.17: findings are re-checked inside a visit form), past visits on this
 * phone, and the site log and defects (D-R5.15) shortcuts. Read from the stored pack and visits,
 * offline. Home (all projects) is one tap away in the header.
 *
 * The incident shortcut (D-R5.16) is hidden: the web portal has no screen that shows incidents and
 * the server notifies nobody, so a report would reach no one (found against the web, 2026-11-24).
 * Show it again once the portal reads incidents.
 */
export function ProjectScreen() {
  const navigation = useNavigation<Nav>();
  const { projectId } = useRoute<RouteProp<RootStackParamList, 'Project'>>().params;
  const { projects, activeProjectId, switchProject, branding } = useProfile();
  const project = projects.find((p) => p.projectId === projectId) ?? null;
  const copy = personaCopy(project?.fieldPersonaType, branding.terminology);

  // The last opened project is the default for notifications and push routing (D-R5.2).
  useEffect(() => {
    if (project && projectId !== activeProjectId) void switchProject(projectId).catch(() => undefined);
    // Only when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { data, loading } = useVisitData(
    async () => {
      const [pack, visits] = await Promise.all([hydrateBaselinePack(projectId), listVisits({ projectId })]);
      return { pack, visits };
    },
    [projectId],
    ['visits', 'packs', 'drafts']
  );
  const pack = data?.pack ?? null;
  const today = projectToday(pack?.timezone);
  const upcomingVisits = useMemo(
    () =>
      (data?.visits ?? [])
        .map((v) => visitView(v, today))
        .filter((v) => v.status !== 'CANCELLED' && v.status !== 'MISSED' && !v.submitted && v.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [data, today]
  );
  const pastVisits = useMemo(
    () =>
      (data?.visits ?? [])
        .map((v) => visitView(v, today))
        .filter((v) => v.status !== 'CANCELLED' && (v.date < today || v.submitted))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data, today]
  );
  const mobilisation = mobilisationProgress(pack?.mobilisation ?? null, today);
  const showDefects = showDefectsShortcut(pack?.constructionPhase, pack?.openDefectCount, project?.permissions);
  const sprints = [...(pack?.sprints ?? [])].sort((a, b) => a.number - b.number);
  const groups = unitsByFacility(pack?.facilityUnits ?? []);
  const interventionYear = interventionYearOfCode(pack?.codePrefix ?? project?.projectCodePrefix);
  const stage = pack?.stage ? (pack.stage.subLabel ? `${pack.stage.currentLabel} · ${pack.stage.subLabel}` : pack.stage.currentLabel) : null;

  return (
    <GradientHeaderLayout
      title={formatProjectCode(pack?.codePrefix ?? project?.projectCodePrefix) || 'Project'}
      subtitle={pack?.name ?? project?.projectName}
      leftAction={<BackButton onPress={() => navigation.goBack()} />}
      rightAction={<HomeButton onPress={() => navigation.popTo('Home')} />}
      contentContainerStyle={styles.body}
    >
      {loading && !data ? (
        <InSiteLoader size="md" label="Loading the project..." />
      ) : !pack ? (
        <EmptyStateCard title="Project details not on this phone yet" description="Connect once and pull down on Home to download them." />
      ) : (
        <>
          <SectionCard title="Details" right={stage ? <Pill variant="info" text={stage} /> : null}>
            <DetailLine label={copy.beneficiaryLabel} value={pack.school} />
            <DetailLine label="Address" value={pack.address} />
            <DetailLine label="LGA" value={pack.lgaLocation} />
            {interventionYear != null ? <DetailLine label="Intervention year" value={String(interventionYear)} /> : null}
            <DetailLine label={copy.contractorLabel} value={pack.contractorName ?? 'Not awarded yet'} />
            {pack.stage?.contractTerminated ? <Text style={visitUiStyles.errorText}>The contract was terminated.</Text> : null}
            {mobilisation?.dayText ? (
              <DetailLine label={mobilisation.label} value={mobilisation.dayText} />
            ) : null}
          </SectionCard>

          <View style={styles.links}>
            <LinkRow icon="camera" text="Site log" detail="Photos, voice notes and notes, any time" onPress={() => navigation.navigate('SiteLog', { projectId })} />
            {showDefects && (
              <LinkRow
                icon="tool"
                text="Defects"
                detail={pack.openDefectCount > 0 ? `${pack.openDefectCount} open` : 'None open'}
                onPress={() => navigation.navigate('Defects', { projectId })}
              />
            )}
          </View>

          <SectionCard title="Upcoming monitoring visits" subtitle={upcomingVisits.length === 0 ? 'None planned on this phone.' : null}>
            {upcomingVisits.map((v) => (
              <LinkRow
                key={v.id}
                icon="calendar"
                text={`${v.kindLabel}, ${formatDay(v.date, true)}`}
                detail={visitBadges(v).map((b) => b.text).join(' · ')}
                onPress={() => navigation.navigate('Visit', { visitId: v.id })}
              />
            ))}
          </SectionCard>

          <SectionCard title="Work phases" subtitle={sprints.length === 0 ? 'No work phases planned yet.' : `${sprints.length} work phase${sprints.length === 1 ? '' : 's'}`}>
            {sprints.map((s) => (
              <View key={s.id} style={styles.item}>
                <View style={visitUiStyles.row}>
                  <Text style={visitUiStyles.strong}>
                    Work phase {s.number}: {s.name}
                  </Text>
                  <Pill
                    variant={s.status === 'ACTIVE' ? 'info' : s.status === 'LATE' ? 'negative' : s.status === 'VERIFIED' ? 'positive' : 'gray'}
                    text={SPRINT_STATUS_TEXT[s.status]}
                  />
                  {s.verificationOutcome ? <Pill variant="gray" text={SPRINT_OUTCOME_TEXT[s.verificationOutcome]} /> : null}
                </View>
                <Text style={visitUiStyles.muted}>
                  {formatDay(s.startDate, true)} – {formatDay(s.endDate, true)}
                </Text>
                {s.deliverables ? <Text style={visitUiStyles.body}>{s.deliverables}</Text> : null}
              </View>
            ))}
          </SectionCard>

          <SectionCard title="Facilities and units" subtitle={groups.length === 0 ? 'No units on this project.' : null}>
            {groups.map((g) => (
              <View key={g.facilityId} style={styles.item}>
                <Text style={visitUiStyles.strong}>{g.facilityName}</Text>
                {g.units.map((u) => (
                  <Text key={u.id} style={visitUiStyles.body}>
                    {u.label}
                    {u.plannedQuantity != null ? ` · ${u.plannedQuantity} ${u.quantityUnit ?? ''}`.trimEnd() : ''}
                    {u.startSprintNumber != null ? ` · ${sprintRange(u.startSprintNumber, u.endSprintNumber)}` : ''}
                    {u.progressPct != null ? ` · ${Math.round(u.progressPct)}% seen on the last accepted visit` : ''}
                  </Text>
                ))}
              </View>
            ))}
          </SectionCard>

          <SectionCard
            title="Open findings"
            subtitle={pack.openFindings.length === 0 ? 'None open.' : 'Followed up with a follow-up check in the visit form.'}
          >
            {pack.openFindings.map((f) => (
              <View key={f.id} style={styles.item}>
                <View style={visitUiStyles.row}>
                  <Pill variant={f.severity === 'MINOR' ? 'warning' : 'negative'} text={SEVERITY_TEXT[f.severity]} />
                  <Text style={[visitUiStyles.strong, styles.flex]}>{f.title}</Text>
                </View>
                {f.description ? <Text style={visitUiStyles.body}>{f.description}</Text> : null}
                <Text style={visitUiStyles.muted}>
                  {f.facilityName ? `${f.facilityName}${f.unitLabel ? `, ${f.unitLabel}` : ''} · ` : ''}raised {formatDay(f.raisedDate)} · escalates{' '}
                  {formatDay(f.escalatesOn)}
                </Text>
              </View>
            ))}
          </SectionCard>

          <SectionCard title="Past monitoring visits" subtitle={pastVisits.length === 0 ? 'None on this phone.' : 'Visits on this phone from the last weeks.'}>
            {pastVisits.map((v) => (
              <LinkRow
                key={v.id}
                icon="clipboard"
                text={`${v.kindLabel}, ${formatDay(v.date, true)}`}
                detail={visitBadges(v).map((b) => b.text).join(' · ')}
                onPress={() => navigation.navigate('Visit', { visitId: v.id })}
              />
            ))}
          </SectionCard>
        </>
      )}
    </GradientHeaderLayout>
  );
}

/** "work phase 3" or "work phases 1–3". */
function sprintRange(start: number, end: number | null): string {
  if (end == null) return `from work phase ${start}`;
  return start === end ? `work phase ${start}` : `work phases ${start}–${end}`;
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 40 },
  links: { gap: 8 },
  item: { gap: 3, paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  flex: { flex: 1 },
});
