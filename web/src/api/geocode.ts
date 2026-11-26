import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GeocodeSearchDto, GeocodeSearchRequest, GeocodeStatusDto } from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates D3: "Find address". The server looks the address up with Google (the key
 * stays on the server). Without a key the status is disabled and the button is not shown.
 */
export const getGeocodeStatus = async () => {
  const { data } = await api.get<ApiEnvelope<GeocodeStatusDto>>('/geocode/status');
  return data.data;
};

export const searchGeocode = async (body: GeocodeSearchRequest) => {
  const { data } = await api.post<ApiEnvelope<GeocodeSearchDto>>('/geocode/search', body);
  return data.data;
};

export const geocodeStatusKey = ['geocode-status'] as const;

/** Whether "Find address" is available (a server setting: cached for the session). */
export const useGeocodeStatusQuery = () =>
  useQuery({
    queryKey: geocodeStatusKey,
    queryFn: getGeocodeStatus,
    staleTime: Infinity,
    retry: 1,
  });

/** Looks an address up; errors are toasted here. */
export const useGeocodeSearchMutation = () =>
  useMutation({
    mutationFn: searchGeocode,
    onError: (err) => toast.error((err as { message?: string })?.message || 'Could not look the address up.'),
  });
