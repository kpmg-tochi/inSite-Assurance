import { stateByCode, type GeocodeSearchDto, type GeocodeSearchRequest } from '@insite/shared';
import { AppError } from '../../middleware/error.middleware';
import { geocodingAdapter, GeocodingProviderError, isGeocodingEnabled } from '../../integrations/geocoding';

/** Client demo updates D3: "Find address". Results are returned, never stored, so nothing is audited. */
const MAX_RESULTS = 5;

/**
 * The text sent to the provider: the typed address, plus the State's name when a State code is
 * given and the text does not already name it ("…, Gwale" + KN → "…, Gwale, Kano State").
 */
export function geocodeQueryText(address: string, stateCode: string | null): string {
  const text = address.trim().replace(/\s+/g, ' ');
  const state = stateByCode(stateCode);
  if (!state) return text;
  const named = new RegExp(`\\b${state.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
  return named ? text : `${text}, ${state.name} State`;
}

export async function searchAddress(input: GeocodeSearchRequest): Promise<GeocodeSearchDto> {
  if (!isGeocodingEnabled()) {
    throw new AppError('The address lookup is not set up for this workspace.', 404, 'GEOCODING_DISABLED');
  }
  const state = stateByCode(input.stateCode ?? null);
  const query = { text: geocodeQueryText(input.address, state?.code ?? null), stateCode: state?.code ?? null };
  try {
    const results = await geocodingAdapter().search(query);
    return { results: results.slice(0, MAX_RESULTS) };
  } catch (error) {
    if (!(error instanceof GeocodingProviderError)) {
      console.warn('[geocoding] lookup failed');
    }
    throw new AppError(
      'The address lookup is not available right now. Paste a Google Maps link or type the coordinates instead.',
      502,
      'GEOCODING_FAILED'
    );
  }
}
