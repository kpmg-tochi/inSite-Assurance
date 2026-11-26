import { env } from '../../config/env';
import {
  createGoogleGeocodingAdapter,
  noneGeocodingAdapter,
  type GeocodingAdapter,
  type GeocodingQuery,
} from './adapters';
import type { GeocodeResult } from '@insite/shared';

export { GeocodingProviderError, type GeocodingAdapter, type GeocodingQuery } from './adapters';
export { mapGoogleResults, qualityFromTypes, stateCodeOf } from './googleResults';

/**
 * Client demo updates D3: the address lookup provider. `google` when `GOOGLE_MAPS_KEY` is set, else
 * `none` (the feature is off: the status endpoint says so and the web hides "Find address").
 * Tests stub it with `setGeocodingAdapterOverride` and never call Google.
 */
let override: GeocodingAdapter | null = null;
let google: GeocodingAdapter | null = null;

export function setGeocodingAdapterOverride(fn: ((query: GeocodingQuery) => Promise<GeocodeResult[]>) | null): void {
  override = fn ? { name: 'override', search: fn } : null;
}

export function geocodingAdapter(): GeocodingAdapter {
  if (override) return override;
  if (!env.GOOGLE_MAPS_KEY) return noneGeocodingAdapter;
  google ??= createGoogleGeocodingAdapter(env.GOOGLE_MAPS_KEY);
  return google;
}

export const isGeocodingEnabled = (): boolean => geocodingAdapter().name !== 'none';
