import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatusFilter,
  filterEntry,
  buildRedirectGraph,
  expandKeepSetWithRedirects,
} from '../src/filter.js';
import { analyzeEntry } from '../src/match.js';

test('parseStatusFilter: single status', () => {
  const filter = parseStatusFilter('200');
  assert.equal(filter(200), true);
  assert.equal(filter(404), false);
});

test('parseStatusFilter: range', () => {
  const filter = parseStatusFilter('200-399');
  assert.equal(filter(200), true);
  assert.equal(filter(299), true);
  assert.equal(filter(399), true);
  assert.equal(filter(400), false);
});

test('parseStatusFilter: plus', () => {
  const filter = parseStatusFilter('400+');
  assert.equal(filter(400), true);
  assert.equal(filter(500), true);
  assert.equal(filter(399), false);
});

test('parseStatusFilter: class', () => {
  const filter = parseStatusFilter('4xx');
  assert.equal(filter(400), true);
  assert.equal(filter(404), true);
  assert.equal(filter(499), true);
  assert.equal(filter(500), false);
  assert.equal(filter(399), false);
});

test('filterEntry: domain check', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      method: 'GET',
      headers: [],
    },
    response: { status: 200, headers: [] },
  };
  const parsed = analyzeEntry(entry, ['drfirst.com'], []);

  const decision = filterEntry(entry, 0, parsed, {
    allowList: ['drfirst.com'],
    excludeList: [],
    statusFilter: null,
    allowedMethods: null,
    allowedResourceTypes: null,
    timeAfterMs: null,
    timeBeforeMs: null,
    firstPartyOnly: false,
    firstPartyStrict: false,
    keepRedirects: false,
  });

  assert.equal(decision.keep, true);
});

test('filterEntry: domain not allowlisted', () => {
  const entry = {
    request: {
      url: 'https://evil.com/data',
      method: 'GET',
      headers: [],
    },
    response: { status: 200, headers: [] },
  };
  const parsed = analyzeEntry(entry, ['drfirst.com'], []);

  const decision = filterEntry(entry, 0, parsed, {
    allowList: ['drfirst.com'],
    excludeList: [],
    statusFilter: null,
    allowedMethods: null,
    allowedResourceTypes: null,
    timeAfterMs: null,
    timeBeforeMs: null,
    firstPartyOnly: false,
    firstPartyStrict: false,
    keepRedirects: false,
  });

  assert.equal(decision.keep, false);
  assert(decision.reasons.includes('not-allowlisted'));
});

test('filterEntry: domain in exclude list', () => {
  const entry = {
    request: {
      url: 'https://analytics.drfirst.com/track',
      method: 'GET',
      headers: [],
    },
    response: { status: 200, headers: [] },
  };
  const parsed = analyzeEntry(entry, ['drfirst.com'], ['analytics.drfirst.com']);

  const decision = filterEntry(entry, 0, parsed, {
    allowList: ['drfirst.com'],
    excludeList: ['analytics.drfirst.com'],
    statusFilter: null,
    allowedMethods: null,
    allowedResourceTypes: null,
    timeAfterMs: null,
    timeBeforeMs: null,
    firstPartyOnly: false,
    firstPartyStrict: false,
    keepRedirects: false,
  });

  assert.equal(decision.keep, false);
});

test('filterEntry: status filter', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      method: 'GET',
      headers: [],
    },
    response: { status: 500, headers: [] },
  };
  const parsed = analyzeEntry(entry, ['drfirst.com'], []);

  const statusFilter = parseStatusFilter('200-399');
  const decision = filterEntry(entry, 0, parsed, {
    allowList: ['drfirst.com'],
    excludeList: [],
    statusFilter,
    allowedMethods: null,
    allowedResourceTypes: null,
    timeAfterMs: null,
    timeBeforeMs: null,
    firstPartyOnly: false,
    firstPartyStrict: false,
    keepRedirects: false,
  });

  assert.equal(decision.keep, false);
  assert(decision.reasons.includes('status-filtered'));
});

test('filterEntry: first-party with known initiator', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      method: 'GET',
      headers: [
        { name: 'Referer', value: 'https://portal.drfirst.com' },
      ],
    },
    response: { status: 200, headers: [] },
  };
  const parsed = analyzeEntry(entry, ['drfirst.com'], []);

  const decision = filterEntry(entry, 0, parsed, {
    allowList: ['drfirst.com'],
    excludeList: [],
    statusFilter: null,
    allowedMethods: null,
    allowedResourceTypes: null,
    timeAfterMs: null,
    timeBeforeMs: null,
    firstPartyOnly: true,
    firstPartyStrict: false,
    keepRedirects: false,
  });

  assert.equal(decision.keep, true);
});

test('filterEntry: first-party-strict with unknown initiator', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      method: 'GET',
      headers: [], // no Referer or Origin
    },
    response: { status: 200, headers: [] },
  };
  const parsed = analyzeEntry(entry, ['drfirst.com'], []);

  const decision = filterEntry(entry, 0, parsed, {
    allowList: ['drfirst.com'],
    excludeList: [],
    statusFilter: null,
    allowedMethods: null,
    allowedResourceTypes: null,
    timeAfterMs: null,
    timeBeforeMs: null,
    firstPartyOnly: true,
    firstPartyStrict: true, // strict mode
    keepRedirects: false,
  });

  assert.equal(decision.keep, false);
  assert(decision.reasons.includes('unknown-initiator'));
});

test('buildRedirectGraph: simple redirect', () => {
  const metadata = [
    {
      index: 0,
      url: 'https://api.drfirst.com/old',
      redirectURL: 'https://api.drfirst.com/new',
      location: '',
      status: 301,
      pageref: null,
      keep: true,
      urlContext: 'unknown',
      initiatorHost: null,
      reasons: [],
    },
    {
      index: 1,
      url: 'https://api.drfirst.com/new',
      redirectURL: '',
      location: '',
      status: 200,
      pageref: null,
      keep: true,
      urlContext: 'unknown',
      initiatorHost: null,
      reasons: [],
    },
  ];

  const { graph } = buildRedirectGraph(metadata);
  assert(graph.has(0));
  assert.deepEqual(graph.get(0), [1]);
});

test('expandKeepSetWithRedirects: simple chain', () => {
  const graph = new Map([
    [0, [1]],
    [1, [2]],
  ]);
  const initialKeepSet = new Set([0]);
  const finalKeepSet = expandKeepSetWithRedirects(initialKeepSet, graph, 10);

  assert(finalKeepSet.has(0));
  assert(finalKeepSet.has(1));
  assert(finalKeepSet.has(2));
});

test('expandKeepSetWithRedirects: depth limit', () => {
  const graph = new Map([
    [0, [1]],
    [1, [2]],
    [2, [3]],
  ]);
  const initialKeepSet = new Set([0]);
  const finalKeepSet = expandKeepSetWithRedirects(initialKeepSet, graph, 1);

  assert(finalKeepSet.has(0));
  assert(finalKeepSet.has(1));
  assert(!finalKeepSet.has(2)); // beyond depth 1
});

test('expandKeepSetWithRedirects: cycle prevention', () => {
  const graph = new Map([
    [0, [1]],
    [1, [0]], // cycle back to 0
  ]);
  const initialKeepSet = new Set([0]);
  const finalKeepSet = expandKeepSetWithRedirects(initialKeepSet, graph, 10);

  // Should have both 0 and 1, but not infinite loop
  assert(finalKeepSet.has(0));
  assert(finalKeepSet.has(1));
  assert.equal(finalKeepSet.size, 2);
});

test('expandKeepSetWithRedirects: diamond graph', () => {
  // 0 -> [1, 2], 1 -> [3], 2 -> [3]
  const graph = new Map([
    [0, [1, 2]],
    [1, [3]],
    [2, [3]],
  ]);
  const initialKeepSet = new Set([0]);
  const finalKeepSet = expandKeepSetWithRedirects(initialKeepSet, graph, 10);

  assert(finalKeepSet.has(0));
  assert(finalKeepSet.has(1));
  assert(finalKeepSet.has(2));
  assert(finalKeepSet.has(3));
  assert.equal(finalKeepSet.size, 4); // No duplicates
});
