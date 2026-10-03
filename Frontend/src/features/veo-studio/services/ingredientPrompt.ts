export function ingredientPrompt(prompt: string, present: { subject: boolean; scene: boolean; style: boolean }): string {
  const slots = [ ['subject', 'Chủ thể'], ['scene', 'Bối cảnh'], ['style', 'Phong cách'] ] as const
  let index = 0
  let result = prompt.trim()
  for (const [role, label] of slots) {
    if (present[role]) {
      index++
      result = result.replaceAll(`[${label}]`, `ảnh tham chiếu ${index} (${label.toLowerCase()})`)
    } else if (result.includes(`[${label}]`)) {
      throw new Error(`Prompt có [${label}] nhưng ô ảnh này đang trống.`)
    }
  }
  return result
}
