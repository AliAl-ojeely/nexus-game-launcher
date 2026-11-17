'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { titleAndYear, releaseYear, searchQueries, chooseSteamGridGame } =
    require('../modules/asset-sgdb-identity-v062.cjs');

const entry = (id, name, year, verified = true, types = ['game']) => ({
    id, name, verified, types, release_date: year ? `${year}-02-05` : null,
});

test('user-supplied year is not part of the title identity', () => {
    assert.deepEqual(titleAndYear("Dante's Inferno (2010)"), { title: "Dante's Inferno", year: 2010 });
    assert.deepEqual(titleAndYear('Dante\u2019s Inferno [2010]'), { title: 'Dante\u2019s Inferno', year: 2010 });
    assert.equal(titleAndYear('FIFA 2010').title, 'FIFA 2010');
});

test('SteamGridDB dates can arrive as ISO strings or Unix seconds', () => {
    assert.equal(releaseYear('2010-02-05'), 2010);
    assert.equal(releaseYear(1265328000), 2010);
    assert.equal(releaseYear(1265328000000), 2010);
    assert.equal(releaseYear('not-a-date'), null);
});

test('Dante 2010 resolves correct year even when another game shares its base title', () => {
    const games = [entry(100, "Dante's Inferno", 2007), entry(200, "Dante's Inferno (2010)", 2010)];
    assert.deepEqual(chooseSteamGridGame("Dante's Inferno (2010)", games),
        { id: '200', reason: 'title_and_release_year' });
});

test('RAWG canonical title and year bridge Dantes Inferno without Steam AppID', () => {
    const games = [entry(100, "Dante's Inferno (2007)", 2007), entry(200, "Dante's Inferno (2010)", 2010)];
    assert.equal(chooseSteamGridGame('Dantes Inferno', games,
        { canonicalName: "Dante's Inferno", releaseYear: 2010 }).id, '200');
    const queries = searchQueries('Dantes Inferno', { canonicalName: "Dante's Inferno", releaseYear: 2010 });
    assert.ok(queries.includes("Dante's Inferno"));
    assert.ok(queries.includes("Dante's Inferno (2010)"));
    assert.ok(queries.length <= 5);
});

test('never assign art from a sequel, unrelated prefix, soundtrack, film, or DLC', () => {
    const name = "Dante's Inferno (2010)";
    const excluded = [
        entry(1, "Dante's Inferno II", 2010),
        entry(2, "Dante's Inferno Animated Epic", 2010),
        entry(3, "Dante's Inferno (2010)", 2010, true, ['movie']),
        entry(4, "Dante's Inferno (2010)", 2010, true, ['soundtrack']),
        entry(5, "Dante's Inferno (2010)", 2010, true, ['dlc']),
    ];
    assert.equal(chooseSteamGridGame(name, excluded).id, null);
});

test('a wrong release year must be rejected despite an exact title', () => {
    assert.equal(chooseSteamGridGame("Dante's Inferno (2010)", [entry(9, "Dante's Inferno", 2018)]).id, null);
});

test('identical evidence for different provider IDs remains ambiguous', () => {
    const selection = chooseSteamGridGame("Dante's Inferno (2010)", [
        entry(10, "Dante's Inferno (2010)", 2010),
        entry(11, "Dante's Inferno (2010)", 2010),
    ]);
    assert.equal(selection.id, null);
    assert.equal(selection.reason, 'ambiguous_identity');
});

test('verified exact game wins a tie with unverified exact game', () => {
    const selected = chooseSteamGridGame('Untitled Quest', [
        entry(20, 'Untitled Quest', null, false), entry(21, 'Untitled Quest', null, true),
    ]);
    assert.equal(selected.id, '21');
});

test('same game ID repeated in multiple search responses is not ambiguity', () => {
    assert.equal(chooseSteamGridGame('Dante\u2019s Inferno', [
        entry(30, "Dante's Inferno", 2010), entry('30', "Dante's Inferno", 2010),
    ]).id, '30');
});

test('an emulator with an exact software identity is allowed', () => {
    assert.equal(chooseSteamGridGame('RPCS3', [entry(400, 'RPCS3', 2020, true, ['software'])]).id, '400');
});

test('canonical hints cannot override a different user-requested game', () => {
    assert.equal(chooseSteamGridGame('Silent Hill 2', [entry(500, 'Silent Hill 3', 2003)],
        { canonicalName: 'Silent Hill 3', releaseYear: 2003 }).id, null);
});

test('installed SteamGrid provider uses verified identity helper and existing asset API', () => {
    const original = fs.readFileSync(path.join(__dirname, '..', 'modules', 'steamGrid-api.js'), 'utf8');
    const pipeline = fs.readFileSync(path.join(__dirname, '..', 'modules', 'asset-pipeline.js'), 'utf8');
    assert.match(original, /chooseSteamGridGame\(gameName,\s*\[\.\.\.results\.values\(\)\]/);
    assert.match(original, /searchQueries\(gameName,/);
    assert.match(original, /options\.kinds/);
    assert.match(pipeline, /canonicalName:\s*rawg\?\.name/);
    assert.match(pipeline, /releaseYear:/);
    assert.match(pipeline, /fetchGameAssets\(lookupName,\s*undefined,\s*gridOptions\)/);
});

