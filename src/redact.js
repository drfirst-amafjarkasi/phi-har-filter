/**
 * HIPAA-oriented privacy redaction engine.
 * Critical invariant: NPI is NOT patient PHI. It must NEVER be redacted by default.
 */

export const AUTH_SECRET_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-amz-security-token',
  'token',
  'access_token',
  'refresh_token',
  'api_secret',
  'secret',
  'password',
  'passwd',
  'client_secret',
  'bearer',
  'jwt',
  'session_id',
  'session_token',
  'apikey',
  'api_key',
  'x-auth-token',
  'auth_token',
]);

export const PATIENT_KEYS = new Set([
  'patient_id',
  'patientid',
  'patient_mrn',
  'mrn',
  'member_id',
  'memberid',
  'subscriber_id',
  'subscriberid',
  'beneficiary_id',
  'beneficiaryid',
  'patient_name',
  'patientname',
  'firstname',
  'first_name',
  'firstname',
  'lastname',
  'last_name',
  'lastname',
  'fullname',
  'full_name',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'birthdate',
  'birth_date',
  'ssn',
  'social_security',
  'social_security_number',
  'address',
  'street_address',
  'zip',
  'zipcode',
  'zip_code',
  'phone',
  'phonenumber',
  'phone_number',
  'mobile',
  'mobile_phone',
  'email',
  'emailaddress',
  'email_address',
  'insurance_id',
  'insuranceid',
  'plan_member_id',
  'plan_memberid',
  'rx_number',
  'rxnumber',
  'prescription_number',
  'account_id',
  'accountid',
  'chart_number',
  'chartnumber',
  'person_id',
  'personid',
  'enrollee_id',
  'enrolleeid',
]);

/**
 * PROVIDER_KEYS: identifiers for prescribers, providers, clinicians.
 * NPI ('npi') is in this set. These are NOT redacted by default.
 * Only redacted when --redact-provider-pii is set.
 */
export const PROVIDER_KEYS = new Set([
  'npi', // National Provider Identifier - NOT patient PHI
  'prescriber_npi',
  'prescriber_npi',
  'provider_npi',
  'dea', // DEA number - NOT patient PHI
  'dea_number',
  'prescriber_id',
  'prescriberid',
  'provider_id',
  'providerid',
  'prescriber_name',
  'prescribername',
  'provider_name',
  'providername',
  'clinic_name',
  'clinicname',
  'practice_name',
  'practicename',
  'facility_name',
  'facilityname',
  'taxonomy_code',
  'taxonomycode',
  'specialty',
  'office_address',
  'officeaddress',
  'office_phone',
  'officephone',
  'state_license',
  'statelicense',
  'state_license_number',
  'statelicensenumber',
  'license_number',
  'licensenumber',
  'clinician_id',
  'clinicianid',
  'physician_id',
  'physicianid',
  'hcp_id',
  'hcpid',
]);

const AMBIGUOUS_KEYS = new Set([
  'id',
  'identifier',
  'name',
  'number',
  'value',
  'user_id',
  'userid',
  'account_id',
  'accountid',
]);

export const REDACT_PLACEHOLDER = '[REDACTED]';
export const BODY_PLACEHOLDER = '[BODY_REDACTED: non-JSON content]';

/**
 * Check if a key (lowercase) is an auth/secret key.
 * @param {string} keyLower
 * @returns {boolean}
 */
export function isAuthSecretKey(keyLower) {
  if (!keyLower || typeof keyLower !== 'string') return false;
  const lower = keyLower.toLowerCase();
  return AUTH_SECRET_KEYS.has(lower);
}

/**
 * Check if a key is a patient identifier.
 * @param {string} keyLower
 * @returns {boolean}
 */
export function isPatientKey(keyLower) {
  if (!keyLower || typeof keyLower !== 'string') return false;
  const lower = keyLower.toLowerCase();
  return PATIENT_KEYS.has(lower);
}

/**
 * Check if a key is a provider identifier.
 * @param {string} keyLower
 * @returns {boolean}
 */
export function isProviderKey(keyLower) {
  if (!keyLower || typeof keyLower !== 'string') return false;
  const lower = keyLower.toLowerCase();
  return PROVIDER_KEYS.has(lower);
}

/**
 * Check if a header should be redacted.
 * User-Agent is redacted in hipaa mode (device fingerprint).
 * @param {string} headerName
 * @param {Object} opts - { redactLevel, redactProviderPii, ... }
 * @returns {boolean}
 */
export function shouldRedactHeader(headerName, opts = {}) {
  if (!headerName || typeof headerName !== 'string') return false;

  const lower = headerName.toLowerCase();

  // Always redact auth/secrets
  if (isAuthSecretKey(lower)) return true;

  // User-Agent: redact in hipaa mode, keep in minimal/none
  if (lower === 'user-agent' || lower === 'useragent') {
    return opts.redactLevel === 'hipaa' && !opts.keepUserAgent;
  }

  return false;
}

/**
 * Decide whether a query parameter key should be redacted.
 * Uses context-aware logic to avoid over-redaction of provider PII.
 *
 * @param {string} key
 * @param {string} urlContext - 'patient'|'provider'|'unknown'
 * @param {string[]} allKeys - all param keys in this query string
 * @param {boolean} redactProviderPii
 * @returns {boolean}
 */
export function shouldRedactQueryKey(key, urlContext, allKeys = [], redactProviderPii = false) {
  if (!key || typeof key !== 'string') return false;

  const lower = key.toLowerCase();

  // Always redact auth/secrets
  if (isAuthSecretKey(lower)) return true;

  // Always redact patient keys
  if (isPatientKey(lower)) return true;

  // Redact provider keys only if --redact-provider-pii
  if (isProviderKey(lower)) return redactProviderPii;

  // Ambiguous key: redact if context suggests patient, or if sibling keys are patient keys
  if (AMBIGUOUS_KEYS.has(lower)) {
    if (urlContext === 'patient') return true;
    if (urlContext === 'provider') return redactProviderPii;
    // Check siblings
    const hasSiblingPatientKey = allKeys.some((k) =>
      isPatientKey(k.toLowerCase())
    );
    if (hasSiblingPatientKey) return true;
  }

  return false;
}

/**
 * Recursively redact a JSON object.
 * Depth limit: 50 to prevent stack overflow.
 * Context is inherited from parent key classification.
 *
 * @param {unknown} obj
 * @param {string} urlContext
 * @param {Object} opts - { redactLevel, redactProviderPii, dryRun }
 * @param {Object} counters - { redactedJsonFields, ... }
 * @param {number} depth
 * @returns {unknown}
 */
export function redactJsonBody(obj, urlContext, opts = {}, counters = {}, depth = 0) {
  if (depth > 50) {
    // Depth limit to prevent stack overflow
    return obj;
  }

  // Null/undefined pass through
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitive types
  if (typeof obj !== 'object') {
    return obj;
  }

  // Array: recurse
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      redactJsonBody(item, urlContext, opts, counters, depth + 1)
    );
  }

  // Object: recurse on values, apply redaction rules on keys
  const result = {};
  const allKeys = Object.keys(obj);

  for (const key of allKeys) {
    const value = obj[key];
    const lower = key.toLowerCase();

    // Check if this key should be redacted
    let shouldRedact = false;

    if (isAuthSecretKey(lower)) {
      shouldRedact = true;
    } else if (isPatientKey(lower)) {
      shouldRedact = true;
    } else if (isProviderKey(lower)) {
      shouldRedact = opts.redactProviderPii === true;
    } else if (AMBIGUOUS_KEYS.has(lower)) {
      // Ambiguous: redact if patient context or if sibling is patient key
      if (urlContext === 'patient') {
        shouldRedact = true;
      } else if (allKeys.some((k) => isPatientKey(k.toLowerCase()))) {
        shouldRedact = true;
      }
    }

    if (shouldRedact && !opts.dryRun) {
      result[key] = REDACT_PLACEHOLDER;
      counters.redactedJsonFields = (counters.redactedJsonFields || 0) + 1;
    } else if (shouldRedact && opts.dryRun) {
      result[key] = value; // don't modify
      counters.redactedJsonFields = (counters.redactedJsonFields || 0) + 1;
    } else if (typeof value === 'object') {
      // Recurse on nested objects
      result[key] = redactJsonBody(value, urlContext, opts, counters, depth + 1);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Apply regex scrubbing patterns (email, phone, SSN, DOB).
 * Only applied when urlContext === 'patient' (not for provider context).
 *
 * @param {string} value
 * @param {string} urlContext
 * @param {Object} counters
 * @param {boolean} dryRun
 * @returns {string}
 */
export function applyRegexScrub(value, urlContext, counters = {}, dryRun = false) {
  if (typeof value !== 'string' || urlContext !== 'patient') {
    return value;
  }

  let scrubbed = value;

  // Email: user@domain.ext
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(scrubbed)) {
    if (!dryRun) scrubbed = scrubbed.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, '<redacted-email>');
    counters.regexMatches = (counters.regexMatches || 0) + 1;
  }

  // Phone: (XXX) XXX-XXXX or XXX-XXX-XXXX or 1-XXX-XXX-XXXX
  if (/\b(?:\+?1\s?)?(?:\(\d{3}\)|\d{3})[.\s-]?\d{3}[.\s-]?\d{4}\b/.test(scrubbed)) {
    if (!dryRun) scrubbed = scrubbed.replace(/\b(?:\+?1\s?)?(?:\(\d{3}\)|\d{3})[.\s-]?\d{3}[.\s-]?\d{4}\b/g, '<redacted-phone>');
    counters.regexMatches = (counters.regexMatches || 0) + 1;
  }

  // SSN: XXX-XX-XXXX
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(scrubbed)) {
    if (!dryRun) scrubbed = scrubbed.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '<redacted-ssn>');
    counters.regexMatches = (counters.regexMatches || 0) + 1;
  }

  // DOB: MM/DD/YYYY or YYYY-MM-DD
  if (/\b(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/.test(scrubbed)) {
    if (!dryRun) scrubbed = scrubbed.replace(/\b(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g, '<redacted-dob>');
    counters.regexMatches = (counters.regexMatches || 0) + 1;
  }

  return scrubbed;
}

/**
 * Top-level entry redaction orchestrator.
 * Redacts request headers, query params, body, and response headers/body.
 *
 * @param {Object} entry - HAR entry
 * @param {string} urlContext
 * @param {Object} opts - { redactLevel, redactProviderPii, dryRun, noRegexScrub, keepBodies }
 * @param {Object} counters
 * @returns {Object} - redacted entry copy
 */
export function redactEntry(entry, urlContext, opts = {}, counters = {}) {
  if (!entry || typeof entry !== 'object') return entry;

  const redacted = JSON.parse(JSON.stringify(entry)); // deep copy

  counters.redactedHeadersCount = counters.redactedHeadersCount || 0;
  counters.redactedQueryParamsCount = counters.redactedQueryParamsCount || 0;
  counters.redactedPatientFieldsCount = counters.redactedPatientFieldsCount || 0;
  counters.redactedProviderFieldsCount = counters.redactedProviderFieldsCount || 0;
  counters.redactedBodiesCount = counters.redactedBodiesCount || 0;

  // Redact request headers
  if (redacted.request?.headers && Array.isArray(redacted.request.headers)) {
    for (const header of redacted.request.headers) {
      if (header.name && header.value) {
        if (shouldRedactHeader(header.name, opts)) {
          if (!opts.dryRun) {
            header.value = REDACT_PLACEHOLDER;
          }
          counters.redactedHeadersCount++;
        }
      }
    }
  }

  // Redact query string
  if (redacted.request?.queryString && Array.isArray(redacted.request.queryString)) {
    const allKeys = redacted.request.queryString.map((q) => q.name);
    for (const param of redacted.request.queryString) {
      if (
        shouldRedactQueryKey(
          param.name,
          urlContext,
          allKeys,
          opts.redactProviderPii === true
        )
      ) {
        if (!opts.dryRun) {
          param.value = REDACT_PLACEHOLDER;
        }
        counters.redactedQueryParamsCount++;
      }
    }
  }

  // Redact POST data parameters
  if (redacted.request?.postData?.params && Array.isArray(redacted.request.postData.params)) {
    const allKeys = redacted.request.postData.params.map((p) => p.name);
    for (const param of redacted.request.postData.params) {
      if (
        shouldRedactQueryKey(
          param.name,
          urlContext,
          allKeys,
          opts.redactProviderPii === true
        )
      ) {
        if (!opts.dryRun) {
          param.value = REDACT_PLACEHOLDER;
        }
        counters.redactedQueryParamsCount++;
      }
    }
  }

  // Redact POST data text (JSON)
  if (redacted.request?.postData?.text) {
    try {
      const parsed = JSON.parse(redacted.request.postData.text);
      const scrubbed = redactJsonBody(
        parsed,
        urlContext,
        opts,
        counters
      );
      if (!opts.dryRun) {
        redacted.request.postData.text = JSON.stringify(scrubbed);
      }
    } catch {
      // Not JSON; leave as-is (could redact body entirely in strict mode)
      if (opts.redactLevel === 'strict' && !opts.keepBodies && !opts.dryRun) {
        redacted.request.postData.text = BODY_PLACEHOLDER;
        counters.redactedBodiesCount++;
      }
    }
  }

  // Redact response headers
  if (redacted.response?.headers && Array.isArray(redacted.response.headers)) {
    for (const header of redacted.response.headers) {
      if (header.name && header.value) {
        if (shouldRedactHeader(header.name, opts)) {
          if (!opts.dryRun) {
            header.value = REDACT_PLACEHOLDER;
          }
          counters.redactedHeadersCount++;
        }
      }
    }
  }

  // Redact response body
  if (redacted.response?.content?.text) {
    const mimeType = redacted.response.content.mimeType || '';
    const isJson = mimeType.includes('json') || mimeType === '';

    if (isJson) {
      try {
        const parsed = JSON.parse(redacted.response.content.text);
        const scrubbed = redactJsonBody(
          parsed,
          urlContext,
          opts,
          counters
        );
        if (!opts.dryRun && opts.redactLevel !== 'strict') {
          redacted.response.content.text = JSON.stringify(scrubbed);
        } else if (!opts.dryRun && opts.redactLevel === 'strict') {
          redacted.response.content.text = BODY_PLACEHOLDER;
          redacted.response.content.size = 0;
          counters.redactedBodiesCount++;
        }
      } catch {
        // Parse failed; treat as non-JSON in hipaa/strict
        if (opts.redactLevel === 'hipaa' && !opts.keepBodies && !opts.dryRun) {
          redacted.response.content.text = BODY_PLACEHOLDER;
          redacted.response.content.size = 0;
          counters.redactedBodiesCount++;
        } else if (opts.redactLevel === 'strict' && !opts.dryRun) {
          redacted.response.content.text = BODY_PLACEHOLDER;
          redacted.response.content.size = 0;
          counters.redactedBodiesCount++;
        }
      }
    } else {
      // Non-JSON body in hipaa/strict mode
      if ((opts.redactLevel === 'hipaa' || opts.redactLevel === 'strict') && !opts.keepBodies && !opts.dryRun) {
        redacted.response.content.text = BODY_PLACEHOLDER;
        redacted.response.content.size = 0;
        counters.redactedBodiesCount++;
      }
    }
  }

  return redacted;
}
