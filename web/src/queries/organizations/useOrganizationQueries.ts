import { useQuery } from '@tanstack/react-query';
import { getTenantSettings, listOrganizations, type OrganizationListQuery } from '../../api/organizations/organizationsApi';

export const useOrganizationsQuery = (query: OrganizationListQuery = {}, enabled = true) =>
  useQuery({
    queryKey: ['organizations', query],
    queryFn: () => listOrganizations(query),
    enabled,
    staleTime: 60_000,
  });

/** Tenant settings every form needs: organisation input mode, geofence modes, tolerance, currency, zone. */
export const useTenantSettingsQuery = (enabled = true) =>
  useQuery({
    queryKey: ['tenant-settings'],
    queryFn: getTenantSettings,
    enabled,
    staleTime: 5 * 60_000,
  });
