// Native contenteditable editors may serialize blank lines and NBSP differently.
// Preserve words, case, accents and punctuation; normalize whitespace only.
export function normalizeFlowPrompt(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}
