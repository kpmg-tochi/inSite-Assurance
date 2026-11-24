import { useQuery } from '@tanstack/react-query';
import {
  getDefaultCase,
  getKickoff,
  getMobilisationCompliance,
  getProjectDocument,
  getProjectMilestones,
  listDefaultCases,
  listDocumentTypes,
  listProjectDocuments,
  type DocumentFilters,
} from '../../api/contracts/contractsApi';

/** Phase 13 query keys. */
export const documentTypesKey = ['document-types'] as const;
export const projectDocumentsKey = (projectId: string | null | undefined) => ['project-documents', projectId] as const;
export const projectDocumentKey = (projectId: string | null | undefined, id: string | null | undefined) =>
  ['project-document', projectId, id] as const;
export const milestonesKey = (projectId: string | null | undefined) => ['contract-milestones', projectId] as const;
export const kickoffKey = (projectId: string | null | undefined) => ['kickoff', projectId] as const;
export const mobilisationComplianceKey = (projectId: string | null | undefined) => ['mobilisation-compliance', projectId] as const;
export const defaultCasesKey = (projectId: string | null | undefined) => ['default-cases', projectId] as const;
export const defaultCaseKey = (projectId: string | null | undefined, id: string | null | undefined) =>
  ['default-case', projectId, id] as const;

export const useDocumentTypesQuery = (includeArchived = false, enabled = true) =>
  useQuery({
    queryKey: [...documentTypesKey, includeArchived],
    queryFn: () => listDocumentTypes(includeArchived),
    enabled,
    staleTime: 60 * 1000,
  });

export const useProjectDocumentsQuery = (projectId: string | null | undefined, filters: DocumentFilters = {}, enabled = true) =>
  useQuery({
    queryKey: [...projectDocumentsKey(projectId), filters],
    queryFn: () => listProjectDocuments(projectId!, filters),
    enabled: Boolean(projectId) && enabled,
  });

export const useProjectDocumentQuery = (projectId: string | null | undefined, documentId: string | null | undefined) =>
  useQuery({
    queryKey: projectDocumentKey(projectId, documentId),
    queryFn: () => getProjectDocument(projectId!, documentId!),
    enabled: Boolean(projectId && documentId),
  });

export const useMilestonesQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: milestonesKey(projectId),
    queryFn: () => getProjectMilestones(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
    retry: false,
  });

export const useKickoffQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: kickoffKey(projectId), queryFn: () => getKickoff(projectId!), enabled: Boolean(projectId) && enabled });

export const useMobilisationComplianceQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: mobilisationComplianceKey(projectId),
    queryFn: () => getMobilisationCompliance(projectId!),
    enabled: Boolean(projectId) && enabled,
    retry: false,
  });

export const useDefaultCasesQuery = (
  projectId: string | null | undefined,
  filters: { contractorId?: string; openOnly?: boolean } = {},
  enabled = true
) =>
  useQuery({
    queryKey: [...defaultCasesKey(projectId), filters],
    queryFn: () => listDefaultCases(projectId!, filters),
    enabled: Boolean(projectId) && enabled,
    retry: false,
  });

export const useDefaultCaseQuery = (projectId: string | null | undefined, caseId: string | null | undefined) =>
  useQuery({
    queryKey: defaultCaseKey(projectId, caseId),
    queryFn: () => getDefaultCase(projectId!, caseId!),
    enabled: Boolean(projectId && caseId),
  });

