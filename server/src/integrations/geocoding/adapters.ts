import { stateByCode, type GeocodeResult } from '@insite/shared';
import { mapGoogleResults, type GooglePlaceLike } from './googleResults';

/**
 * Client demo updates D3: address lookup adapters.
 *
 * The provider receives the query text only (the address the user typed, with the State name added
 * by the service), plus the Nigeria region and a rectangle (the State's, looked up once by its name,
 * else Nigeria's). `stateCode` itself is never sent: it picks the rectangle and filters the answers
 * (a site must be in the project's State). Nothing about the project or the user leaves the server.
 */
export interface GeocodingQuery {
  /** The text sent to the provider. */
  text: string;
  /** Keep only matches in this State (our code, e.g. "KN"); null keeps every Nigerian match. */
  stateCode: string | null;
}

export interface GeocodingAdapter {
  readonly name: 'google' | 'none' | 'override';
  /** Matches in Nigeria (and in `stateCode` when given), best first; the service keeps 5. */
  search(query: GeocodingQuery): Promise<GeocodeResult[]>;
}

/** The provider refused or failed. The message never contains the key or the request URL. */
export class GeocodingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingProviderError';
  }
}

export const noneGeocodingAdapter: GeocodingAdapter = {
  name: 'none',
  async search() {
    return [];
  },
};

const TIMEOUT_MS = 5000;

interface LatLng {
  latitude: number;
  longitude: number;
}
interface Rectangle {
  low: LatLng;
  high: LatLng;
}
interface GeocodeV4Result extends GooglePlaceLike {
  viewport?: Partial<Rectangle>;
  bounds?: Partial<Rectangle>;
}

/** Places results are restricted to a rectangle around Nigeria (or the State's, when known). */
const NIGERIA_RECTANGLE: Rectangle = {
  low: { latitude: 4.2, longitude: 2.6 },
  high: { latitude: 13.95, longitude: 14.7 },
};
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_V4_URL = 'https://geocode.googleapis.com/v4beta/geocode/address/';
const PLACES_FIELD_MASK =
  'places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents';
/**
 * Enough candidates to survive the Nigeria and State filters: Places ranks generic school names
 * ("LGEA Primary School") from all over the country, so the first few are often in other States.
 */
const PLACES_PAGE_SIZE = 20;

async function callGoogle(label: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const reason = (error as { name?: string })?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    // Never log the URL (the Geocoding path holds the address) or the headers (the key).
    console.warn(`[geocoding] ${label} ${reason}`);
    throw new GeocodingProviderError(`${label} ${reason}`);
  }
  if (!res.ok) {
    let status = '';
    try {
      const body = (await res.json()) as { error?: { status?: string } };
      status = body?.error?.status ?? '';
    } catch {
      /* not JSON */
    }
    console.warn(`[geocoding] ${label} answered HTTP ${res.status}${status ? ` ${status}` : ''}`);
    throw new GeocodingProviderError(`${label} answered HTTP ${res.status}`);
  }
  return res.json();
}

const inState = (results: GeocodeResult[], stateCode: string | null) =>
  stateCode ? results.filter((r) => r.stateCode === stateCode) : results;

/** Google Maps Platform: Places API (New) text search first, Geocoding API v4 when it finds nothing. */
export function createGoogleGeocodingAdapter(apiKey: string): GeocodingAdapter {
  /** Each State's bounds, looked up once per server process (null = not found: use Nigeria's). */
  const stateBounds = new Map<string, Rectangle | null>();

  const places = async (text: string, rectangle: Rectangle) => {
    const body = (await callGoogle('Places text search', PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: text,
        regionCode: 'NG',
        pageSize: PLACES_PAGE_SIZE,
        locationRestriction: { rectangle },
      }),
    })) as { places?: GooglePlaceLike[] };
    return mapGoogleResults(body?.places);
  };
  const geocodeV4Raw = async (text: string) =>
    (
      (await callGoogle('Geocoding', `${GEOCODE_V4_URL}${encodeURIComponent(text)}?regionCode=NG`, {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': apiKey },
      })) as { results?: GeocodeV4Result[] }
    )?.results ?? [];

  /**
   * The State's own rectangle, so Places ranks schools inside it (a generic name such as "LGEA
   * Primary School" otherwise returns schools from all over the country). Sends only the State name.
   * A failure falls back to Nigeria's rectangle and is retried on the next lookup.
   */
  const rectangleFor = async (stateCode: string | null): Promise<Rectangle> => {
    const state = stateByCode(stateCode);
    if (!state) return NIGERIA_RECTANGLE;
    if (stateBounds.has(state.code)) return stateBounds.get(state.code) ?? NIGERIA_RECTANGLE;
    try {
      const results = await geocodeV4Raw(`${state.name} State, Nigeria`);
      const hit = results.find((r) => (r.types ?? []).includes('administrative_area_level_1'));
      const box = hit?.viewport ?? hit?.bounds ?? null;
      const rect = box?.low && box?.high ? { low: box.low, high: box.high } : null;
      stateBounds.set(state.code, rect);
      return rect ?? NIGERIA_RECTANGLE;
    } catch {
      return NIGERIA_RECTANGLE;
    }
  };

  return {
    name: 'google',
    async search({ text, stateCode }) {
      const fromPlaces = inState(await places(text, await rectangleFor(stateCode)), stateCode);
      if (fromPlaces.length > 0) return fromPlaces;
      return inState(mapGoogleResults(await geocodeV4Raw(text)), stateCode);
    },
  };
}
