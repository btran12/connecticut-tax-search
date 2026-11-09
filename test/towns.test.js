import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOWN,
  normalizeTownSlug,
  resolveTown,
  SUPPORTED_TOWNS,
  TOWN_BY_SLUG,
  TOWNS,
  townName,
  townSourceUrl,
} from '../lib/towns.js';

test('catalog contains all 169 Connecticut municipalities', () => {
  assert.equal(TOWNS.length, 169);
  assert.equal(new Set(TOWNS.map((town) => town.name)).size, 169);
  assert.equal(new Set(TOWNS.map((town) => town.slug)).size, 169);
  assert.equal(SUPPORTED_TOWNS.length, 160);
});

test('towns are alphabetical with stable mytaxbill slugs', () => {
  const names = TOWNS.map((town) => town.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  assert.equal(TOWN_BY_SLUG.get('hartford')?.name, 'Hartford');
  assert.equal(TOWN_BY_SLUG.get('easthampton')?.name, 'East Hampton');
  assert.equal(TOWN_BY_SLUG.get('newbritain')?.name, 'New Britain');
  assert.equal(TOWN_BY_SLUG.get('windsorlocks')?.name, 'Windsor Locks');
  assert.equal(TOWN_BY_SLUG.get('northstonington')?.name, 'North Stonington');
});

test('normalizes town names, slugs, and punctuation', () => {
  assert.equal(normalizeTownSlug('East Hampton'), 'easthampton');
  assert.equal(normalizeTownSlug('east-hampton'), 'easthampton');
  assert.equal(normalizeTownSlug('  New   Haven  '), 'newhaven');
  assert.equal(resolveTown('West Hartford')?.slug, 'westhartford');
  assert.equal(resolveTown('westhartford')?.slug, 'westhartford');
  assert.equal(resolveTown('Not A Town'), null);
  assert.equal(resolveTown(''), null);
});

test('towns without mytaxbill coverage are marked unavailable', () => {
  for (const name of [
    'Avon',
    'Darien',
    'East Lyme',
    'Ledyard',
    'Lyme',
    'Milford',
    'Salem',
    'Southington',
    'Winchester',
  ]) {
    assert.equal(resolveTown(name)?.supported, false, `${name} should be unavailable`);
  }

  assert.equal(resolveTown('Hartford')?.supported, true);
  assert.equal(resolveTown('hartford')?.supported, true);
});

test('default town and source links are generated', () => {
  assert.equal(DEFAULT_TOWN, 'hartford');
  assert.equal(townName('easthampton'), 'East Hampton');
  assert.equal(
    townSourceUrl('hartford'),
    'https://www.mytaxbill.org/inet/bill/home.do?town=hartford',
  );
});
