import type { ScreeningDecision, ScreeningRelevance } from '../types.js';
import type { ScreeningState } from './screening.js';

export interface ScreeningSuggestionDraft {
  suggestedDecision: ScreeningDecision;
  suggestedRelevance?: ScreeningRelevance;
  confidence: number;
  rationale: string;
  method: 'heuristic';
}

/**
 * A cheap, explainable first pass. It is a suggestion, never a decision.
 * Model-based relevance and abstract entailment come later.
 */
export function suggestScreening(state: ScreeningState): ScreeningSuggestionDraft {
  if (state.citability === 'pending') {
    return {
      suggestedDecision: 'maybe',
      suggestedRelevance: 'supporting',
      confidence: 0.3,
      rationale: 'verification is incomplete',
      method: 'heuristic',
    };
  }

  if (state.citability === 'not_citable') {
    return {
      suggestedDecision: 'exclude',
      confidence: 0.9,
      rationale: `not citable: ${state.citability}`,
      method: 'heuristic',
    };
  }

  if (state.filterFlags.length) {
    return {
      suggestedDecision: 'exclude',
      confidence: 0.7,
      rationale: `matches brief filter: ${state.filterFlags.join(', ')}`,
      method: 'heuristic',
    };
  }

  if (isEditorial(state.source.type)) {
    return {
      suggestedDecision: 'exclude',
      confidence: 0.8,
      rationale: `source type is ${state.source.type}`,
      method: 'heuristic',
    };
  }

  if (state.citability === 'citable_warned') {
    return {
      suggestedDecision: 'maybe',
      suggestedRelevance: 'supporting',
      confidence: 0.6,
      rationale: 'an integrity notice is attached',
      method: 'heuristic',
    };
  }

  if (!state.source.abstract) {
    return {
      suggestedDecision: 'maybe',
      suggestedRelevance: 'supporting',
      confidence: 0.4,
      rationale: 'no abstract available',
      method: 'heuristic',
    };
  }

  if (state.citability === 'citable_marked') {
    return {
      suggestedDecision: 'include',
      suggestedRelevance: 'supporting',
      confidence: 0.5,
      rationale: 'likely-valid registry match',
      method: 'heuristic',
    };
  }

  return {
    suggestedDecision: 'include',
    suggestedRelevance: 'supporting',
    confidence: 0.4,
    rationale: 'verified; no exclusion filter matched',
    method: 'heuristic',
  };
}

function isEditorial(type: string | undefined): boolean {
  const clean = (type ?? '').toLowerCase();
  return (
    clean.includes('editorial') ||
    clean.includes('erratum') ||
    clean.includes('comment') ||
    clean.includes('retraction')
  );
}
