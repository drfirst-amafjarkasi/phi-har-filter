import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDomain,
  matchesDomain,
  isAllowedDomain,
  parseDomainList,
  DEFAULT_DRFIRST_DOMAINS,
} from '../src/domains.js';

test('normalizeDomain: lowercase and strip dots', () => {
  assert.equal(normalizeDomain('DrFirst.COM'), 'drfirst.com');
  assert.equal(normalizeDomain('.drfirst.com.'), 'drfirst.com');
  assert.equal(normalizeDomain('API.DRFIRST.COM'), 'api.drfirst.com');
});

test('matchesDomain: exact match', () => {
  assert.equal(matchesDomain('drfirst.com', 'drfirst.com'), true);
  assert.equal(matchesDomain('DRFIRST.COM', 'drfirst.com'), true);
});

test('matchesDomain: subdomain match', () => {
  assert.equal(matchesDomain('api.drfirst.com', 'drfirst.com'), true);
  assert.equal(matchesDomain('deep.nested.drfirst.com', 'drfirst.com'), true);
});

test('matchesDomain: no partial match', () => {
  assert.equal(matchesDomain('evil-drfirst.com', 'drfirst.com'), false);
  assert.equal(matchesDomain('evildrfirst.com', 'drfirst.com'), false);
});

test('matchesDomain: IP address does not match', () => {
  assert.equal(matchesDomain('192.168.1.1', 'drfirst.com'), false);
});

test('isAllowedDomain: allow list check', () => {
  const allowList = ['drfirst.com', 'rxhub.net'];
  assert.equal(isAllowedDomain('api.drfirst.com', allowList), true);
  assert.equal(isAllowedDomain('example.com', allowList), false);
});

test('isAllowedDomain: exclude overrides allow', () => {
  const allowList = ['drfirst.com'];
  const excludeList = ['api.drfirst.com'];
  assert.equal(isAllowedDomain('api.drfirst.com', allowList, excludeList), false);
  assert.equal(isAllowedDomain('other.drfirst.com', allowList, excludeList), true);
});

test('parseDomainList: JSON array', () => {
  const json = '["drfirst.com", "rxhub.net"]';
  const result = parseDomainList(json);
  assert.deepEqual(result, ['drfirst.com', 'rxhub.net']);
});

test('parseDomainList: newline-delimited with comments', () => {
  const text = `drfirst.com
# This is a comment
rxhub.net
  # Another comment
iprescribe.com`;
  const result = parseDomainList(text);
  assert.deepEqual(result, ['drfirst.com', 'rxhub.net', 'iprescribe.com']);
});

test('parseDomainList: empty lines and whitespace', () => {
  const text = `drfirst.com

  rxhub.net  `;
  const result = parseDomainList(text);
  assert.deepEqual(result, ['drfirst.com', 'rxhub.net']);
});

test('DEFAULT_DRFIRST_DOMAINS is populated', () => {
  assert(Array.isArray(DEFAULT_DRFIRST_DOMAINS));
  assert(DEFAULT_DRFIRST_DOMAINS.length > 0);
  assert(DEFAULT_DRFIRST_DOMAINS.includes('drfirst.com'));
});
