import type { BodyLine, FlowStep } from './types'
import {
  isCallLike,
  parseMientras,
  parseHasta,
  parsePara,
  parseSi,
  sanitizeMermaidLabel
} from './utils'

export const buildFlowSteps = (mainBody: BodyLine[]): FlowStep[] => {
  const flowNodes: FlowStep[] = [{ label: 'Inicio' }]
  const flowStack: { type: 'mientras' | 'para' | 'repetir'; stepIndex: number }[] = []

  const pushFlow = (label: string, loopBackTo?: number) => {
    flowNodes.push({ label, loopBackTo })
  }

  const popFlow = (type: 'mientras' | 'para' | 'repetir') => {
    for (let i = flowStack.length - 1; i >= 0; i -= 1) {
      if (flowStack[i].type === type) {
        return flowStack.splice(i, 1)[0]
      }
    }
    return null
  }

  mainBody.forEach((entry) => {
    const line = entry.text
    const lower = line.toLowerCase()
    if (lower.startsWith('leer ')) {
      const target = line.slice('leer '.length).trim()
      pushFlow(`Leer ${target}`)
      return
    }
    const mientrasMatch = parseMientras(line)
    if (mientrasMatch) {
      pushFlow(`Mientras (${mientrasMatch[1]})`)
      flowStack.push({ type: 'mientras', stepIndex: flowNodes.length - 1 })
      return
    }
    if (lower === 'finmientras') {
      const match = popFlow('mientras')
      pushFlow('Fin mientras', match?.stepIndex)
      return
    }
    const paraMatch = parsePara(line)
    if (paraMatch) {
      pushFlow(`Para ${paraMatch[1]} desde ${paraMatch[2]} hasta ${paraMatch[3]}`)
      flowStack.push({ type: 'para', stepIndex: flowNodes.length - 1 })
      return
    }
    if (lower === 'finpara') {
      const match = popFlow('para')
      pushFlow('Fin para', match?.stepIndex)
      return
    }
    if (lower === 'repetir') {
      pushFlow('Repetir')
      flowStack.push({ type: 'repetir', stepIndex: flowNodes.length - 1 })
      return
    }
    const hastaMatch = parseHasta(line)
    if (hastaMatch) {
      const match = popFlow('repetir')
      pushFlow(`Hasta (${hastaMatch[1]})`, match?.stepIndex)
      return
    }
    const siMatch = parseSi(line)
    if (siMatch) {
      pushFlow(`Si ${siMatch[1]}`)
      return
    }
    if (lower === 'entonces') {
      pushFlow('Entonces')
      return
    }
    if (lower === 'sino') {
      pushFlow('Sino')
      return
    }
    if (lower === 'finsi') {
      pushFlow('Fin si')
      return
    }
    if (lower.startsWith('escribir ')) {
      const text = line.slice('escribir '.length).trim()
      pushFlow(`Escribir ${text}`)
      return
    }
    if (lower === 'volver') {
      pushFlow('Volver')
      return
    }
    if (isCallLike(line)) {
      pushFlow(`Llamar ${line}`)
      return
    }
    pushFlow(line)
  })
  pushFlow('Fin')

  return flowNodes
}

export const buildMermaid = (body: BodyLine[]) => {
  let nodeId = 0
  const nodes: string[] = []
  const edges: string[] = []

  const addNode = (label: string, shape: 'rect' | 'round' | 'diamond' = 'rect') => {
    const id = `N${nodeId++}`
    const safe = sanitizeMermaidLabel(label)
    if (shape === 'diamond') {
      nodes.push(`${id}{"${safe}"}`)
    } else if (shape === 'round') {
      nodes.push(`${id}(["${safe}"])`)
    } else {
      nodes.push(`${id}["${safe}"]`)
    }
    return id
  }

  const connect = (from: string, to: string, label?: string) => {
    if (label) {
      edges.push(`${from} -- ${label} --> ${to}`)
    } else {
      edges.push(`${from} --> ${to}`)
    }
  }

  let current = addNode('Inicio', 'round')

  type SiContext = {
    condId: string
    afterId: string
    inElse: boolean
    entryPending: boolean
    entryLabel: 'si' | 'no'
    thenLast: string
    elseLast: string
    thenHas: boolean
    elseHas: boolean
  }

  type LoopContext =
    | {
        type: 'mientras' | 'para'
        condId: string
        afterId: string
        entryPending: boolean
        entryLabel: 'si'
        entryId?: string
      }
    | {
        type: 'repetir'
        afterId: string
        entryId?: string
      }

  const siStack: SiContext[] = []
  const loopStack: LoopContext[] = []

  const topSi = () => siStack[siStack.length - 1]
  const topLoop = () => loopStack[loopStack.length - 1]

  const connectNode = (node: string) => {
    const loop = topLoop()
    if (loop && loop.type !== 'repetir' && loop.entryPending) {
      connect(loop.condId, node, loop.entryLabel)
      loop.entryPending = false
      loop.entryId = loop.entryId ?? node
      current = node
      return
    }

    const si = topSi()
    if (si && si.entryPending) {
      connect(si.condId, node, si.entryLabel)
      si.entryPending = false
      current = node
      if (si.inElse) {
        si.elseLast = node
        si.elseHas = true
      } else {
        si.thenLast = node
        si.thenHas = true
      }
      return
    }

    connect(current, node)
    current = node

    if (si) {
      if (si.inElse) {
        si.elseLast = node
        si.elseHas = true
      } else {
        si.thenLast = node
        si.thenHas = true
      }
    }

    if (loop && loop.type === 'repetir' && !loop.entryId) {
      loop.entryId = node
    }
  }

  body.forEach((entry) => {
    const line = entry.text
    const lower = line.toLowerCase()

    const mientrasMatch = parseMientras(line)
    if (mientrasMatch) {
      const condId = addNode(`Mientras (${mientrasMatch[1]})`, 'diamond')
      const afterId = addNode('Fin mientras', 'round')
      connectNode(condId)
      loopStack.push({ type: 'mientras', condId, afterId, entryPending: true, entryLabel: 'si' })
      current = condId
      return
    }

    if (lower === 'finmientras') {
      const loop = loopStack.pop()
      if (loop && loop.type === 'mientras') {
        connect(current, loop.condId)
        connect(loop.condId, loop.afterId, 'no')
        current = loop.afterId
      }
      return
    }

    const paraMatch = parsePara(line)
    if (paraMatch) {
      const condId = addNode(`Para ${paraMatch[1]} desde ${paraMatch[2]} hasta ${paraMatch[3]}`, 'diamond')
      const afterId = addNode('Fin para', 'round')
      connectNode(condId)
      loopStack.push({ type: 'para', condId, afterId, entryPending: true, entryLabel: 'si' })
      current = condId
      return
    }

    if (lower === 'finpara') {
      const loop = loopStack.pop()
      if (loop && loop.type === 'para') {
        connect(current, loop.condId)
        connect(loop.condId, loop.afterId, 'no')
        current = loop.afterId
      }
      return
    }

    if (lower === 'repetir') {
      const afterId = addNode('Fin repetir', 'round')
      loopStack.push({ type: 'repetir', afterId })
      return
    }

    const hastaMatch = parseHasta(line)
    if (hastaMatch) {
      const loop = loopStack.pop()
      if (loop && loop.type === 'repetir') {
        const condId = addNode(`Hasta (${hastaMatch[1]})`, 'diamond')
        connect(current, condId)
        const entryId = loop.entryId ?? condId
        connect(condId, entryId, 'no')
        connect(condId, loop.afterId, 'si')
        current = loop.afterId
      }
      return
    }

    const siMatch = parseSi(line)
    if (siMatch) {
      const condId = addNode(`Si ${siMatch[1]}`, 'diamond')
      const afterId = addNode('Fin si', 'round')
      connectNode(condId)
      siStack.push({
        condId,
        afterId,
        inElse: false,
        entryPending: true,
        entryLabel: 'si',
        thenLast: condId,
        elseLast: condId,
        thenHas: false,
        elseHas: false
      })
      current = condId
      return
    }

    if (lower === 'entonces') {
      return
    }

    if (lower === 'sino') {
      const si = topSi()
      if (si) {
        si.inElse = true
        si.entryPending = true
        si.entryLabel = 'no'
        current = si.condId
      }
      return
    }

    if (lower === 'finsi') {
      const si = siStack.pop()
      if (si) {
        if (si.thenHas) {
          connect(si.thenLast, si.afterId)
        } else {
          connect(si.condId, si.afterId, 'si')
        }
        if (si.elseHas) {
          connect(si.elseLast, si.afterId)
        } else {
          connect(si.condId, si.afterId, 'no')
        }
        current = si.afterId
      }
      return
    }

    if (lower.startsWith('leer ')) {
      const target = line.slice('leer '.length).trim()
      const node = addNode(`Leer ${target}`)
      connectNode(node)
      return
    }

    if (lower.startsWith('escribir ')) {
      const text = line.slice('escribir '.length).trim()
      const node = addNode(`Escribir ${text}`)
      connectNode(node)
      return
    }

    if (lower === 'volver') {
      const node = addNode('Volver')
      connectNode(node)
      return
    }

    if (isCallLike(line)) {
      const node = addNode(`Llamar ${line}`)
      connectNode(node)
      return
    }

    const node = addNode(line)
    connectNode(node)
  })

  const endId = addNode('Fin', 'round')
  connect(current, endId)

  return `flowchart TD\n${nodes.join('\n')}\n${edges.join('\n')}`
}
