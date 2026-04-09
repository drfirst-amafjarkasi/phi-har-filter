import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTimestamp, generateUniqueId } from '../src/output.js';
import { getGroupKey, groupEntries } from '../src/summarize.js';

test('generateTimestamp: returns 14-digit YYYYMMDDHHMMSS', () => {
  const ts = generateTimestamp();
  assert.match(ts, /^\d{14}$/);
  // Should be reasonable (2026)
  assert(ts.startsWith('202'));
});

test('generateUniqueId: timestamp.hash8 format', () => {
  const uniqueId = generateUniqueId('abcdef1234567890abcdef1234567890');
  assert.match(uniqueId, /^\d{14}\.[0-9a-f]{8}$/);
  assert(uniqueId.includes('.'));
  const parts = uniqueId.split('.');
  assert.equal(parts[1], 'abcdef12');
});

test('getGroupKey: domain grouping', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/patient/123',
    },
  };
  const key = getGroupKey(entry, 'domain');
  assert.equal(key, 'api.drfirst.com');
});

test('getGroupKey: path grouping', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/patient/123?foo=bar',
    },
  };
  const key = getGroupKey(entry, 'path');
  assert.equal(key, '/patient/123');
});

test('getGroupKey: domain+path grouping', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/patient/123',
    },
  };
  const key = getGroupKey(entry, 'domain+path');
  assert.equal(key, 'api.drfirst.com|/patient/123');
});

test('getGroupKey: unparseable URL', () => {
  const entry = {
    request: {
      url: 'not a valid url :::',
    },
  };
  const key = getGroupKey(entry, 'domain');
  assert.equal(key, '(unparseable)');
});

test('groupEntries: basic grouping by domain', () => {
  const entries = [
    {
      request: { url: 'https://api.drfirst.com/data1' },
      response: { status: 200, content: { size: 1024 } },
      time: 100,
    },
    {
      request: { url: 'https://api.drfirst.com/data2' },
      response: { status: 200, content: { size: 512 } },
      time: 50,
    },
    {
      request: { url: 'https://web.drfirst.com/page' },
      response: { status: 200, content: { size: 2048 } },
      time: 200,
    },
  ];

  const grouped = groupEntries(entries, 'domain');

  assert(grouped['api.drfirst.com']);
  assert.equal(grouped['api.drfirst.com'].count, 2);
  assert.equal(grouped['api.drfirst.com'].totalBytes, 1536);
  assert.equal(grouped['api.drfirst.com'].avgTime, 75);

  assert(grouped['web.drfirst.com']);
  assert.equal(grouped['web.drfirst.com'].count, 1);
});

test('groupEntries: status codes collected', () => {
  const entries = [
    {
      request: { url: 'https://api.drfirst.com/ok' },
      response: { status: 200, headers: [] },
    },
    {
      request: { url: 'https://api.drfirst.com/notfound' },
      response: { status: 404, headers: [] },
    },
    {
      request: { url: 'https://api.drfirst.com/error' },
      response: { status: 500, headers: [] },
    },
  ];

  const grouped = groupEntries(entries, 'domain');
  const statusCodes = grouped['api.drfirst.com'].statusCodes;

  assert.deepEqual(statusCodes.sort((a, b) => a - b), [200, 404, 500]);
});

test('groupEntries: sorted by key', () => {
  const entries = [
    { request: { url: 'https://z.drfirst.com/data' }, response: { headers: [] } },
    { request: { url: 'https://a.drfirst.com/data' }, response: { headers: [] } },
    { request: { url: 'https://m.drfirst.com/data' }, response: { headers: [] } },
  ];

  const grouped = groupEntries(entries, 'domain');
  const keys = Object.keys(grouped);

  assert.deepEqual(keys, ['a.drfirst.com', 'm.drfirst.com', 'z.drfirst.com']);
});
