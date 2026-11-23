import { test } from 'node:test'
import assert from 'node:assert/strict'

import { analysisErrorFromResponse, analysisNeedsLogin, AnalysisError } from '../services/analysisError.ts'

test('chỉ HTTP 401 (lỗi đăng nhập/cookie Gemini) mới gợi ý làm mới cookie', () => {
  const login = analysisErrorFromResponse(401, 'Lỗi phân tích (gemini): Chưa đăng nhập Gemini…', 'gemini')
  assert.equal(login.needsLogin, true)
  assert.equal(analysisNeedsLogin(login), true)
  assert.equal(login.message, 'Lỗi phân tích (gemini): Chưa đăng nhập Gemini…')

  // Lỗi khác (Google 5xx, template, mạng…): làm mới cookie không giải quyết được → không gợi ý.
  for (const status of [400, 500, 502, 503]) {
    assert.equal(analysisNeedsLogin(analysisErrorFromResponse(status, 'x', 'gemini')), false, String(status))
  }
})

test('không có detail thì vẫn ra câu báo lỗi có mã HTTP', () => {
  assert.equal(analysisErrorFromResponse(500, undefined, 'chatgpt').message, 'Lỗi phân tích chatgpt (HTTP 500)')
})

test('lỗi thường (mất mạng, lỗi JS) không bị coi là lỗi đăng nhập', () => {
  assert.equal(analysisNeedsLogin(new Error('Failed to fetch')), false)
  assert.equal(analysisNeedsLogin('x'), false)
  assert.ok(analysisErrorFromResponse(401, 'a', 'gemini') instanceof AnalysisError)
})

test('chạy cả quy trình: node Phân tích nhận cờ analysisNeedsLogin đúng theo loại lỗi', async () => {
  const { runRealWorkflow } = await import('../services/workflowRunner.ts')
  const nodes = [
    {
      id: 'p', type: 'productAssets', position: { x: 0, y: 0 },
      data: {
        images: ['https://example.com/polo.jpg'],
        assets: [{ id: 'a1', kind: 'product', previewUrl: '/assets/polo.jpg', backendPath: 'C:/polo.jpg', uploadStatus: 'uploaded' }],
      },
    },
    { id: 'g', type: 'geminiAnalysis', position: { x: 200, y: 0 }, data: { prompt: 'x', provider: 'gemini' } },
  ]
  const edges = [{ id: 'e', source: 'p', target: 'g' }]
  for (const [status, expected] of [[401, true], [500, false]] as const) {
    const patches: Record<string, any>[] = []
    await runRealWorkflow({
      startNodeId: 'g', nodes: nodes as any, edges: edges as any,
      callbacks: { onNodeStateChange: (_id, patch) => patches.push(patch), onError: () => {}, onSuccess: () => {} },
      dependencies: { callGeminiAnalysis: async () => { throw analysisErrorFromResponse(status, 'boom', 'gemini') } },
    })
    const failure = patches.find((p) => 'analysisNeedsLogin' in p)
    assert.ok(failure, `HTTP ${status}: không thấy patch lỗi`)
    assert.equal(failure.analysisNeedsLogin, expected, `HTTP ${status}`)
  }
})
