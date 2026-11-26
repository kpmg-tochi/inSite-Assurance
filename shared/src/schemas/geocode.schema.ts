import { z } from 'zod';

/**
 * Client demo updates D3 (address lookup). The server looks an address up with Google Maps Platform
 * (Places API (New) text search, Geocoding API v4 as fallback), restricted to Nigeria; the key never
 * leaves the server. Only the address text is sent. Without a key the feature is off and the web hides
 * "Find address".
 * - `GET /api/v1/geocode/status` → `GeocodeStatusDto` (any signed-in web user).
 * - `POST /api/v1/geocode/search` (`GeocodeSearchRequest`) → `GeocodeSearchDto`; authenticated web
 *   users, rate-limited per user; 404 `GEOCODING_DISABLED` without a key; 502 `GEOCODING_FAILED` when
 *   the provider refuses or fails.
 */

export const GeocodeStatusDtoSchema = z.object({
  enabled: z.boolean(),
});
export type GeocodeStatusDto = z.infer<typeof GeocodeStatusDtoSchema>;

export const GeocodeSearchRequestSchema = z.object({
  /** Free text: school name, street, town, LGA, State. */
  address: z.string().trim().min(3, 'Type at least 3 characters').max(300),
  /** Optional State code (e.g. "KN") added to the query text to bias the result. */
  stateCode: z.string().trim().max(4).optional(),
});
export type GeocodeSearchRequest = z.infer<typeof GeocodeSearchRequestSchema>;

/**
 * How precise a match is: PLACE (a named place such as a school or building), STREET (a street
 * address), AREA (a neighbourhood or district), TOWN (a town or LGA only). Rural school addresses
 * often resolve only to the town: the form says so, and the officer drags the pin.
 */
export const GeocodeMatchQualityEnum = z.enum(['PLACE', 'STREET', 'AREA', 'TOWN']);
export type GeocodeMatchQuality = z.infer<typeof GeocodeMatchQualityEnum>;

export const GEOCODE_MATCH_QUALITY_LABELS: Record<GeocodeMatchQuality, string> = {
  PLACE: 'Named place',
  STREET: 'Street',
  AREA: 'Area only',
  TOWN: 'Town only',
};

export const GeocodeResultSchema = z.object({
  /** Display name of the place (e.g. the school), or null for a plain address. */
  name: z.string().nullable(),
  formattedAddress: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  quality: GeocodeMatchQualityEnum,
  /** National State code when the result names a Nigerian State we know. */
  stateCode: z.string().nullable(),
});
export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

export const GeocodeSearchDtoSchema = z.object({
  /** Up to 5 matches in Nigeria, best first; empty when nothing matched. */
  results: z.array(GeocodeResultSchema),
});
export type GeocodeSearchDto = z.infer<typeof GeocodeSearchDtoSchema>;
