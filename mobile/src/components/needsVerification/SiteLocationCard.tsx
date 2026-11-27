import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { lgaByCode, type NeedsVerificationFormSite, type NeedsVerificationSiteLocation } from '@insite/shared';
import { FORM_COLORS, formStyles } from '../form/formStyles';
import { siteLocationView, storedLocationText } from '../../utils/needsVerification';

/**
 * Needs pipeline wave 5: one school site of a field verification: the school, its LGA and address,
 * the stored location, and where the officer stood ("Record location here", accuracy and distance
 * from the stored point). Used on the verification screen and on each site's form section.
 */
export function SiteLocationCard({
  site,
  location,
  editable,
  busy,
  onRecord,
  showSchool = true,
  issue,
}: {
  site: NeedsVerificationFormSite;
  location: NeedsVerificationSiteLocation | null;
  editable: boolean;
  busy: boolean;
  onRecord: () => void;
  /** False on the form section, whose title already names the school. */
  showSchool?: boolean;
  /** The blocking issue to show (e.g. "Record the location at site 1"). */
  issue?: string | null;
}) {
  const view = siteLocationView(site, location);
  const lga = lgaByCode(site.lgaCode)?.name ?? site.lgaCode;
  return (
    <View style={formStyles.card} testID={`site-location-${site.siteNumber}`}>
      {showSchool ? (
        <>
          <Text style={formStyles.label}>
            Site {site.siteNumber}: {site.schoolName}
          </Text>
          <Text style={formStyles.meta}>{[lga, site.address].filter(Boolean).join(' · ')}</Text>
        </>
      ) : (
        <Text style={formStyles.label}>Location at the site</Text>
      )}
      <Text style={formStyles.meta}>{storedLocationText(site)}</Text>
      <Text style={[formStyles.meta, styles.line, view.recorded && { color: FORM_COLORS.ok }]}>{view.recorded ? `✓ ${view.text}` : view.text}</Text>
      {view.accuracyText ? <Text style={formStyles.meta}>{view.accuracyText}</Text> : null}
      {view.distanceText ? <Text style={formStyles.meta}>{view.distanceText}</Text> : null}
      {view.warning ? <Text style={formStyles.error}>{view.warning}</Text> : null}
      {issue ? <Text style={formStyles.error}>To fix: {issue}</Text> : null}
      {editable ? (
        <TouchableOpacity
          style={[formStyles.secondaryButton, styles.button, busy && formStyles.disabled]}
          disabled={busy}
          onPress={onRecord}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          accessibilityLabel={`${view.recorded ? 'Record the location again' : 'Record location here'} for site ${site.siteNumber}, ${site.schoolName}. Stand at the school.`}
        >
          {busy ? <ActivityIndicator size="small" /> : <Text style={formStyles.secondaryButtonText}>{view.recorded ? 'Record again here' : 'Record location here'}</Text>}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { marginTop: 6, fontWeight: '700' },
  button: { marginTop: 10, alignSelf: 'flex-start' },
});
