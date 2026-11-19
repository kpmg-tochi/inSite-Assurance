import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidJoinCode, JOIN_CODE_MAX_LENGTH } from '@insite/shared';
import { formatJoinCodeInput, normalizeJoinCode } from './joinCodeInput';

/** Types `text` one character at a time through the formatter, as the TextInput does. */
function typeIn(text: string): string {
  let value = '';
  for (const ch of text) value = formatJoinCodeInput(value + ch).slice(0, JOIN_CODE_MAX_LENGTH);
  return value;
}

/** What the screen sends: typed, then normalised. */
const entered = (text: string) => normalizeJoinCode(typeIn(text));

describe('join code input', () => {
  it('standard code typed without hyphens', () => {
    assert.equal(typeIn('lkk402con7k2qxm'), 'LKK-402-CON7K2QXM');
    assert.equal(entered('lkk402con7k2qxm'), 'LKK-402-CON-7K2QXM');
    assert.ok(isValidJoinCode(entered('lkk402con7k2qxm')));
  });

  it('standard code with a 2- and a 4-character role suffix', () => {
    assert.equal(entered('lkk402co7k2qxm'), 'LKK-402-CO-7K2QXM');
    assert.equal(entered('lkk402cons7k2qxm'), 'LKK-402-CONS-7K2QXM');
  });

  it('standard code typed with hyphens', () => {
    assert.equal(typeIn('lkk-402-con-7k2qxm'), 'LKK-402-CON-7K2QXM');
    assert.equal(entered('lkk-402-con-7k2qxm'), 'LKK-402-CON-7K2QXM');
  });

  it('pasted codes stay as they are', () => {
    assert.equal(formatJoinCodeInput('LKK-402-CON-7K2QXM'), 'LKK-402-CON-7K2QXM');
    assert.equal(formatJoinCodeInput('LKK-402-CON-ELEC-7K2QXM'), 'LKK-402-CON-ELEC-7K2QXM');
    assert.equal(normalizeJoinCode('LKK-402-CON-ELEC-7K2QXM'), 'LKK-402-CON-ELEC-7K2QXM');
  });

  it('contractor code typed with hyphens', () => {
    assert.equal(typeIn('lkk402con-elec-7k2qxm'), 'LKK-402-CON-ELEC-7K2QXM');
    assert.ok(isValidJoinCode(entered('lkk402con-elec-7k2qxm')));
  });

  it('contractor code typed without its last hyphen', () => {
    assert.equal(entered('lkk402con-elec7k2qxm'), 'LKK-402-CON-ELEC-7K2QXM');
  });

  it('longest contractor code fits the input limit', () => {
    const code = 'LKK-402-CONS-ELECTR-7K2QXM';
    assert.equal(code.length, JOIN_CODE_MAX_LENGTH);
    assert.equal(typeIn(code), code);
    assert.ok(isValidJoinCode(entered(code)));
  });

  it('keeps a hyphen just typed, and drops it on backspace', () => {
    assert.equal(formatJoinCodeInput('LKK-402-CON-'), 'LKK-402-CON-');
    assert.equal(formatJoinCodeInput('LKK-402-CON'), 'LKK-402-CON');
    assert.equal(formatJoinCodeInput('LKK-402-CON-ELEC-7K2QXM-'), 'LKK-402-CON-ELEC-7K2QXM');
  });

  it('an incomplete code stays invalid', () => {
    assert.equal(isValidJoinCode(entered('lkk402con7k2')), false);
  });
});
