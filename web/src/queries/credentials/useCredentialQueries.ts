import { useQuery } from '@tanstack/react-query';
import { getCredentialSettings, getProjectCredentialPolicy } from '../../api/credentials/credentialsApi';

/** Tenant registration policy and bodies (forms and the settings tab). */
export const useCredentialSettingsQuery = (enabled = true) =>
  useQuery({
    queryKey: ['credential-settings'],
    queryFn: getCredentialSettings,
    enabled,
    staleTime: 5 * 60_000,
  });

/** The registration policy a project runs on (project type → tenant → REQUIRED). */
export const useProjectCredentialPolicyQuery = (projectId: string | undefined) =>
  useQuery({
    queryKey: ['credential-policy', projectId],
    queryFn: () => getProjectCredentialPolicy(projectId!),
    enabled: Boolean(projectId),
    staleTime: 5 * 60_000,
  });
