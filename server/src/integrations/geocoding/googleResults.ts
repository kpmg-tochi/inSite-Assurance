import { findStateByName, type GeocodeMatchQuality, type GeocodeResult } from '@insite/shared';

/**
 * Client demo updates D3: pure mapping of Google Maps Platform results (Places API (New) text search
 * and Geocoding API v4 share the shape used here) to `GeocodeResult`. Kept separate from the HTTP
 * calls so it can be tested without the provider.
 */

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GooglePlaceLike {
  displayName?: { text?: string } | null;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number } | null;
  types?: string[];
  addressComponents?: GoogleAddressComponent[];
}

const PLACE_TYPES = new Set([
  'school',
  'primary_school',
  'secondary_school',
  'educational_institution',
  'establishment',
  'point_of_interest',
]);
const STREET_TYPES = new Set(['street_address', 'premise', 'subpremise', 'route']);
const AREA_TYPES = new Set([
  'neighborhood',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'administrative_area_level_3',
]);
const TOWN_TYPES = new Set(['locality', 'administrative_area_level_2', 'postal_code']);

/**
 * Match quality from the result's types, most precise first. A result that is only a State or the
 * country (or carries no type we know) is too coarse to place a site: null, and it is dropped.
 */
export function qualityFromTypes(types: string[] | undefined): GeocodeMatchQuality | null {
  const t = types ?? [];
  if (t.some((x) => PLACE_TYPES.has(x))) return 'PLACE';
  if (t.some((x) => STREET_TYPES.has(x))) return 'STREET';
  if (t.some((x) => AREA_TYPES.has(x))) return 'AREA';
  if (t.some((x) => TOWN_TYPES.has(x))) return 'TOWN';
  return null;
}

const componentOf = (p: GooglePlaceLike, type: string) => (p.addressComponents ?? []).find((c) => (c.types ?? []).includes(type));

/** Our State code from `administrative_area_level_1` ("Kano" / "KN", "Federal Capital Territory"). */
export function stateCodeOf(p: GooglePlaceLike): string | null {
  const c = componentOf(p, 'administrative_area_level_1');
  if (!c) return null;
  return (findStateByName(c.longText) ?? findStateByName(c.shortText))?.code ?? null;
}

const isNigeria = (p: GooglePlaceLike) => {
  const c = componentOf(p, 'country');
  return (c?.shortText ?? '').toUpperCase() === 'NG';
};

const round7 = (n: number) => Number(n.toFixed(7));

/** Keeps located results in Nigeria with a usable quality, in the provider's order. */
export function mapGoogleResults(items: GooglePlaceLike[] | undefined): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  for (const p of items ?? []) {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isNigeria(p)) continue;
    const name = p.displayName?.text?.trim() || null;
    let quality = qualityFromTypes(p.types);
    if (quality === 'PLACE' && !name) {
      // An unnamed point of interest (Geocoding results carry no name) is not a "named place": judge
      // it by its other types, else call it an area so the officer checks the pin.
      quality = qualityFromTypes((p.types ?? []).filter((t) => !PLACE_TYPES.has(t))) ?? 'AREA';
    }
    if (!quality) continue;
    out.push({
      name,
      formattedAddress: (p.formattedAddress ?? '').trim() || name || `${round7(lat)}, ${round7(lng)}`,
      latitude: round7(lat),
      longitude: round7(lng),
      quality,
      stateCode: stateCodeOf(p),
    });
  }
  return out;
}
