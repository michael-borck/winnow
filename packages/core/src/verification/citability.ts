import type { Citability, VerificationRecord } from '../types.js';

const WARNING_NOTICES = new Set(['retracted', 'withdrawn', 'expression_of_concern']);

/**
 * Derive citability from the five verification axes.
 *
 * This is the only place the rule lives. The draft checker and both citation
 * exporters call it, so they cannot disagree. Order is part of the contract:
 * incomplete checks stay pending, definitive negative signals win, and an
 * integrity notice outranks a clean identity.
 */
export function citability(record: VerificationRecord): Citability {
  if (record.completeness.status === 'incomplete') return 'pending';

  if (
    record.identity === 'not_found' ||
    record.identity === 'suspicious' ||
    record.identity === 'format_only'
  ) {
    return 'not_citable';
  }

  if (record.matchCategory === 'match_dubious' || record.matchCategory === 'conflict') {
    return 'not_citable';
  }

  const warned = record.integrity.some((notice) => WARNING_NOTICES.has(notice));
  if (
    warned &&
    (record.identity === 'verified' ||
      record.identity === 'likely_valid' ||
      record.identity === 'user_attested')
  ) {
    return 'citable_warned';
  }

  if (record.identity === 'user_attested') return 'citable_attested';

  if (
    record.identity === 'verified' &&
    (record.matchCategory === 'exact' || record.matchCategory === 'variant_record')
  ) {
    return 'citable';
  }

  if (record.identity === 'likely_valid' || record.matchCategory === 'metadata_drift') {
    return 'citable_marked';
  }

  return 'not_citable';
}

export function isCitable(value: Citability): boolean {
  return value === 'citable' || value.startsWith('citable_');
}

export function citabilityNote(value: Citability, record: VerificationRecord): string {
  const parts: string[] = [`winnow: ${value}`];
  if (value === 'citable_marked') {
    parts.push(record.identity === 'likely_valid' ? 'likely_valid' : 'metadata_drift');
  }
  if (value === 'citable_attested') parts.push('attested');
  if (value === 'citable_warned') {
    for (const notice of record.integrity) {
      if (WARNING_NOTICES.has(notice)) parts.push(notice);
    }
  }
  return parts.join('; ');
}
