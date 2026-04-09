import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEntryUrl,
  detectUrlContext,
  inferResourceType,
  detectInitiatorHost,
  analyzeEntry,
} from '../src/match.js';

test('parseEntryUrl: valid https URL', () => {
  const url = parseEntryUrl('https://api.drfirst.com/v1/patient/123');
  assert(url);
  assert.equal(url.hostname, 'api.drfirst.com');
  assert.equal(url.pathname, '/v1/patient/123');
});

test('parseEntryUrl: URL without scheme', () => {
  const url = parseEntryUrl('api.drfirst.com/path');
  assert(url);
  assert.equal(url.hostname, 'api.drfirst.com');
});

test('parseEntryUrl: data URI returns null', () => {
  const url = parseEntryUrl('data:text/html,<h1>test</h1>');
  assert.equal(url, null);
});

test('parseEntryUrl: blob URI returns null', () => {
  const url = parseEntryUrl('blob:https://example.com/abc123');
  assert.equal(url, null);
});

test('parseEntryUrl: invalid URL returns null', () => {
  const url = parseEntryUrl(':::not a url:::');
  assert.equal(url, null);
});

test('detectUrlContext: patient path segments', () => {
  assert.equal(detectUrlContext('/api/patient/123'), 'patient');
  assert.equal(detectUrlContext('/api/patients'), 'patient');
  assert.equal(detectUrlContext('/v2/member/456'), 'patient');
  assert.equal(detectUrlContext('/members/'), 'patient');
});

test('detectUrlContext: word boundary prevents false match', () => {
  assert.equal(detectUrlContext('/api/impatient'), 'unknown');
  assert.equal(detectUrlContext('/impatients'), 'unknown');
});

test('detectUrlContext: provider path segments', () => {
  assert.equal(detectUrlContext('/api/prescriber/789'), 'provider');
  assert.equal(detectUrlContext('/providers'), 'provider');
  assert.equal(detectUrlContext('/npi/1234567890'), 'provider');
});

test('detectUrlContext: unknown context', () => {
  assert.equal(detectUrlContext('/api/v1/data'), 'unknown');
  assert.equal(detectUrlContext(''), 'unknown');
});

test('inferResourceType: _resourceType field', () => {
  const entry = { _resourceType: 'XHR' };
  assert.equal(inferResourceType(entry), 'xhr');
});

test('inferResourceType: MIME type detection', () => {
  const jsonEntry = { response: { content: { mimeType: 'application/json' } } };
  assert.equal(inferResourceType(jsonEntry), 'fetch');

  const jsEntry = { response: { content: { mimeType: 'application/javascript' } } };
  assert.equal(inferResourceType(jsEntry), 'script');

  const cssEntry = { response: { content: { mimeType: 'text/css' } } };
  assert.equal(inferResourceType(cssEntry), 'stylesheet');
});

test('inferResourceType: URL extension detection', () => {
  const jsUrl = { request: { url: 'https://example.com/app.js?v=1' } };
  assert.equal(inferResourceType(jsUrl), 'script');

  const cssUrl = { request: { url: 'https://example.com/style.css' } };
  assert.equal(inferResourceType(cssUrl), 'stylesheet');

  const imgUrl = { request: { url: 'https://example.com/logo.png' } };
  assert.equal(inferResourceType(imgUrl), 'image');
});

test('inferResourceType: default to other', () => {
  const unknown = { request: { url: 'https://example.com/data.bin' } };
  assert.equal(inferResourceType(unknown), 'other');
});

test('detectInitiatorHost: _initiator.url', () => {
  const entry = {
    _initiator: { url: 'https://portal.drfirst.com/dashboard' },
    request: { headers: [] },
  };
  const host = detectInitiatorHost(entry);
  assert.equal(host, 'portal.drfirst.com');
});

test('detectInitiatorHost: Referer header fallback', () => {
  const entry = {
    request: {
      headers: [
        { name: 'Referer', value: 'https://api.drfirst.com/auth' },
      ],
    },
  };
  const host = detectInitiatorHost(entry);
  assert.equal(host, 'api.drfirst.com');
});

test('detectInitiatorHost: Origin header fallback', () => {
  const entry = {
    request: {
      headers: [
        { name: 'Origin', value: 'https://web.drfirst.com' },
      ],
    },
  };
  const host = detectInitiatorHost(entry);
  assert.equal(host, 'web.drfirst.com');
});

test('detectInitiatorHost: Origin null string ignored', () => {
  const entry = {
    request: {
      headers: [
        { name: 'Origin', value: 'null' },
      ],
    },
  };
  const host = detectInitiatorHost(entry);
  assert.equal(host, null);
});

test('detectInitiatorHost: no initiator returns null', () => {
  const entry = { request: { headers: [] } };
  const host = detectInitiatorHost(entry);
  assert.equal(host, null);
});

test('analyzeEntry: full analysis', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/patient/123',
      method: 'GET',
      headers: [
        { name: 'Referer', value: 'https://portal.drfirst.com' },
      ],
    },
    response: { status: 200 },
  };
  const allowList = ['drfirst.com'];
  const result = analyzeEntry(entry, allowList, []);

  assert.equal(result.hostname, 'api.drfirst.com');
  assert.equal(result.urlContext, 'patient');
  assert.equal(result.initiatorHost, 'portal.drfirst.com');
  assert.equal(result.initiatorFirstParty, true);
});
