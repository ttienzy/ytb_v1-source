import type { GeneratedSceneItem, GptSalesScriptItem } from '../types.ts'

/** Build narration in timeline order. Legacy scripts are indexed before filtering. */
export function buildVoiceoverPlan(
  scenes: GeneratedSceneItem[],
  voiceId: string,
  completedOnly: boolean,
  scripts: GptSalesScriptItem[] = [],
): { texts: string[]; signature: string } {
  const selected = scenes.flatMap((scene, index) => {
    const outputPath = (scene.outputFilePath || scene.videoUrl || '').trim()
    if (completedOnly && !outputPath) return []

    // An explicit empty snapshot means no narration: never revive an old script.
    const script = scripts[index]
    const text = (scene.voiceover === undefined
      ? script?.voiceover || script?.content || ''
      : scene.voiceover).trim()
    if (!text) {
      throw new Error(`Cảnh ${scene.sceneNumber} chưa có lời thoại (voiceover). Hãy bổ sung lời thoại trước khi tạo lồng tiếng.`)
    }

    return [{ text, durationSec: scene.durationSec, sceneNumber: scene.sceneNumber,
      ...(completedOnly ? { outputPath } : {}) }]
  })

  return {
    texts: selected.map(scene => scene.text),
    signature: JSON.stringify({ voiceId, completedOnly, scenes: selected }),
  }
}

/** Unsigned, stale, or disabled narration must never reach an export. */
export function selectCachedVoiceoverPath(
  voiceEnabled: boolean,
  signature: string,
  cache: {
    voiceoverSignature?: string | null
    voiceoverFilePath?: string | null
    voiceoverUrl?: string | null
  },
): string | undefined {
  if (!voiceEnabled || !signature || cache.voiceoverSignature !== signature) return undefined
  return cache.voiceoverFilePath?.trim() || cache.voiceoverUrl?.trim() || undefined
}
