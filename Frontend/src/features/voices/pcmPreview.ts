/** Decode s16le even when the HTTP transport splits a sample across chunks. */
export class PcmDecoder {
  private pending: number | undefined

  decode(chunk: Uint8Array): Float32Array<ArrayBuffer> {
    const bytes = new Uint8Array(chunk.length + (this.pending === undefined ? 0 : 1))
    let offset = 0
    if (this.pending !== undefined) bytes[offset++] = this.pending
    bytes.set(chunk, offset)
    this.pending = bytes.length % 2 ? bytes[bytes.length - 1] : undefined
    const samples = new Float32Array(Math.floor(bytes.length / 2))
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
    return samples
  }

  finish() {
    if (this.pending !== undefined) throw new Error('Luồng âm thanh kết thúc giữa một mẫu PCM.')
  }
}

export class PcmPreviewPlayer {
  private controller = new AbortController()
  private context = new AudioContext()
  private nodes = new Set<AudioBufferSourceNode>()

  stop() {
    this.controller.abort()
    for (const node of this.nodes) node.stop()
    this.nodes.clear()
    if (this.context.state !== 'closed') void this.context.close()
  }

  async play(url: string, text: string, onPlaying: () => void) {
    // Resume immediately within the click gesture, before waiting for the network.
    await this.context.resume()
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text || undefined }), signal: this.controller.signal,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || `Không thể nghe thử (HTTP ${response.status}).`)
    }
    const rate = Number(response.headers.get('X-Sample-Rate'))
    if (!response.body || !Number.isFinite(rate) || rate < 8000 || rate > 96000) {
      throw new Error('Voice Service trả luồng âm thanh không hợp lệ.')
    }
    const reader = response.body.getReader()
    const decoder = new PcmDecoder()
    let nextTime = this.context.currentTime + 0.15
    let started = false
    try {
      while (!this.controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        const samples = decoder.decode(value)
        if (!samples.length) continue
        const buffer = this.context.createBuffer(1, samples.length, rate)
        buffer.copyToChannel(samples, 0)
        const node = this.context.createBufferSource()
        node.buffer = buffer
        node.connect(this.context.destination)
        this.nodes.add(node)
        node.onended = () => { this.nodes.delete(node); node.disconnect() }
        nextTime = Math.max(nextTime, this.context.currentTime + 0.03)
        node.start(nextTime)
        nextTime += buffer.duration
        if (!started) { started = true; onPlaying() }
        // Bound queued audio; reading resumes as playback consumes it.
        while (nextTime - this.context.currentTime > 2 && !this.controller.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 40))
        }
      }
      if (!this.controller.signal.aborted) {
        decoder.finish()
        if (!started) throw new Error('Không nhận được âm thanh.')
        while (this.nodes.size && !this.controller.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 40))
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
}
