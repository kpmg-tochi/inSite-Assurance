/**
 * Client demo updates C1 unit tests (no database): the bundled reference data for Nigeria's
 * administrative areas (shared/src/data/nigeriaAdminAreas.ts): 6 zones, 36 States + FCT, 774 LGAs,
 * and the lenient lookup helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLgaByName,
  findStateByName,
  lgasOfState,
  NIGERIA_LGAS,
  NIGERIA_STATES,
  NIGERIA_ZONES,
  statesOfZone,
  zoneOfState,
} from '@insite/shared';

describe('Client demo C1: Nigeria administrative areas', () => {
  it('has 6 zones and 37 states with the right number of states per zone', () => {
    assert.equal(NIGERIA_ZONES.length, 6);
    assert.equal(NIGERIA_STATES.length, 37);
    assert.equal(new Set(NIGERIA_STATES.map((s) => s.code)).size, 37);
    const expected = { NC: 7, NE: 6, NW: 7, SE: 5, SS: 6, SW: 6 } as const;
    for (const [zone, count] of Object.entries(expected)) {
      assert.equal(statesOfZone(zone as keyof typeof expected).length, count, zone);
    }
  });

  it('has 774 LGAs with unique codes, each in a known state with its state prefix', () => {
    assert.equal(NIGERIA_LGAS.length, 774);
    assert.equal(new Set(NIGERIA_LGAS.map((l) => l.code)).size, 774);
    const stateCodes = new Set(NIGERIA_STATES.map((s) => s.code));
    for (const lga of NIGERIA_LGAS) {
      assert.ok(stateCodes.has(lga.stateCode), `${lga.code}: unknown state ${lga.stateCode}`);
      assert.ok(lga.code.startsWith(`${lga.stateCode}-`), `${lga.code}: missing state prefix`);
      assert.match(lga.code, /^[A-Z]{2}-[A-Z0-9]+(-[A-Z0-9]+)*$/, lga.code);
    }
    for (const state of NIGERIA_STATES) {
      assert.ok(lgasOfState(state.code).length > 0, `${state.name} has no LGAs`);
    }
  });

  it('has the FCT area councils and the known per-state counts', () => {
    assert.deepEqual(
      lgasOfState('FC').map((l) => l.name).sort(),
      ['Abaji', 'Abuja Municipal', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali'],
    );
    const counts = { FC: 6, KN: 44, LA: 20, KT: 34, BY: 8 };
    for (const [code, count] of Object.entries(counts)) {
      assert.equal(lgasOfState(code).length, count, code);
    }
  });

  it('holds well-known LGAs', () => {
    const known: Record<string, string[]> = {
      KN: ['Nasarawa', 'Tarauni', 'Dala', 'Gwale', 'Fagge', 'Kano Municipal'],
      LA: ['Ikeja', 'Eti-Osa', 'Alimosho', 'Surulere'],
      KD: ['Kaduna North', 'Zaria', 'Chikun'],
      BO: ['Maiduguri', 'Jere', 'Konduga'],
      NI: ['Chanchaga', 'Bida', 'Suleja'],
      SO: ['Sokoto North', 'Wamako'],
      OY: ['Ibadan North'],
      OG: ['Abeokuta South'],
      EN: ['Enugu North', 'Nsukka'],
      AN: ['Awka South', 'Onitsha North'],
      RI: ['Port Harcourt', 'Obio/Akpor'],
    };
    for (const [state, names] of Object.entries(known)) {
      for (const name of names) {
        assert.ok(findLgaByName(state, name), `${state}: ${name} missing`);
      }
    }
  });

  it('looks states and LGAs up leniently', () => {
    assert.equal(findStateByName('kano state')?.code, 'KN');
    assert.equal(findStateByName('FCT')?.code, 'FC');
    assert.equal(findStateByName('Abuja')?.code, 'FC');
    assert.equal(zoneOfState('BO'), 'NE');
    assert.equal(lgasOfState('FC').length, 6);
    assert.equal(findLgaByName('LA', 'ikeja')?.code, 'LA-IKEJA');
    assert.equal(findLgaByName('KN', 'KN-KANO-MUNICIPAL')?.name, 'Kano Municipal');
    assert.equal(findLgaByName('LA', 'Kano Municipal'), null);
  });
});
