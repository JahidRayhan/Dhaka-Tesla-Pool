import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, bn, translate, plural, localizeDigits, pickInitialLanguage } from '../lib/strings.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every English string has a Bangla translation, and vice versa', () => {
  const missingInBn = Object.keys(en).filter((k) => !(k in bn));
  const extraInBn = Object.keys(bn).filter((k) => !(k in en));
  assert.deepEqual(missingInBn, [], 'add these to the Bangla table');
  assert.deepEqual(extraInBn, [], 'these Bangla keys have no English source');
});

test('translations keep exactly the same {placeholders} as the English source', () => {
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(bn[key]), placeholders(en[key]), `placeholders differ for "${key}"`);
  }
});

test('no translation is empty, and Bangla strings are actually Bangla (not copied English)', () => {
  for (const [key, value] of Object.entries(bn)) {
    assert.ok(value.trim().length > 0, key);
  }
  const allowSame = new Set(['english', 'bangla', 'appName', 'areas']);
  const untranslated = Object.keys(en).filter((k) => !allowSame.has(k) && bn[k] === en[k]);
  assert.deepEqual(untranslated, [], 'identical to English');
});

test('translate fills placeholders, localises their digits, and falls back sensibly', () => {
  assert.equal(translate('en', 'minLeft', { n: 5 }), '5 min left');
  assert.equal(translate('bn', 'minLeft', { n: 12 }), '১২ মিনিট বাকি');
  assert.equal(translate('en', 'sharingWith', { names: 'Rafiq, Shirin' }), 'Sharing with Rafiq, Shirin');
  assert.equal(translate('en', 'no_such_key'), 'no_such_key');
  assert.equal(translate('en', 'minLeft', {}), '{n} min left', 'a missing variable stays visible rather than becoming "undefined"');
  assert.equal(translate('fr', 'signIn'), 'Sign in', 'unknown language falls back to English');
});

test('plural and digit helpers', () => {
  assert.equal(plural('en', 'seat', 1), '1 seat');
  assert.equal(plural('en', 'seat', 3), '3 seats');
  assert.equal(plural('bn', 'seat', 2), '২টি সিট');
  assert.equal(localizeDigits('৳205.66', 'bn'), '৳২০৫.৬৬');
  assert.equal(localizeDigits('৳205.66', 'en'), '৳205.66');
});

test('device locale picks the starting language', () => {
  assert.equal(pickInitialLanguage('bn-BD'), 'bn');
  assert.equal(pickInitialLanguage('BN'), 'bn');
  assert.equal(pickInitialLanguage('en-US'), 'en');
  assert.equal(pickInitialLanguage(undefined), 'en');
});

test('every status and verification label used by the screens exists', () => {
  for (const status of ['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']) assert.ok(en[`s_${status}`] && bn[`s_${status}`], status);
  for (const v of ['PENDING', 'VERIFIED', 'REJECTED', 'NONE']) assert.ok(en[`v_${v}`] && bn[`v_${v}`], v);
  for (const r of ['SEATS', 'WOMEN_ONLY', 'ROUTE', 'POOL_BUSY']) assert.ok(en[`whyNot_${r}`] && bn[`whyNot_${r}`], r);
  for (let d = 1; d <= 7; d++) assert.ok(en[`d${d}`] && bn[`d${d}`], `day ${d}`);
});
