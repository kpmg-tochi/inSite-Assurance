import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { EmptyStateCard, GradientHeaderLayout, InSiteLoader } from '../components/common';
import { IconButton, PrimaryButton } from '../components/inputs/Buttons';
import { OutlineButton, SectionCard, visitUiStyles } from '../components/visit/VisitUi';
import { useActiveBranding, useProfile } from '../context/ProfileContext';
import { useVisitData } from '../hooks/useVisitData';
import { hydrateBaselinePack } from '../storage/baselineStore';
import { createUnscheduledVisit, getFieldPack } from '../storage/visitStore';
import { downloadFieldPack } from '../services/visitSync';
import type { RootStackParamList } from '../navigation/types';
import { adHocAvailable, adHocFacilityChoices } from '../utils/visitForm';
import { projectToday } from '../utils/visitCalendar';
import { personaCopy } from '../utils/personaCopy';
import { formatProjectCode } from '@insite/shared';
import { formatDay } from '../utils/visitText';
import { formatMobileErrorMessage } from '../utils/errorFormatter';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Redesign R5b/R5c (D-R5.12): an unscheduled visit, recorded as Ad hoc and built fully offline from
 * the project's cached field pack. Pick the project (preset on a single-project home) and the
 * facilities; the visit is created on the phone (UNSCHEDULED_VISIT) and opens for check-in.
 */
export function UnscheduledVisitModal() {
  const navigation = useNavigation<Nav>();
  const params = useRoute<RouteProp<RootStackParamList, 'UnscheduledVisit'>>().params;
  const { projects, account, branding, activeContext } = useProfile();
  const { primaryColor } = useActiveBranding();
  const copy = personaCopy(activeContext?.fieldPersonaType, branding.terminology);
  const eligible = useMemo(() => projects.filter((p) => p.permissions.includes('visits:submit')), [projects]);
  const [projectId, setProjectId] = useState<string | null>(
    params?.projectId && eligible.some((p) => p.projectId === params.projectId) ? params.projectId : eligible.length === 1 ? eligible[0].projectId : null
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { data, loading } = useVisitData(
    async () => {
      if (!projectId) return null;
      const [fieldPack, pack] = await Promise.all([getFieldPack(projectId), hydrateBaselinePack(projectId)]);
      return { fieldPack, pack };
    },
    [projectId],
    ['fieldPacks', 'packs']
  );
  const fieldPack = data?.fieldPack ?? null;
  const choices = fieldPack ? adHocFacilityChoices(fieldPack) : [];
  const today = projectToday(data?.pack?.timezone);
  const close = () => navigation.goBack();

  const chooseProject = (id: string) => {
    setProjectId(id);
    setPicked([]);
    setProblem(null);
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const download = async () => {
    if (!projectId) return;
    setDownloading(true);
    try {
      const ok = await downloadFieldPack(projectId, true);
      if (!ok) setProblem('Could not download the forms. Check your connection and try again.');
    } catch (err) {
      setProblem(formatMobileErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const create = async () => {
    if (!projectId || !account) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await createUnscheduledVisit({
        projectId,
        pickedFacilityIds: picked,
        visitDate: today,
        user: { userId: account.profile.userId, fullName: account.profile.fullName },
      });
      if (result.warnings.length > 0) {
        Toast.show({ type: 'info', props: { title: 'Visit created', message: result.warnings.join(' ') } });
      } else {
        Toast.show({ type: 'success', props: { title: 'Visit created', message: 'Check in to start the form. It is sent when you are online.' } });
      }
      navigation.replace('Visit', { visitId: result.visitId });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GradientHeaderLayout
      title={copy.unscheduledVisitButton}
      subtitle={`Ad hoc visit, ${formatDay(today, true)}`}
      rightAction={<IconButton icon="close" text="Close" onPress={close} />}
      contentContainerStyle={styles.body}
    >
      <Text style={visitUiStyles.body}>{copy.unscheduledVisitHelp}</Text>
      {eligible.length === 0 ? (
        <EmptyStateCard title="You cannot record visits" description="Your role on these projects does not include submitting monitoring reports." />
      ) : (
        <>
          {eligible.length > 1 && (
            <SectionCard title="Project">
              {eligible.map((p) => {
                const on = p.projectId === projectId;
                return (
                  <TouchableOpacity
                    key={p.projectId}
                    style={[styles.option, on && { borderColor: primaryColor, borderWidth: 1.5 }]}
                    onPress={() => chooseProject(p.projectId)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${formatProjectCode(p.projectCodePrefix)}, ${p.projectName}`}
                  >
                    <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? primaryColor : '#94A3B8'} />
                    <View style={styles.optionTexts}>
                      <Text style={visitUiStyles.strong}>{formatProjectCode(p.projectCodePrefix)}</Text>
                      <Text style={visitUiStyles.muted}>{p.projectName}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </SectionCard>
          )}

          {projectId && (loading && !data ? (
            <InSiteLoader size="md" />
          ) : !fieldPack ? (
            <SectionCard title="Forms not on this phone yet" subtitle="Connect once to download this project's forms; after that you can do this offline.">
              <OutlineButton text={downloading ? 'Downloading…' : 'Download now'} icon="download" onPress={() => void download()} disabled={downloading} />
            </SectionCard>
          ) : !adHocAvailable(fieldPack) ? (
            <EmptyStateCard title="No Ad hoc form" description="This project has no Ad hoc visit form. Ask your manager to set one up." />
          ) : (
            <SectionCard
              title="Facilities to check"
              subtitle={choices.length === 0 ? 'This project has no facility units yet.' : `${picked.length} of ${choices.length} picked`}
              right={
                choices.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => setPicked(picked.length === choices.length ? [] : choices.map((c) => c.facilityId))}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.link, { color: primaryColor }]}>{picked.length === choices.length ? 'Clear' : 'Pick all'}</Text>
                  </TouchableOpacity>
                ) : null
              }
            >
              {choices.map((c) => {
                const on = picked.includes(c.facilityId);
                return (
                  <TouchableOpacity
                    key={c.facilityId}
                    style={[styles.option, on && { borderColor: primaryColor, borderWidth: 1.5 }]}
                    onPress={() => toggle(c.facilityId)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${c.name}, ${c.unitCount} unit${c.unitCount === 1 ? '' : 's'}`}
                  >
                    <Feather name={on ? 'check-square' : 'square'} size={18} color={on ? primaryColor : '#94A3B8'} />
                    <View style={styles.optionTexts}>
                      <Text style={visitUiStyles.strong}>{c.name}</Text>
                      <Text style={visitUiStyles.muted}>
                        {c.unitCount} unit{c.unitCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </SectionCard>
          ))}

          {problem ? (
            <Text style={visitUiStyles.errorText} accessibilityLiveRegion="polite">
              {problem}
            </Text>
          ) : null}
          {projectId && fieldPack && adHocAvailable(fieldPack) && (
            <PrimaryButton text="Create the visit" onPress={() => void create()} isWorking={busy} disabled={picked.length === 0} />
          )}
        </>
      )}
    </GradientHeaderLayout>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 40 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  optionTexts: { flex: 1 },
  link: { fontSize: 12, fontWeight: '700' },
});
