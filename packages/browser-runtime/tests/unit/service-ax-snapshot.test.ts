import { expect, test } from 'vitest'
import { axSnapshotMetadata, axNodesForDocument, mergeAxDocuments } from '../../src/service-ax-snapshot'
import { originalDocumentation } from '../original-service'

const snapshot = { strings: ['f', 'INPUT', 'type', 'password', 'id', 'secret'], documents: [{
  frameId: 0, scrollOffsetX: 2, scrollOffsetY: 3,
  nodes: { backendNodeId: [11], nodeName: [1], attributes: [[2, 3, 4, 5]] },
  layout: { nodeIndex: [0], bounds: [[12, 23, 40, 20]] }
}] }
const nodes = [{ nodeId: '1', ignored: false, role: { value: 'textbox' }, chromeRole: { value: 'textField' },
  name: { value: 'Password', sources: [{ type: 'attribute', attribute: 'aria-label', value: { value: 'Password' } }] },
  value: { value: 's3cr3t' }, backendDOMNodeId: 11,
  properties: [{ name: 'valuetext', value: { value: 's3cr3t' } }, { name: 'focused', value: { value: true } }], childIds: [] }]

test('password metadata and AX rendering redact content while preserving geometry', async () => {
  const baseline = await originalDocumentation()
  const output: any[] = []
  for (const functions of [
    { metadata: axSnapshotMetadata, nodes: axNodesForDocument },
    { metadata: baseline.baselineAxSnapshotMetadata, nodes: baseline.baselineAxNodes }
  ]) {
    const metadata = functions.metadata(snapshot, new Set([11]))
    const result = functions.nodes({ nodes, metadata, targetId: 'tab:3', actionTargetId: null,
      frame: { frameId: 'f' } })
    output.push({ metadata: metadata.get(11), node: result[0] })
  }
  expect(output[0]).toEqual(output[1])
  expect(output[0].node.value).toBe('<redacted>')
  expect(output[0].node.properties.valuetext).toBeUndefined()
  expect(output[0].metadata.bounds).toEqual([10, 20, 40, 20])
})

test('cross-frame AX merge remaps parent and related indices', async () => {
  const baseline = await originalDocumentation()
  const parent = { targetId: 'top', actionTargetId: null, frame: { frameId: 'f' }, metadata: new Map(),
    nodes: [{ nodeId: '1', ignored: false, role: { value: 'Iframe' }, backendDOMNodeId: 22,
      properties: [], childIds: [] }] }
  const child = { targetId: 'child', actionTargetId: 'child', frame: { frameId: 'c', parentFrameId: 'f', ownerBackendNodeId: 22 },
    metadata: new Map(), nodes: [{ nodeId: '2', ignored: false, role: { value: 'button' }, backendDOMNodeId: 33,
      properties: [], childIds: [] }] }
  const output: any[] = []
  for (const merge of [mergeAxDocuments, baseline.baselineMergeAxDocuments]) {
    const warnings: string[] = []
    output.push({ nodes: merge([parent, child], warnings), warnings })
  }
  expect(output[0]).toEqual(output[1])
  expect(output[0].nodes[1].parentIndex).toBe(0)
})
