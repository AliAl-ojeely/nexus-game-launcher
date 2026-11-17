'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const libraryPath = path.join(root, 'render', 'library.js');
const databasePath = path.join(root, 'modules', 'database.js');
const library = fs.readFileSync(libraryPath, 'utf8');
const database = fs.readFileSync(databasePath, 'utf8');
const begin = library.indexOf('function sortGameCollection(games, sortValue) {');
const end = library.indexOf('function filterGameCollection(pageId)', begin);
assert.ok(begin !== -1 && end > begin, 'Expected library sort function is present');
const source = library.slice(begin, end);

function sortWithFixtures(games, sortValue, playtimeMap = {}) {
  const context = vm.createContext({ nexusPlaytimeMap: playtimeMap });
  const sort = vm.runInContext(`${source}\nsortGameCollection`, context);
  return Array.from(sort(games, sortValue), game => game.name);
}

const sample = [
  { id: 9999999999999, name: 'Old imported game' },
  { id: 1790000000000, name: 'Another older game' },
  { id: 1794953634102, name: "Dante's Inferno (2010)" },
];

test('recently added places the last appended game first even when older IDs are larger', () => {
  assert.deepEqual(sortWithFixtures(sample, 'added_desc'), [
    "Dante's Inferno (2010)", 'Another older game', 'Old imported game',
  ]);
});

test('recently added handles re-added game with a restored old ID', () => {
  const games = [
    { id: 1794953634102, name: 'Newer ID from older library entry' },
    { id: 1700000000000, name: 'Re-added from archive' },
  ];
  assert.deepEqual(sortWithFixtures(games, 'added_desc'), [
    'Re-added from archive', 'Newer ID from older library entry',
  ]);
});

test('recently added works with string, missing, and non-numeric identifiers', () => {
  const games = [{ id: 'game-A', name: 'Alpha' }, { id: null, name: 'Beta' }, { name: 'Gamma' }];
  assert.deepEqual(sortWithFixtures(games, 'added_desc'), ['Gamma', 'Beta', 'Alpha']);
});

test('sorting is non-mutating and does not rewrite the original array', () => {
  const namesBefore = sample.map(game => game.name);
  sortWithFixtures(sample, 'added_desc');
  assert.deepEqual(sample.map(game => game.name), namesBefore);
});

test('default manual-order input is not changed by the new sort', () => {
  assert.deepEqual(sortWithFixtures(sample, 'default'), sample.map(game => game.name));
});

test('alphabetical sorting remains unchanged', () => {
  const games = [{ name: 'Zeta' }, { name: 'Alpha' }, { name: 'Middle' }];
  assert.deepEqual(sortWithFixtures(games, 'name_asc'), ['Alpha', 'Middle', 'Zeta']);
  assert.deepEqual(sortWithFixtures(games, 'name_desc'), ['Zeta', 'Middle', 'Alpha']);
});

test('recently played continues to follow lastPlayed, not addition order', () => {
  const games = [{ name: 'Older' }, { name: 'Recent' }, { name: 'Unplayed' }];
  const time = { Older: { lastPlayed: '2026-01-01T00:00:00Z' }, Recent: { lastPlayed: '2026-11-17T22:00:00Z' } };
  assert.deepEqual(sortWithFixtures(games, 'recent_desc', time), ['Recent', 'Older', 'Unplayed']);
});

test('most played continues to use playtime totals', () => {
  const games = [{ name: 'Few' }, { name: 'Many' }, { name: 'None' }];
  const time = { Few: { minutes: 1 }, Many: { minutes: 55 } };
  assert.deepEqual(sortWithFixtures(games, 'playtime_desc', time), ['Many', 'Few', 'None']);
});

test('favorites use the same sort on their filtered subset', () => {
  const games = [
    { name: 'Favorite old', isFavorite: true },
    { name: 'Not favorite', isFavorite: false },
    { name: 'Favorite new', isFavorite: true },
  ];
  assert.deepEqual(sortWithFixtures(games.filter(g => g.isFavorite), 'added_desc'), ['Favorite new', 'Favorite old']);
});

test('empty collections are handled without errors', () => {
  assert.deepEqual(sortWithFixtures([], 'added_desc'), []);
});

test('database still appends new games without ID-based sorting', () => {
  assert.match(database, /games\.push\(formattedGame\)/);
  assert.match(database, /return games\.map\(game => \{/);
});

test('only recently added uses insertion order and existing sort options remain present', () => {
  assert.match(source, /case "added_desc":\s*\/\/[^\r\n]*\s*result\.reverse\(\);/);
  for (const label of ['name_asc', 'name_desc', 'playtime_desc', 'recent_desc']) {
    assert.ok(source.includes(`case "${label}":`), label);
  }
  assert.doesNotMatch(source, /Number\(b\.id\) - Number\(a\.id\)/);
});
