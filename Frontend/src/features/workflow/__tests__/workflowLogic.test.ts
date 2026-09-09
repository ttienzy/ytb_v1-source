import assert from 'node:assert/strict'
import type { Node, Edge } from '@xyflow/react'
import {
  resolveProductAssetsInput,
  resolveCharacterSceneInput,
  resolveGeminiAnalysisInput,
} from '../services/graphResolver.ts'
import { buildScenePlan, splitScriptToScenes } from '../services/buildScenePlan.ts'
import type { AssetRef, SalesScript } from '../contracts.ts'

console.log('🧪 Bắt đầu chạy Workflow Unit Tests...')

// ─── TEST 1: resolveProductAssetsInput lọc sạch null assets ───────────────
{
  const mockNodes: Node[] = [
    {
      id: 'node-products',
      type: 'productAssets',
      position: { x: 0, y: 0 },
      data: {
        images: ['https://example.com/img1.jpg', null, 'https://example.com/img2.jpg'],
        assets: [
          {
            id: 'asset-1',
            kind: 'product',
            previewUrl: '/api/workflow/assets/asset-1',
            backendPath: 'C:\\assets\\asset-1.jpg',
            uploadStatus: 'uploaded',
          },
          null,
          undefined,
        ],
      },
    },
    {
      id: 'node-gemini',
      type: 'geminiAnalysis',
      position: { x: 200, y: 0 },
      data: {},
    },
  ]

  const mockEdges: Edge[] = [
    {
      id: 'e1',
      source: 'node-products',
      target: 'node-gemini',
    },
  ]

  const res = resolveProductAssetsInput({
    nodes: mockNodes,
    edges: mockEdges,
    targetNodeId: 'node-gemini',
  })

  assert.equal(res.ok, true, 'resolveProductAssetsInput phải thành công')
  assert.equal(res.data?.assets.length, 1, 'Phải lọc sạch các phần tử null/undefined')
  assert.equal(res.data?.assets[0].backendPath, 'C:\\assets\\asset-1.jpg')
  assert.equal(res.data?.rawImages.length, 2, 'Phải có 2 ảnh không null')
  console.log('✅ TEST 1 PASSED: resolveProductAssetsInput lọc null thành công')
}

// ─── TEST 2: resolveCharacterSceneInput bảo toàn backendPath ──────────────
{
  const mockNodes: Node[] = [
    {
      id: 'node-char',
      type: 'characterScene',
      position: { x: 0, y: 0 },
      data: {
        modelImage: '/api/workflow/assets/model-1',
        sceneImage: '/api/workflow/assets/scene-1',
        modelAsset: {
          id: 'model-1',
          kind: 'model',
          previewUrl: '/api/workflow/assets/model-1',
          backendPath: 'C:\\assets\\model-1.jpg',
          uploadStatus: 'uploaded',
        },
        sceneAsset: {
          id: 'scene-1',
          kind: 'scene',
          previewUrl: '/api/workflow/assets/scene-1',
          backendPath: 'C:\\assets\\scene-1.jpg',
          uploadStatus: 'uploaded',
        },
      },
    },
    {
      id: 'node-gpt',
      type: 'gptScript',
      position: { x: 200, y: 0 },
      data: {},
    },
  ]

  const mockEdges: Edge[] = [
    {
      id: 'e2',
      source: 'node-char',
      target: 'node-gpt',
    },
  ]

  const res = resolveCharacterSceneInput({
    nodes: mockNodes,
    edges: mockEdges,
    targetNodeId: 'node-gpt',
  })

  assert.equal(res.ok, true)
  assert.equal(res.data?.model?.backendPath, 'C:\\assets\\model-1.jpg', 'Phải giữ nguyên backendPath của model')
  assert.equal(res.data?.scene?.backendPath, 'C:\\assets\\scene-1.jpg', 'Phải giữ nguyên backendPath của scene')
  console.log('✅ TEST 2 PASSED: resolveCharacterSceneInput bảo toàn backendPath thành công')
}

// ─── TEST 3: buildScenePlan validate số kịch bản & clamp thời lượng ───────
{
  const mockScripts: SalesScript[] = [
    { angle: 'Góc 1', title: 'Tiêu đề 1', content: 'Nội dung 1' },
    { angle: 'Góc 2', title: 'Tiêu đề 2', content: 'Nội dung 2' },
  ]

  // Test 3.1: Nếu yêu cầu 3 cảnh mà chỉ có 2 script -> Phải ném lỗi rõ ràng, không lặp
  assert.throws(
    () => {
      buildScenePlan({
        scripts: mockScripts,
        sceneConfig: { count: 3 },
      })
    },
    /Không đủ số lượng kịch bản/,
    'Phải ném lỗi khi scripts.length < count'
  )

  // Test 3.2: Khi có đủ 2 script cho 2 cảnh và thời lượng > 10s -> Phải clamp về tối đa 10s
  const scenes = buildScenePlan({
    scripts: mockScripts,
    sceneConfig: {
      count: 2,
      durations: [12, 16], // Vượt quá giới hạn Veo 10s
    },
  })

  assert.equal(scenes.length, 2)
  assert.equal(scenes[0].durationSec, 10, 'Thời lượng cảnh 1 phải được clamp về 10s')
  assert.equal(scenes[1].durationSec, 10, 'Thời lượng cảnh 2 phải được clamp về 10s')
  console.log('✅ TEST 3 PASSED: buildScenePlan validate script count và clamp duration thành công')
}

// ─── TEST 4: splitScriptToScenes clamp thời lượng ─────────────────────────
{
  const script: SalesScript = {
    angle: 'Góc 1',
    title: 'Áo polo',
    content: 'Full content',
    hook: 'Bạn đang tìm áo polo hè?',
    problem: 'Nóng bức và bí bách?',
    product: 'Áo Polo Pique Cotton',
    benefits: 'Co giãn và thoáng mát',
    cta: 'Mua ngay hôm nay',
  }

  const scenes = splitScriptToScenes({
    script,
    sceneConfig: {
      durations: [6, 15, 6], // Cảnh 2 là 15s -> phải clamp về 10s
    },
  })

  assert.equal(scenes.length, 3)
  assert.equal(scenes[0].durationSec, 6)
  assert.equal(scenes[1].durationSec, 10, 'Cảnh 2 phải bị clamp về 10s')
  assert.equal(scenes[2].durationSec, 6)
  console.log('✅ TEST 4 PASSED: splitScriptToScenes clamp duration thành công')
}

// ─── TEST 5: buildScenePlan hỗ trợ 5 kịch bản & ưu tiên visualDirection ───
{
  const mock5Scripts: SalesScript[] = [
    { angle: 'Review chân thực', title: 'Áo polo test', content: 'Thoại 1', visualDirection: 'Cận cảnh bàn tay sờ vải' },
    { angle: 'Lifestyle', title: 'Đi làm', content: 'Thoại 2' },
    { angle: 'Problem Solving', title: 'Giải nhiệt', content: 'Thoại 3' },
    { angle: 'Comparison', title: 'So sánh', content: 'Thoại 4' },
    { angle: 'Social Proof', title: 'Feedback', content: 'Thoại 5' },
  ]

  const scenes = buildScenePlan({
    scripts: mock5Scripts,
    sceneConfig: { count: 5 },
  })

  assert.equal(scenes.length, 5, 'Phải tạo đúng 5 scenes')
  assert.equal(scenes[0].title, 'Cảnh 1: Áo polo test')
  assert.ok(scenes[0].prompt.includes('Hình ảnh: Cận cảnh bàn tay sờ vải'), 'Prompt cảnh 1 phải có visualDirection')
  assert.equal(scenes[4].title, 'Cảnh 5: Feedback')
  console.log('✅ TEST 5 PASSED: buildScenePlan 5 scripts & visualDirection thành công')
}

// ─── TEST 6: buildScenePlan hỗ trợ fallback snake_case (visual_direction) ───
{
  const mockSnakeCaseScripts: any[] = [
    {
      angle: 'Góc 1',
      title: 'Kịch bản 1',
      content: 'Lời thoại kịch bản 1',
      visual_direction: 'Cận cảnh sản phẩm xoay 360 độ ánh sáng mềm',
      on_screen_text: 'Chỉ 199k hôm nay',
      word_count: 50,
    },
  ]

  const scenes = buildScenePlan({
    scripts: mockSnakeCaseScripts as any,
    sceneConfig: { count: 1 },
  })

  assert.equal(scenes.length, 1)
  assert.ok(
    scenes[0].prompt.includes('Hình ảnh: Cận cảnh sản phẩm xoay 360 độ ánh sáng mềm'),
    'Prompt phải đọc được visual_direction khi trường camelCase visualDirection vắng mặt'
  )
  console.log('✅ TEST 6 PASSED: buildScenePlan đọc trơn tru cả visual_direction (snake_case)')
}

console.log('🎉 TOÀN BỘ WORKFLOW FRONTEND UNIT TESTS ĐÃ HOÀN TẤT VÀ VƯỢT QUA!')
