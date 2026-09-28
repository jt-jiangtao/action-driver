const allowedProperties = new Set(['atomic','autocomplete','busy','checked','controls','describedby','details','disabled','editable','errormessage','expanded','flowto','focusable','focused','hasPopup','invalid','keyshortcuts','labelledby','level','live','modal','multiline','multiselectable','orientation','placeholder','pressed','radiogroup','relevant','required','roledescription','selected','settable','url','valuemax','valuemin','valuetext'])
const text = (value: any): any => value?.value ?? null
const stringAt = (strings: string[], index: number | undefined) => index == null ? '' : strings[index] ?? ''
/** Stable AX revision identity used for page and JavaScript-dialog nodes. */
export function axIdentity(tabId: number, node: any) {
  return [String(tabId), node.targetID ?? '', node.backendDOMNodeID == null ? node.nodeID : String(node.backendDOMNodeID)]
    .map(part => `${new TextEncoder().encode(part).byteLength}:${part}`).join('|')
}
export function axSnapshotMetadata(snapshot: any, backendIds: Set<number>): Map<number, any> {
  const result = new Map<number, any>()
  for (const document of snapshot.documents ?? []) {
    const nodes = document.nodes, ids = nodes.backendNodeId ?? [], names = nodes.nodeName ?? [], attrs = nodes.attributes ?? []
    const bounds = new Map<number, number[]>()
    for (let index = 0; index < (document.layout?.nodeIndex?.length ?? 0); index++) {
      const nodeIndex = document.layout.nodeIndex[index], id = ids[nodeIndex], raw = document.layout.bounds[index]
      if (id == null || !backendIds.has(id) || !raw || raw.length < 4) continue
      bounds.set(nodeIndex, [(raw[0] ?? 0) - (document.scrollOffsetX ?? 0), (raw[1] ?? 0) - (document.scrollOffsetY ?? 0), raw[2] ?? 0, raw[3] ?? 0])
    }
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index]
      if (id == null || !backendIds.has(id)) continue
      const attributes: Record<string, string> = {}, credentialHints: string[] = []
      for (let offset = 0; offset < (attrs[index]?.length ?? 0); offset += 2) {
        const key = stringAt(snapshot.strings, attrs[index][offset]), value = stringAt(snapshot.strings, attrs[index][offset + 1])
        if (['id','class','role','aria-description'].includes(key.toLowerCase())) attributes[key] = value
        if (['type','autocomplete','id','name','placeholder','aria-label','title'].includes(key.toLowerCase())) credentialHints.push(value)
      }
      const tagName = stringAt(snapshot.strings, names[index]).toLowerCase()
      result.set(id, { tagName, attributes, bounds: bounds.get(index),
        credential: tagName === 'input' && /user[-_ ]?name|e[-_ ]?mail|one[-_ ]?time[-_ ]?code|password|passcode|passwd|\botp\b|phone|mobile|\btel\b/i.test(credentialHints.join(' ')) })
    }
  }
  return result
}
function nameSource(name: any) {
  const source = name?.sources?.find((item: any) => !item.superseded && (item.value != null || item.attributeValue != null)) ??
    name?.sources?.find((item: any) => !item.superseded)
  if (!source) return null
  if (['contents', 'placeholder', 'relatedElement'].includes(source.type)) return source.type
  if (source.type === 'attribute') return source.attribute === 'placeholder' ? 'placeholder' : source.attribute === 'value' ? 'value' : 'attribute'
  return null
}
function properties(node: any, backendIndex: Map<number, number>) {
  const result: Record<string, any> = {}
  for (const property of node.properties ?? []) {
    if (!allowedProperties.has(property.name)) continue
    const relatedNodes = (property.value?.relatedNodes ?? []).flatMap((related: any) => {
      const targetIndex = backendIndex.get(related.backendDOMNodeId) ?? -1
      return targetIndex < 0 && related.text == null && related.idref == null ? [] :
        [{ targetIndex, text: related.text ?? null, idref: related.idref ?? null }]
    })
    const value = text(property.value)
    if (value != null || relatedNodes.length) result[property.name] = { value, relatedNodes }
  }
  return result
}
function domMetadata(metadata: any, redact: boolean) {
  if (!metadata) return null
  return { bounds: metadata.bounds ?? null, identifier: (redact ? undefined : metadata.attributes.id) ?? null,
    className: (redact ? undefined : metadata.attributes.class) ?? null,
    declaredRole: (redact ? undefined : metadata.attributes.role) ?? null,
    hasAriaDescription: !redact && Object.hasOwn(metadata.attributes, 'aria-description') ? true : null,
    tagName: !redact && ['input','select','textarea'].includes(metadata.tagName) ? metadata.tagName : null }
}
export function axNodesForDocument(document: any): any[] {
  const byId = new Map<string, any>(document.nodes.map((node: any) => [node.nodeId, node]))
  const visible = document.nodes.filter((node: any) => !node.ignored)
  const parent = new Map<string, string>()
  for (const node of visible) {
    const pending = [...(node.childIds ?? [])], seen = new Set<string>()
    while (pending.length) {
      const id = pending.pop()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const child = byId.get(id)
      if (!child) continue
      if (!child.ignored) parent.set(id, node.nodeId)
      else pending.push(...(child.childIds ?? []))
    }
  }
  const indexById = new Map(visible.map((node: any, index: number) => [node.nodeId, index]))
  const backendIndex = new Map<number, number>(visible.flatMap((node: any, index: number) => node.backendDOMNodeId == null ? [] : [[node.backendDOMNodeId, index]]))
  const credentialNodes = new Set<string>(visible.filter((node: any) => node.backendDOMNodeId != null && document.metadata.get(node.backendDOMNodeId)?.credential).map((node: any) => node.nodeId))
  return visible.map((node: any) => {
    const parentId = parent.get(node.nodeId), metadata = document.metadata.get(node.backendDOMNodeId)
    let hiddenByAncestor = false, ancestor = parentId
    while (ancestor) { if (credentialNodes.has(ancestor)) { hiddenByAncestor = true; break }; ancestor = parent.get(ancestor) }
    const redact = metadata?.credential === true || hiddenByAncestor
    const source = nameSource(node.name), rawValue = text(node.value)
    const name = hiddenByAncestor || (metadata?.credential && (source === 'value' || text(node.name) === rawValue)) ? null : text(node.name)
    const props = properties(node, backendIndex)
    if (redact) delete props.valuetext
    return { parentIndex: parentId == null ? -1 : indexById.get(parentId) ?? -1,
      nodeID: `${document.targetId}:${document.frame.frameId}:${node.nodeId}`,
      role: text(node.role), chromeRole: text(node.chromeRole), name, nameSource: source,
      description: redact ? null : text(node.description),
      value: redact ? metadata?.credential && !hiddenByAncestor && rawValue ? '<redacted>' : null : rawValue,
      properties: props, dom: domMetadata(metadata, redact), backendDOMNodeID: node.backendDOMNodeId ?? null,
      targetID: document.actionTargetId, frameId: document.frame.frameId }
  })
}
export function mergeAxDocuments(documents: any[], warnings: string[]) {
  const nodes: any[] = [], owners = new Map<string, number>()
  for (const document of documents) {
    let parentIndex = -1
    if (document.frame.parentFrameId != null) {
      const parentDocument = documents.find(item => item.frame.frameId === document.frame.parentFrameId)
      parentIndex = document.frame.ownerBackendNodeId == null ? -1 : owners.get(`${parentDocument?.targetId}:${document.frame.ownerBackendNodeId}`) ?? -1
      if (parentIndex < 0) { warnings.push(`Iframe ${document.frame.frameId} owner was not present in the accessibility tree`); continue }
    }
    const offset = nodes.length
    for (const node of axNodesForDocument(document)) {
      const related = Object.fromEntries(Object.entries(node.properties).map(([key, property]: [string, any]) =>
        [key, { ...property, relatedNodes: property.relatedNodes.map((item: any) => ({ ...item, targetIndex: item.targetIndex < 0 ? item.targetIndex : item.targetIndex + offset })) }]))
      nodes.push({ ...node, parentIndex: node.parentIndex < 0 ? parentIndex : node.parentIndex + offset, properties: related })
      if (node.backendDOMNodeID != null) owners.set(`${document.targetId}:${node.backendDOMNodeID}`, nodes.length - 1)
    }
  }
  return nodes
}
