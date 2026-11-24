export const VIDEO_PROMPT_MAX_LENGTH = 8000

export type BatchPromptSeparator = 'line' | 'paragraph' | 'numbered'

export function parseVideoBatchPrompts(text: string, separator: BatchPromptSeparator): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (separator === 'numbered') {
    const [preamble, ...items] = normalized.split(/^[ \t]*\d+[.)](?:[ \t]+|$)/m)
    const prompts = items.map((item) => item.trim())
    // A missing item must not shift the remaining prompts onto the wrong images.
    return preamble.trim() || prompts.some((prompt) => !prompt) ? [] : prompts
  }
  return normalized
    .split(separator === 'line' ? '\n' : /\n(?:[ \t]*\n)+/)
    .map((prompt) => prompt.trim())
    .filter(Boolean)
}
