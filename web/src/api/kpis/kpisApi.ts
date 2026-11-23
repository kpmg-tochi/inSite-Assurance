import type { KpiDashboardDto, KpiQuery, ProjectKpisDto } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Phase 16: programme KPIs. */

const clean = (q: Partial<KpiQuery>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export const getKpiDashboard = async (query: Partial<KpiQuery>) =>
  (await api.get<ApiEnvelope<KpiDashboardDto>>('/kpis', { params: clean(query) })).data.data;

export const getProjectKpis = async (projectId: string, query: Pick<KpiQuery, 'from' | 'to'> = {}) =>
  (await api.get<ApiEnvelope<ProjectKpisDto>>(`/projects/${projectId}/kpis`, { params: clean(query) })).data.data;
