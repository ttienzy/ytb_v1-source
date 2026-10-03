import assert from 'node:assert/strict'
import test from 'node:test'
import type { Node } from '@xyflow/react'
import { stopWorkflowRender } from '../services/workflowRenderState.ts'

test('render failure releases scene and legacy node spinners while preserving clip 1 and job 2', () => {
 const first={sceneNumber:1,outputFilePath:'clip1.mp4',isRendering:false}
 const node={id:'flow',data:{isRendering:true,scenes:[first,{sceneNumber:2,jobId:'pending-job',isRendering:true,renderProgress:15,renderStep:'Submitting'}]}} as unknown as Node
 const result=stopWorkflowRender(node,'Flow prompt changed before submit.')
 assert.equal(result.data.isRendering,false)
 assert.equal(result.data.renderError,'Flow prompt changed before submit.')
 const scenes=result.data.scenes as any[]
 assert.equal(scenes[0],first)
 assert.equal(scenes[1].isRendering,false)
 assert.equal(scenes[1].renderProgress,0)
 assert.equal(scenes[1].jobId,'pending-job')
 assert.equal(scenes[1].renderStep,null)
 assert.equal(node.data.isRendering,true)
})

test('preflight failure is visible even before a scene starts rendering', () => {
 const result=stopWorkflowRender({id:'flow',data:{scenes:[]}} as unknown as Node,'Missing project')
 assert.equal(result.data.renderError,'Missing project')
 assert.equal(result.data.isRendering,false)
})
