import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAuthSecretKey,
  isPatientKey,
  isProviderKey,
  shouldRedactHeader,
  shouldRedactQueryKey,
  redactJsonBody,
  redactEntry,
  PROVIDER_KEYS,
  PATIENT_KEYS,
  REDACT_PLACEHOLDER,
} from '../src/redact.js';

// CRITICAL REGRESSION TEST: NPI is in PROVIDER_KEYS, not PATIENT_KEYS.
// It must NEVER be redacted by default.
test('REGRESSION: NPI is NOT redacted by default', () => {
  assert(PROVIDER_KEYS.has('npi'), 'NPI must be in PROVIDER_KEYS');
  assert(!PATIENT_KEYS.has('npi'), 'NPI must NOT be in PATIENT_KEYS');

  const entry = {
    request: {
      url: 'https://api.drfirst.com/prescriber/details',
      queryString: [
        { name: 'npi', value: '1234567890' },
      ],
      headers: [],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'provider', {
    redactLevel: 'hipaa',
    redactProviderPii: false, // NOT redacting provider PII
  }, counters);

  // NPI value should be UNCHANGED
  assert.equal(
    redacted.request.queryString[0].value,
    '1234567890',
    'NPI must NOT be redacted when redactProviderPii=false'
  );
});

// NPI SHOULD be redacted when --redact-provider-pii is set
test('NPI IS redacted when redactProviderPii=true', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/prescriber/details',
      queryString: [
        { name: 'npi', value: '1234567890' },
      ],
      headers: [],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'provider', {
    redactLevel: 'hipaa',
    redactProviderPii: true, // NOW redacting provider PII
  }, counters);

  // NPI value should be REDACTED
  assert.equal(
    redacted.request.queryString[0].value,
    REDACT_PLACEHOLDER,
    'NPI must be redacted when redactProviderPii=true'
  );
});

test('Patient ID is always redacted', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      queryString: [
        { name: 'patient_id', value: 'PAT12345' },
      ],
      headers: [],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'unknown', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
  }, counters);

  assert.equal(
    redacted.request.queryString[0].value,
    REDACT_PLACEHOLDER,
    'patient_id must always be redacted'
  );
});

test('Authorization header is always redacted', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      queryString: [],
      headers: [
        { name: 'Authorization', value: 'Bearer token123abc' },
      ],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'unknown', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
  }, counters);

  assert.equal(
    redacted.request.headers[0].value,
    REDACT_PLACEHOLDER,
    'Authorization header must be redacted'
  );
});

test('Cookie header is always redacted', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      queryString: [],
      headers: [
        { name: 'Cookie', value: 'sessionid=abc123xyz789' },
      ],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'unknown', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
  }, counters);

  assert.equal(
    redacted.request.headers[0].value,
    REDACT_PLACEHOLDER,
    'Cookie header must be redacted'
  );
});

test('User-Agent is redacted in hipaa mode', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      queryString: [],
      headers: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      ],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'unknown', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
  }, counters);

  assert.equal(
    redacted.request.headers[0].value,
    REDACT_PLACEHOLDER,
    'User-Agent must be redacted in hipaa mode'
  );
});

test('User-Agent is kept when keepUserAgent=true', () => {
  const originalUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      queryString: [],
      headers: [
        { name: 'User-Agent', value: originalUA },
      ],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'unknown', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
    keepUserAgent: true,
  }, counters);

  assert.equal(
    redacted.request.headers[0].value,
    originalUA,
    'User-Agent must be kept when keepUserAgent=true'
  );
});

test('dryRun mode: counters increment but values unchanged', () => {
  const entry = {
    request: {
      url: 'https://api.drfirst.com/data',
      queryString: [
        { name: 'patient_id', value: 'PAT12345' },
        { name: 'npi', value: '1234567890' },
      ],
      headers: [
        { name: 'Authorization', value: 'Bearer secret' },
      ],
    },
    response: { headers: [] },
  };

  const counters = {};
  const redacted = redactEntry(entry, 'unknown', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
    dryRun: true,
  }, counters);

  // Values should be unchanged
  assert.equal(
    redacted.request.queryString[0].value,
    'PAT12345',
    'dryRun: patient_id value unchanged'
  );
  assert.equal(
    redacted.request.queryString[1].value,
    '1234567890',
    'dryRun: npi value unchanged'
  );
  assert.equal(
    redacted.request.headers[0].value,
    'Bearer secret',
    'dryRun: Authorization value unchanged'
  );

  // But counters should be incremented
  assert(counters.redactedQueryParamsCount >= 1, 'dryRun: counters should track patient_id');
  assert(counters.redactedHeadersCount >= 1, 'dryRun: counters should track Authorization');
});

test('shouldRedactQueryKey: patient context keys', () => {
  assert.equal(shouldRedactQueryKey('patient_id', 'patient', [], false), true);
  assert.equal(shouldRedactQueryKey('mrn', 'patient', [], false), true);
  assert.equal(shouldRedactQueryKey('dob', 'patient', [], false), true);
});

test('shouldRedactQueryKey: provider keys respect redactProviderPii flag', () => {
  // When redactProviderPii=false, provider keys are NOT redacted
  assert.equal(shouldRedactQueryKey('npi', 'provider', [], false), false);
  assert.equal(shouldRedactQueryKey('dea', 'provider', [], false), false);

  // When redactProviderPii=true, provider keys ARE redacted
  assert.equal(shouldRedactQueryKey('npi', 'provider', [], true), true);
  assert.equal(shouldRedactQueryKey('dea', 'provider', [], true), true);
});

test('redactJsonBody: recursive redaction', () => {
  const obj = {
    user: {
      username: 'johndoe',
      patient_id: 'P123',
      contact: {
        email: 'john@example.com',
      },
    },
  };

  const counters = {};
  const redacted = redactJsonBody(obj, 'patient', {
    redactLevel: 'hipaa',
    redactProviderPii: false,
  }, counters);

  assert.equal(redacted.user.patient_id, REDACT_PLACEHOLDER);
  assert.equal(redacted.user.contact.email, REDACT_PLACEHOLDER);
  // username is not in any redaction set, so it's preserved
  assert.equal(redacted.user.username, 'johndoe');
});

test('isAuthSecretKey: recognizes auth/secret keys', () => {
  assert.equal(isAuthSecretKey('authorization'), true);
  assert.equal(isAuthSecretKey('Authorization'), true);
  assert.equal(isAuthSecretKey('api_key'), true);
  assert.equal(isAuthSecretKey('token'), true);
  assert.equal(isAuthSecretKey('cookie'), true);
  assert.equal(isAuthSecretKey('jwt'), true);
});

test('isPatientKey: recognizes patient identifier keys', () => {
  assert.equal(isPatientKey('patient_id'), true);
  assert.equal(isPatientKey('mrn'), true);
  assert.equal(isPatientKey('dob'), true);
  assert.equal(isPatientKey('member_id'), true);
});

test('isProviderKey: recognizes provider identifier keys', () => {
  assert.equal(isProviderKey('npi'), true);
  assert.equal(isProviderKey('dea'), true);
  assert.equal(isProviderKey('prescriber_id'), true);
});
