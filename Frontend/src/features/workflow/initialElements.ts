import type { Node, Edge } from '@xyflow/react'

export const initialNodes: Node[] = [
  // 1. Product Images Node (Top-Left, up to 3 photos)
  {
    id: 'node-products',
    type: 'productAssets',
    position: { x: 40, y: 50 },
    data: {
      title: 'Ảnh Sản Phẩm (Products)',
      productName: '',
      images: [null, null, null],
    },
  },

  // 2. Gemini Vision Analysis Node (Bottom-Left, directly under Products)
  {
    id: 'node-gemini',
    type: 'geminiAnalysis',
    position: { x: 40, y: 360 },
    data: {
      title: 'Gemini 2.5 • Vision Phân Tích',
      model: 'gemini-2.5-flash',
      provider: 'Google Gemini 2.5',
      prompt: '',
      analysisResult: null,
    },
  },


  // 3. Character & Scene Node (Top-Center, Model & Background)
  {
    id: 'node-character-scene',
    type: 'characterScene',
    position: { x: 430, y: 50 },
    data: {
      title: 'Nhân Vật & Bối Cảnh',
      modelImage: null,
      sceneImage: null,
    },
  },

  // 4. ChatGPT Script Generation Node (Bottom-Center, under Character & Scene)
  {
    id: 'node-gpt',
    type: 'gptScript',
    position: { x: 430, y: 360 },
    data: {
      title: 'ChatGPT • Kịch Bản Video',
      model: 'cx/gpt-5.5',
      provider: '9Router Gateway',
      prompt: '',
      requestedCount: 3,
      contentMode: 'sales',
      salesScripts: [],
    },
  },

  // 5. Veo Flow Studio Node (Right Column - Unified "Flow" Block)
  {
    id: 'node-flow-studio',
    type: 'veoFlowStudio',
    position: { x: 840, y: 50 },
    data: {
      title: 'Google Veo 3.0 • Flow Studio',
      model: 'Google Veo 3.0',
      activeSceneIndex: 0,
      aspectRatio: '9:16',
      resolution: '1080p',
      scenes: [
        {
          sceneNumber: 1,
          title: 'Cận cảnh chất liệu & Chi tiết',
          prompt: '',
          durationSec: 4,
          aspectRatio: '9:16',
          cameraMotion: 'Slow Tilt Up',
        },
        {
          sceneNumber: 2,
          title: 'Trải nghiệm thực tế & Góc nhìn',
          prompt: '',
          durationSec: 8,
          aspectRatio: '9:16',
          cameraMotion: 'Tracking Shot',
        },
        {
          sceneNumber: 3,
          title: 'Tạo ấn tượng & Kêu gọi (CTA)',
          prompt: '',
          durationSec: 4,
          aspectRatio: '9:16',
          cameraMotion: 'Slow Push In',
        },
      ],
    },
  },
]

export const initialEdges: Edge[] = [
  // 1. Products to Gemini Vision (Straight Down - "Phân tích")
  {
    id: 'edge-products-gemini',
    source: 'node-products',
    sourceHandle: 'to-gemini',
    target: 'node-gemini',
    targetHandle: 'from-products',
    type: 'removable',
    animated: true,
    style: { stroke: '#2563eb', strokeWidth: 2.5 },
  },

  // 1b. Products to ChatGPT Script (Nạp ảnh sản phẩm trực tiếp vào GPT)
  {
    id: 'edge-products-gpt',
    source: 'node-products',
    sourceHandle: 'to-gpt',
    target: 'node-gpt',
    targetHandle: 'from-products',
    type: 'removable',
    animated: true,
    style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '4 4' },
  },

  // 2. Gemini Vision to ChatGPT Script (Horizontal Right)
  {
    id: 'edge-gemini-gpt',
    source: 'node-gemini',
    sourceHandle: 'to-gpt',
    target: 'node-gpt',
    targetHandle: 'from-gemini',
    type: 'removable',
    animated: true,
    style: { stroke: '#10b981', strokeWidth: 2.5 },
  },



  // 4. Products to Flow Studio (Across Top to Flow)
  {
    id: 'edge-products-flow',
    source: 'node-products',
    sourceHandle: 'to-flow',
    target: 'node-flow-studio',
    targetHandle: 'from-assets',
    type: 'removable',
    animated: false,
    style: { stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '4 4' },
  },

  // 5. Character & Scene to Flow Studio (Across Top to Flow)
  {
    id: 'edge-charscene-flow',
    source: 'node-character-scene',
    sourceHandle: 'to-flow',
    target: 'node-flow-studio',
    targetHandle: 'from-assets',
    type: 'removable',
    animated: false,
    style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '4 4' },
  },

  // 6. ChatGPT Script to Flow Studio (Script Stream)
  {
    id: 'edge-gpt-flow',
    source: 'node-gpt',
    sourceHandle: 'to-flow',
    target: 'node-flow-studio',
    targetHandle: 'from-gpt',
    type: 'removable',
    animated: true,
    style: { stroke: '#ec4899', strokeWidth: 2.5 },
  },
]
