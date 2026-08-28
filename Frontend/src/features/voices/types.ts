export type Voice = {
  voice_id: string
  name: string
  created_at?: string
  tags?: string[]
}

export type Preset = {
  name: string
  description: string
  gender: string
}
