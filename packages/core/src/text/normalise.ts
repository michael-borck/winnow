/** Normalise text for quote matching and source-text hashing. */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00ad/g, '')
    .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseTitle(input: string): string {
  return normaliseText(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseDoi(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}
