/**
 * Mock Workflow Runner (Dành riêng cho Môi trường Test / Demo / Storybook)
 * Tách biệt hoàn toàn khỏi Production Runner.
 */

import type { Node } from '@xyflow/react'
import type { GeneratedSceneItem } from '../types'

export function runMockWorkflowSimulation(
  nodes: Node[],
  setNodes: (updater: (nds: Node[]) => Node[]) => void,
  onComplete?: () => void
) {
  // Step 1: Nạp ảnh mẫu nếu trống và bắt đầu Gemini
  setNodes((nds) =>
    nds.map((n) => {
      if (n.type === 'productAssets') {
        return {
          ...n,
          data: {
            ...n.data,
            images: [
              'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=400&auto=format&fit=crop&q=80',
              'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=400&auto=format&fit=crop&q=80',
              'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&auto=format&fit=crop&q=80',
            ],
          },
        }
      }
      if (n.type === 'characterScene') {
        return {
          ...n,
          data: {
            ...n.data,
            modelImage:
              'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
            sceneImage:
              'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&auto=format&fit=crop&q=80',
          },
        }
      }
      if (n.type === 'geminiAnalysis') {
        return { ...n, data: { ...n.data, isAnalyzing: true, analysisError: null } }
      }
      return n
    })
  )

  // Step 2: Gemini trả kết quả mẫu, GPT bắt đầu
  setTimeout(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type === 'geminiAnalysis') {
          return {
            ...n,
            data: {
              ...n.data,
              isAnalyzing: false,
              analysisResult: {
                raw_text: 'Áo polo dệt kim pique cotton 100%, co giãn 4 chiều.',
                productFeatures: 'Áo polo dệt kim pique cotton 100%, thoáng khí cao cấp.',
                features: ['Chất vải pique 100% cotton', 'Co giãn 4 chiều', 'Cúc áo laser cao cấp'],
                keySellingPoints: ['Co giãn 4 chiều', 'Chống nhăn cao cấp', 'Thoáng khí mùa hè'],
                suggestedAngles: ['Macro cổ áo & chất vải', 'Tracking shot sải bước', 'Cận mặt tự tin'],
              },
            },
          }
        }
        if (n.type === 'gptScript') {
          return {
            ...n,
            data: {
              ...n.data,
              isGenerating: true,
              scriptError: null,
            },
          }
        }
        return n
      })
    )

    // Step 3: GPT trả 3 kịch bản, nạp vào Veo
    setTimeout(() => {
      const generatedScenes: GeneratedSceneItem[] = [
        {
          sceneNumber: 1,
          title: 'Cận cảnh chất liệu & Logo',
          prompt: 'Macro cinematic close up shot of polo shirt fabric texture, soft natural sunlight, slow tilt up',
          durationSec: 4,
          aspectRatio: '9:16',
          cameraMotion: 'Slow Tilt Up',
        },
        {
          sceneNumber: 2,
          title: 'Người mẫu sải bước tự tin',
          prompt: 'Full body tracking shot of model wearing polo walking gracefully in modern coffee shop',
          durationSec: 8,
          aspectRatio: '9:16',
          cameraMotion: 'Tracking Shot',
        },
        {
          sceneNumber: 3,
          title: 'Tạo dáng chốt & Kêu gọi (CTA)',
          prompt: 'Medium close-up of model looking directly into camera with confident smile, pointing to shop now',
          durationSec: 4,
          aspectRatio: '9:16',
          cameraMotion: 'Slow Push In',
        },
      ]

      setNodes((nds) =>
        nds.map((n) => {
          if (n.type === 'gptScript') {
            return { ...n, data: { ...n.data, isGenerating: false, scenes: generatedScenes } }
          }
          if (n.type === 'veoFlowStudio') {
            return {
              ...n,
              data: {
                ...n.data,
                scenes: generatedScenes,
                activeSceneIndex: 0,
              },
            }
          }
          return n
        })
      )

      onComplete?.()
    }, 1200)
  }, 1200)
}
