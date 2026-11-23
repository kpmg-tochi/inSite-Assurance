/**
 * Phase 15 unit tests: closure config validation, rating maths and criteria fallback, the new
 * milestone anchors, and the ZIP writer round trip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  computeMilestoneDueDates,
  DEFAULT_RATING_CRITERIA,
  overallRatingScore,
  ProjectTypeClosureConfigSchema,
  ProjectTypeConfigSchema,
  resolveProjectTypeConfig,
  resolveRatingCriteria,
} from '@insite/shared';
import { readZip, ZipFileWriter } from '../utils/zipWriter';

describe('Phase 15 closure config', () => {
  it('defaults: three slots (two owner admins and the beneficiary), no gates, handover due in 7 days', () => {
    const c = ProjectTypeClosureConfigSchema.parse({});
    assert.deepEqual(c.cocSignatories.map((s) => [s.key, s.organizationScope, s.isBeneficiary, s.permissionKey]), [
      ['head-physical-planning', 'PROJECT_OWNER', false, 'completion:sign_certificate'],
      ['head-me', 'PROJECT_OWNER', false, 'completion:sign_certificate'],
      ['beneficiary', 'ANY', true, 'completion:sign_certificate'],
    ]);
    assert.deepEqual(c.requireCocFor, []);
    assert.equal(c.handoverDueDaysAfterCoc, 7);
    assert.equal(c.beneficiarySignatureMode, 'RECORDED_BY_STAFF');
    // A type saved before Phase 15 parses with the defaults.
    assert.deepEqual(resolveProjectTypeConfig({ config: {} })!.closure.requireCocFor, []);
  });

  it('refuses duplicate slot keys, two beneficiary slots, and items without their reference', () => {
    const dup = ProjectTypeClosureConfigSchema.safeParse({ cocSignatories: [{ key: 'a-slot', label: 'Head A' }, { key: 'a-slot', label: 'Head B' }] });
    assert.equal(dup.success, false);
    const twoBeneficiaries = ProjectTypeClosureConfigSchema.safeParse({
      cocSignatories: [
        { key: 'b-one', label: 'Beneficiary', isBeneficiary: true },
        { key: 'b-two', label: 'Community', isBeneficiary: true },
      ],
    });
    assert.equal(twoBeneficiaries.success, false);
    assert.equal(ProjectTypeClosureConfigSchema.safeParse({ beforeClose: [{ key: 'doc', label: 'A document', kind: 'DOCUMENT_TYPE' }] }).success, false);
    assert.equal(ProjectTypeClosureConfigSchema.safeParse({ beforeClose: [{ key: 'm', label: 'Milestone', kind: 'CONTRACT_MILESTONE' }] }).success, false);
    const crossList = ProjectTypeClosureConfigSchema.safeParse({
      beforeClose: [{ key: 'audit', label: 'Audit', kind: 'AUDIT_SIGNOFF' }],
      beforeArchive: [{ key: 'audit', label: 'Audit again', kind: 'AUDIT_SIGNOFF' }],
    });
    assert.equal(crossList.success, false);
    assert.equal(ProjectTypeClosureConfigSchema.safeParse({ beneficiarySignatureMode: 'HANDOVER_LINK' }).success, false, 'not built until D-15.1 is answered');
  });

  it('rating score is the mean to two decimals; invalid stored criteria fall back to the defaults', () => {
    assert.equal(overallRatingScore([4, 5, 3, 4, 4]), 4);
    assert.equal(overallRatingScore([5, 4, 4]), 4.33);
    assert.equal(resolveRatingCriteria([]), DEFAULT_RATING_CRITERIA);
    assert.equal(resolveRatingCriteria([{ key: 'x' }]), DEFAULT_RATING_CRITERIA);
    assert.equal(resolveRatingCriteria([{ key: 'speed', label: 'Speed' }])[0].key, 'speed');
  });

  it('milestones count from the CoC issue date and the close date', () => {
    const rows = [
      { id: 'a', key: 'ceremony', projectContractorId: null, anchor: 'COC_ISSUED' as const, anchorMilestoneKey: null, offsetValue: 7, offsetUnit: 'CALENDAR_DAYS' as const },
      { id: 'b', key: 'post', projectContractorId: null, anchor: 'PROJECT_CLOSED' as const, anchorMilestoneKey: null, offsetValue: 14, offsetUnit: 'CALENDAR_DAYS' as const },
    ];
    const base = { CONTRACT_AWARD: null, CONTRACT_SIGNED: null, KICKOFF: null, ACTIVATION: null };
    const none = computeMilestoneDueDates(rows, { ...base, COC_ISSUED: null, PROJECT_CLOSED: null }, [1, 2, 3, 4, 5]);
    assert.equal(none.get('a'), null);
    const dated = computeMilestoneDueDates(rows, { ...base, COC_ISSUED: '2026-11-02', PROJECT_CLOSED: '2027-05-10' }, [1, 2, 3, 4, 5]);
    assert.equal(dated.get('a'), '2026-11-09');
    assert.equal(dated.get('b'), '2027-05-24');
  });

  it('the type config accepts a closure section', () => {
    const config = ProjectTypeConfigSchema.parse({ closure: { requireCocFor: ['PROJECT_CLOSE'], shareRatingsWithContractor: true } });
    assert.deepEqual(config.closure.requireCocFor, ['PROJECT_CLOSE']);
    assert.equal(config.closure.shareRatingsWithContractor, true);
  });
});

describe('Phase 15 ZIP writer', () => {
  it('round-trips files (stored and deflated), keeps names unique, and caps the size', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    try {
      const file = path.join(dir, 'a.zip');
      const zip = new ZipFileWriter(file);
      const text = Buffer.from('hello closure pack '.repeat(200), 'utf8');
      const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256));
      zip.addFile('docs/a.txt', text);
      zip.addFile('docs/a.txt', random);
      zip.addFile('Ünïcode/naïve.json', Buffer.from('{"ok":true}'));
      const done = zip.finish();
      assert.equal(done.entryCount, 3);
      const files = readZip(fs.readFileSync(file));
      assert.deepEqual([...files.keys()], ['docs/a.txt', 'docs/a (2).txt', 'Ünïcode/naïve.json']);
      assert.ok(files.get('docs/a.txt')!.equals(text));
      assert.ok(files.get('docs/a (2).txt')!.equals(random));
      assert.equal(done.byteSize, fs.statSync(file).size);

      const capped = new ZipFileWriter(path.join(dir, 'b.zip'), 100);
      assert.throws(() => capped.addFile('big.bin', Buffer.from(Array.from({ length: 500 }, (_, i) => i % 251))), /exceed/);
      capped.abort();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
