/**
 * Client demo updates D3: "Find address" (address lookup through Google, server-side key).
 * - GET /api/v1/geocode/status: enabled only with a key (here: the test override).
 * - POST /api/v1/geocode/search: web auth, request validation, results from the adapter (trimmed to 5),
 *   only the address text (plus the State name) reaches the adapter, 404 GEOCODING_DISABLED,
 *   502 GEOCODING_FAILED without provider detail, and the per-user rate limit (30 a minute).
 * - The pure Google mapping: Nigeria only, quality from types, State code from the State name.
 * The adapter is always stubbed: tests never call Google.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import type { GeocodeResult } from '@insite/shared';
import type { GeocodingQuery } from '../integrations/geocoding';

let app: Express;
let geocoding: typeof import('../integrations/geocoding');
let geocodeQueryText: typeof import('../modules/geocode/geocode.service')['geocodeQueryText'];

const PASSWORD = 'Password123!';
let token = '';
let otherToken = '';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const result = (over: Partial<GeocodeResult> = {}): GeocodeResult => ({
  name: 'LGEA Primary School Gwale',
  formattedAddress: 'Gwale, Kano, Nigeria',
  latitude: 11.9848764,
  longitude: 8.5199254,
  quality: 'PLACE',
  stateCode: 'KN',
  ...over,
});

before(async () => {
  await resetTestDatabase();
  geocoding = await import('../integrations/geocoding');
  ({ geocodeQueryText } = await import('../modules/geocode/geocode.service'));
  const { createApp } = await import('../app');
  app = createApp();
  token = await login('admin@ubec.test');
  otherToken = await login('kano.admin@ubec.test');
});

after(() => {
  geocoding?.setGeocodingAdapterOverride(null);
  delete process.env.RATE_LIMIT_IN_TESTS;
});

describe('demo D3: address lookup', () => {
  it('is off without a key and on with a provider', async () => {
    geocoding.setGeocodingAdapterOverride(null);
    let res = await request(app).get('/api/v1/geocode/status').set(auth(token));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data, { enabled: false });

    res = await request(app).post('/api/v1/geocode/search').set(auth(token)).send({ address: 'Gwale, Kano' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'GEOCODING_DISABLED');

    geocoding.setGeocodingAdapterOverride(async () => []);
    res = await request(app).get('/api/v1/geocode/status').set(auth(token));
    assert.deepEqual(res.body.data, { enabled: true });
  });

  it('needs a signed-in web user', async () => {
    assert.equal((await request(app).get('/api/v1/geocode/status')).status, 401);
    assert.equal((await request(app).post('/api/v1/geocode/search').send({ address: 'Gwale, Kano' })).status, 401);
  });

  it('validates the request', async () => {
    geocoding.setGeocodingAdapterOverride(async () => []);
    for (const body of [{}, { address: 'ab' }, { address: 'x'.repeat(301) }, { address: 'Gwale', stateCode: 'KANO1' }]) {
      const res = await request(app).post('/api/v1/geocode/search').set(auth(token)).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('returns the provider results, at most 5', async () => {
    const many = Array.from({ length: 7 }, (_, i) => result({ name: `School ${i + 1}`, latitude: 11.9 + i / 100 }));
    geocoding.setGeocodingAdapterOverride(async () => many);
    const res = await request(app)
      .post('/api/v1/geocode/search')
      .set(auth(token))
      .send({ address: 'LGEA Primary School, Gwale, Kano', stateCode: 'KN' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.results.length, 5);
    assert.deepEqual(res.body.data.results[0], many[0]);

    geocoding.setGeocodingAdapterOverride(async () => []);
    const none = await request(app).post('/api/v1/geocode/search').set(auth(token)).send({ address: 'Nowhere at all' });
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.data, { results: [] });
  });

  it('sends the provider only the address text (with the State name added)', async () => {
    const seen: unknown[][] = [];
    geocoding.setGeocodingAdapterOverride(async (...args: [GeocodingQuery]) => {
      seen.push(args);
      return [result()];
    });
    const send = (body: Record<string, unknown>) => request(app).post('/api/v1/geocode/search').set(auth(token)).send(body);

    // Extra fields are dropped by the schema and never reach the provider.
    let res = await send({ address: '  LGEA Primary School,   Gwale ', stateCode: 'kn', projectId: 'p-1', userEmail: 'x@y.z' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // The text already naming the State is sent as typed.
    res = await send({ address: 'LGEA Primary School, Gwale, Kano', stateCode: 'KN' });
    assert.equal(res.status, 200);
    // No State: the text alone, no State filter. An unknown State code is ignored.
    await send({ address: 'Kofar Mata, Kano' });
    await send({ address: 'Kofar Mata', stateCode: 'ZZ' });

    assert.deepEqual(seen, [
      [{ text: 'LGEA Primary School, Gwale, Kano State', stateCode: 'KN' }],
      [{ text: 'LGEA Primary School, Gwale, Kano', stateCode: 'KN' }],
      [{ text: 'Kofar Mata, Kano', stateCode: null }],
      [{ text: 'Kofar Mata', stateCode: null }],
    ]);
    assert.equal(geocodeQueryText('Wuse, Abuja', 'FC'), 'Wuse, Abuja, Federal Capital Territory State');
  });

  it('maps a provider failure to 502 without its detail', async () => {
    geocoding.setGeocodingAdapterOverride(async () => {
      throw new geocoding.GeocodingProviderError('Places text search answered HTTP 403 key=SECRET');
    });
    let res = await request(app).post('/api/v1/geocode/search').set(auth(token)).send({ address: 'Gwale, Kano' });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'GEOCODING_FAILED');
    assert.doesNotMatch(JSON.stringify(res.body), /SECRET|HTTP 403|googleapis/);

    geocoding.setGeocodingAdapterOverride(async () => {
      throw new Error('socket hang up');
    });
    res = await request(app).post('/api/v1/geocode/search').set(auth(token)).send({ address: 'Gwale, Kano' });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'GEOCODING_FAILED');
    assert.doesNotMatch(JSON.stringify(res.body), /socket/);
  });

  it('maps Google results: Nigeria only, quality from types, State from the State name', () => {
    const component = (longText: string, shortText: string, ...types: string[]) => ({ longText, shortText, types });
    const kano = [component('Kano', 'KN', 'administrative_area_level_1', 'political'), component('Nigeria', 'NG', 'country', 'political')];
    const mapped = geocoding.mapGoogleResults([
      {
        displayName: { text: 'L.G.E.A Primary School Tukuntawa' },
        formattedAddress: '2J23+XQ, Kawo, Dakata 700213, Kano',
        location: { latitude: 12.0012345678, longitude: 8.5312345678 },
        types: ['primary_school', 'school', 'educational_institution', 'point_of_interest', 'establishment'],
        addressComponents: kano,
      },
      { formattedAddress: 'Gwale, Kano, Nigeria', location: { latitude: 11.98, longitude: 8.52 }, types: ['political', 'sublocality', 'sublocality_level_1'], addressComponents: kano },
      { formattedAddress: 'Kano, Nigeria', location: { latitude: 12, longitude: 8.5 }, types: ['locality', 'political'], addressComponents: kano },
      { formattedAddress: '12 Zoo Road, Kano', location: { latitude: 12, longitude: 8.5 }, types: ['street_address'], addressComponents: kano },
      // An unnamed point of interest (Geocoding v4 has no names) is not a named place.
      { formattedAddress: 'Rumfar shehu street, Kano', location: { latitude: 12, longitude: 8.5 }, types: ['establishment', 'point_of_interest'], addressComponents: kano },
      // A State on its own is too coarse; another country is dropped; no location is dropped.
      { formattedAddress: 'Kano, Nigeria', location: { latitude: 12, longitude: 8.5 }, types: ['administrative_area_level_1', 'political'], addressComponents: kano },
      { formattedAddress: 'Maradi, Niger', location: { latitude: 13.5, longitude: 7.1 }, types: ['locality'], addressComponents: [component('Niger', 'NE', 'country')] },
      { formattedAddress: 'No location', types: ['locality'], addressComponents: kano },
      {
        formattedAddress: 'Garki, Abuja',
        location: { latitude: 9.03, longitude: 7.48 },
        types: ['neighborhood'],
        addressComponents: [component('Federal Capital Territory', 'FC', 'administrative_area_level_1'), component('Nigeria', 'NG', 'country')],
      },
    ]);
    assert.deepEqual(
      mapped.map((r) => [r.quality, r.stateCode, r.name]),
      [
        ['PLACE', 'KN', 'L.G.E.A Primary School Tukuntawa'],
        ['AREA', 'KN', null],
        ['TOWN', 'KN', null],
        ['STREET', 'KN', null],
        ['AREA', 'KN', null],
        ['AREA', 'FC', null],
      ]
    );
    assert.equal(mapped[0].latitude, 12.0012346);
    assert.equal(mapped[0].longitude, 8.5312346);
  });

  it('limits lookups to 30 a minute per user', async () => {
    geocoding.setGeocodingAdapterOverride(async () => [result()]);
    process.env.RATE_LIMIT_IN_TESTS = '1';
    try {
      const send = (t: string) => request(app).post('/api/v1/geocode/search').set(auth(t)).send({ address: 'Gwale, Kano' });
      for (let i = 0; i < 30; i += 1) {
        const res = await send(token);
        assert.equal(res.status, 200, `call ${i + 1}: ${JSON.stringify(res.body)}`);
      }
      const limited = await send(token);
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error.code, 'RATE_LIMITED_GEOCODE');
      // Another user has their own allowance.
      assert.equal((await send(otherToken)).status, 200);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});
