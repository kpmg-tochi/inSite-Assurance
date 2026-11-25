/**
 * Redesign R6a unit tests: the two-level setup registry (D-R6.2): sections (what the server saves)
 * grouped into five wizard steps plus Advanced, and the old step URLs (D-R6.10).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_SETUP_SECTIONS,
  PROJECT_SETUP_STEPS,
  PROJECT_STEP_SAVE_SCHEMAS,
  ProjectContractorSectionSchema,
  ProjectPartiesStepSchema,
  ProjectSetupSectionIdEnum,
  ProjectSetupWizardStepIdEnum,
  resolveSetupRoute,
  wizardStepFor,
  wizardStepLabel,
} from '@insite/shared';

describe('setup registry (R6a)', () => {
  it('every save schema key belongs to exactly one wizard step', () => {
    for (const key of Object.keys(PROJECT_STEP_SAVE_SCHEMAS)) {
      const holders = PROJECT_SETUP_STEPS.filter((s) => (s.sectionIds as string[]).includes(key));
      assert.equal(holders.length, 1, `${key} is on ${holders.map((h) => h.id).join(', ') || 'no step'}`);
      assert.equal(wizardStepFor(key)?.id, holders[0].id);
    }
  });

  it('sections, save schemas and the section enum list the same ids', () => {
    const sections = PROJECT_SETUP_SECTIONS.map((s) => s.id).sort();
    assert.deepEqual(Object.keys(PROJECT_STEP_SAVE_SCHEMAS).sort(), sections);
    assert.deepEqual([...ProjectSetupSectionIdEnum.options].sort(), sections);
    assert.equal(new Set(sections).size, sections.length, 'no duplicate section ids');
  });

  it('every wizard step id has a step with a unique route', () => {
    for (const id of ProjectSetupWizardStepIdEnum.options) {
      const step = PROJECT_SETUP_STEPS.find((s) => s.id === id);
      assert.ok(step, `no step for ${id}`);
      assert.ok(step.route.length > 0);
      assert.equal(resolveSetupRoute(step.route)?.step.id, id);
      assert.equal(resolveSetupRoute(step.route)?.legacy, false);
    }
    const routes = PROJECT_SETUP_STEPS.map((s) => s.route);
    assert.equal(new Set(routes).size, routes.length);
  });

  it('has five numbered steps in the client order, then Advanced', () => {
    const numbered = PROJECT_SETUP_STEPS.filter((s) => !s.settingsOnly).sort((a, b) => a.order - b.order);
    assert.deepEqual(
      numbered.map((s) => s.title),
      ['Project', 'Contract', 'BoQ & work phases', 'Team & visits', 'Review']
    );
    assert.deepEqual(numbered.map((s) => s.order), [1, 2, 3, 4, 5]);
    assert.deepEqual(
      PROJECT_SETUP_STEPS.filter((s) => s.settingsOnly).map((s) => s.id),
      ['advanced']
    );
    const sections = (id: string) => PROJECT_SETUP_STEPS.find((s) => s.id === id)!.sectionIds;
    assert.deepEqual(sections('project'), ['basics', 'parties', 'site']);
    assert.deepEqual(sections('contract'), ['contractor', 'contract', 'facility']);
    assert.deepEqual(sections('scope'), ['scope', 'standards']);
    assert.deepEqual(sections('team'), ['team', 'visits']);
    assert.deepEqual(sections('review'), []);
    assert.deepEqual(sections('advanced'), ['process']);
  });

  it('resolves the old step URLs to the step that holds the section (D-R6.10)', () => {
    const cases: Array<[string, string, string | null]> = [
      ['basics', 'project', 'basics'],
      ['parties', 'project', 'parties'],
      ['site', 'project', 'site'],
      ['facility', 'contract', 'facility'],
      ['contractor', 'contract', 'contractor'],
      ['standards', 'scope', 'standards'],
      ['visits', 'team', 'visits'],
      ['process', 'advanced', 'process'],
      // Retired steps.
      ['reporting', 'team', 'team'],
      ['boq', 'scope', 'scope'],
      // Step routes that are also section ids resolve to the step itself.
      ['contract', 'contract', null],
      ['scope', 'scope', null],
      ['team', 'team', null],
      ['review', 'review', null],
    ];
    for (const [route, step, sectionId] of cases) {
      const r = resolveSetupRoute(route);
      assert.ok(r, `${route} did not resolve`);
      assert.equal(r.step.id, step, route);
      assert.equal(r.sectionId, sectionId, route);
      assert.equal(r.legacy, sectionId !== null, route);
    }
    assert.equal(resolveSetupRoute('nonsense'), null);
    assert.equal(resolveSetupRoute(undefined), null);
    assert.equal(resolveSetupRoute('toString'), null);
  });

  it('names a step in issue text by its number, Advanced by its title', () => {
    assert.equal(wizardStepLabel(wizardStepFor('contractor')!), 'step 2 "Contract"');
    assert.equal(wizardStepLabel(wizardStepFor('process')!), '"Advanced"');
  });

  it('parties keeps the contractor when `contractors` is omitted; the contractor section needs the list (D-R6.4)', () => {
    const parties = ProjectPartiesStepSchema.parse({ monitorOrganization: null });
    assert.equal(parties.contractors, undefined);
    assert.equal(ProjectContractorSectionSchema.safeParse({}).success, false);
    assert.equal(ProjectContractorSectionSchema.safeParse({ contractors: [] }).success, true);
    const row = { organization: { name: 'A Ltd' }, tradeCategory: 'Main contract', tradeCode: 'MAIN' };
    assert.equal(ProjectContractorSectionSchema.safeParse({ contractors: [row, { ...row, tradeCode: 'SEC' }] }).success, false);
  });
});
