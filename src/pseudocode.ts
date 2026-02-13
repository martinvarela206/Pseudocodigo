import { StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'
import type { Diagnostic } from '@codemirror/lint'

const keywords = new Set([
  'programa',
  'funcion',
  'inicio',
  'fin',
  'arreglo',
  'leer',
  'escribir',
  'volver',
  'mientras',
  'finmientras',
  'para',
  'finpara',
  'repetir',
  'hasta',
  'desde',
  'hacer',
  'si',
  'entonces',
  'sino',
  'finsi'
])

type BlockType = 'funcion' | 'inicio' | 'mientras' | 'para' | 'repetir' | 'si'

type FunctionBlock = {
  name: string
  params: string[]
  body: BodyLine[]
  headerLine: number
}

type BodyLine = {
  text: string
  line: number
}

type ParseResult = {
  flowSteps: { label: string; loopBackTo?: number }[]
  cCode: string
  jsCode: string
  mermaidCode: string
  diagnostics: Diagnostic[]
  variables: string[]
}

const pseudocodeParser: StreamParser<unknown> = {
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null

    if (stream.match(/\/\/.*$/) || stream.match(/#.*$/)) {
      return 'comment'
    }

    if (stream.match(/"(?:[^"\\]|\\.)*"/)) {
      return 'string'
    }

    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current().toLowerCase()
      if (keywords.has(word)) return 'keyword'
      return 'variableName'
    }

    stream.next()
    return null
  }
}

export const pseudocodeLanguage = StreamLanguage.define(pseudocodeParser)

const isCallLike = (line: string) => /[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*$/.test(line)

const parseMientras = (line: string) => /^mientras\s*\((.*)\)\s*$/i.exec(line)

const parseHasta = (line: string) => /^hasta\s*\((.*)\)\s*$/i.exec(line)

const parsePara = (line: string) =>
  /^para\s+([A-Za-z_][A-Za-z0-9_]*)\s+desde\s+(.+?)\s+hasta\s+(.+?)\s+hacer\s*$/i.exec(line)

const parseSi = (line: string) => /^si\s+(.+)$/i.exec(line)

const parseArreglo = (line: string) =>
  /^arreglo\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)\]\s*$/i.exec(line)

const parseArrayAccess = (text: string) => /^([A-Za-z_][A-Za-z0-9_]*)\s*\[(.+)\]$/.exec(text)

const translateIndices = (expr: string) =>
  expr.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*\[([^\]]+)\]/g, (_match, name, index) => {
    return `${name}[(${index}) - 1]`
  })
const isKnownStatement = (line: string) => {
  const lower = line.toLowerCase()
  return (
    lower.startsWith('programa ') ||
    lower.startsWith('funcion ') ||
    lower === 'inicio' ||
    lower === 'fin' ||
    lower.startsWith('arreglo ') ||
    lower.startsWith('mientras') ||
    lower === 'finmientras' ||
    lower.startsWith('para ') ||
    lower === 'finpara' ||
    lower === 'repetir' ||
    lower.startsWith('hasta') ||
    lower.startsWith('si ') ||
    lower === 'entonces' ||
    lower === 'sino' ||
    lower === 'finsi' ||
    lower.startsWith('leer ') ||
    lower.startsWith('escribir ') ||
    lower === 'volver' ||
    isCallLike(line)
  )
}

const buildLineIndex = (text: string) => {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

const lineOffset = (starts: number[], lineIndex: number) => starts[Math.min(lineIndex, starts.length - 1)]

const parseFunctionHeader = (line: string) => {
  const match = /^funcion\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/i.exec(line)
  if (!match) return null
  const params = match[2]
    .split(',')
    .map((param) => param.trim())
    .filter(Boolean)
  return { name: match[1], params }
}

const parseArguments = (text: string) => {
  const args: string[] = []
  let current = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      current += char
      continue
    }

    if (char === ',' && !inString) {
      const trimmed = current.trim()
      if (trimmed) args.push(trimmed)
      current = ''
      continue
    }

    current += char
  }

  const last = current.trim()
  if (last) args.push(last)
  return args
}

const buildPrintf = (args: string[]) => {
  const formatParts: string[] = []
  const values: string[] = []

  args.forEach((arg) => {
    if (arg.startsWith('"') && arg.endsWith('"')) {
      formatParts.push(arg.slice(1, -1))
    } else {
      formatParts.push('%s')
      values.push(arg)
    }
  })

  const format = formatParts.join('')
  const valueList = values.length ? `, ${values.join(', ')}` : ''
  return `printf("${format}"${valueList});`
}

const sanitizeMermaidLabel = (label: string) =>
  label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/"/g, '&quot;')

const parsePseudocode = (text: string): ParseResult => {
  const lines = text.split(/\r?\n/)
  const lineStarts = buildLineIndex(text)
  const diagnostics: Diagnostic[] = []

  let programName = 'Programa'
  let inMain = false
  let currentFunction: FunctionBlock | null = null
  const functions: FunctionBlock[] = []
  const mainBody: BodyLine[] = []
  const blockStack: { type: BlockType; line: number }[] = []
  let indentLevel = 0

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) return

    const lower = line.toLowerCase()
    const leading = rawLine.match(/^[\t ]*/)?.[0] ?? ''
    const hasTabs = leading.includes('\t')
    const leadingSpaces = (leading.match(/ /g) || []).length

    const closesBlock =
      lower === 'fin' ||
      lower === 'finmientras' ||
      lower === 'finpara' ||
      parseHasta(line)

    let expectedIndent = indentLevel
    if (lower === 'finsi') {
      expectedIndent = Math.max(0, indentLevel - 2)
    } else if (lower === 'sino') {
      expectedIndent = Math.max(0, indentLevel - 1)
    } else if (closesBlock) {
      expectedIndent = Math.max(0, indentLevel - 1)
    }

    if (hasTabs) {
      diagnostics.push({
        from: lineOffset(lineStarts, index),
        to: lineOffset(lineStarts, index) + leading.length,
        severity: 'error',
        message: 'La indentacion debe usar espacios, no tabulaciones.'
      })
    }

    if (leadingSpaces !== expectedIndent * 2) {
      diagnostics.push({
        from: lineOffset(lineStarts, index),
        to: lineOffset(lineStarts, index) + leading.length,
        severity: 'error',
        message: `Se esperaban ${expectedIndent * 2} espacios.`
      })
    }

    if (!isKnownStatement(line)) {
      diagnostics.push({
        from: lineOffset(lineStarts, index),
        to: lineOffset(lineStarts, index) + rawLine.length,
        severity: 'warning',
        message: 'Linea no reconocida del pseudocodigo.'
      })
    }

    if (lower.startsWith('programa ')) {
      programName = line.slice('programa '.length).trim() || programName
      return
    }

    if (lower.startsWith('funcion ')) {
      indentLevel += 1
      const header = parseFunctionHeader(line)
      if (!header) {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Encabezado de funcion invalido. Usa: funcion Nombre(param)'
        })
        return
      }
      currentFunction = { name: header.name, params: header.params, body: [], headerLine: index + 1 }
      functions.push(currentFunction)
      blockStack.push({ type: 'funcion', line: index })
      return
    }

    if (lower === 'inicio') {
      inMain = true
      blockStack.push({ type: 'inicio', line: index })
      indentLevel += 1
      return
    }

    if (parseMientras(line)) {
      blockStack.push({ type: 'mientras', line: index })
      indentLevel += 1
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (lower === 'finmientras') {
      const last = blockStack.pop()
      if (!last || last.type !== 'mientras') {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Hay un "finmientras" sin "mientras".'
        })
        return
      }
      indentLevel = Math.max(0, indentLevel - 1)
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (parsePara(line)) {
      blockStack.push({ type: 'para', line: index })
      indentLevel += 1
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (lower === 'finpara') {
      const last = blockStack.pop()
      if (!last || last.type !== 'para') {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Hay un "finpara" sin "para".'
        })
        return
      }
      indentLevel = Math.max(0, indentLevel - 1)
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (lower === 'repetir') {
      blockStack.push({ type: 'repetir', line: index })
      indentLevel += 1
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (parseHasta(line)) {
      const last = blockStack.pop()
      if (!last || last.type !== 'repetir') {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Hay un "hasta" sin "repetir".'
        })
        return
      }
      indentLevel = Math.max(0, indentLevel - 1)
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    const siMatch = parseSi(line)
    if (siMatch) {
      blockStack.push({ type: 'si', line: index })
      indentLevel += 1
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    const arregloMatch = parseArreglo(line)
    if (arregloMatch) {
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (lower === 'entonces' || lower === 'sino') {
      const hasSi = blockStack.some((block) => block.type === 'si')
      if (!hasSi) {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: `"${lower}" sin un "si" abierto.`
        })
        return
      }
      if (lower === 'entonces') {
        indentLevel += 1
      } else {
        indentLevel = Math.max(0, indentLevel - 1) + 1
      }
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (lower === 'finsi') {
      const last = blockStack.pop()
      if (!last || last.type !== 'si') {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Hay un "finsi" sin "si".'
        })
        return
      }
      indentLevel = Math.max(0, indentLevel - 2)
      if (currentFunction) {
        currentFunction.body.push({ text: line, line: index + 1 })
        return
      }
      if (inMain) {
        mainBody.push({ text: line, line: index + 1 })
      }
      return
    }

    if (lower === 'fin') {
      const last = blockStack.pop()
      if (!last) {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Hay un "fin" sin bloque abierto.'
        })
        return
      }
      if (last.type !== 'funcion' && last.type !== 'inicio') {
        diagnostics.push({
          from: lineOffset(lineStarts, index),
          to: lineOffset(lineStarts, index) + rawLine.length,
          severity: 'error',
          message: 'Bloque abierto con un cierre incorrecto.'
        })
        return
      }
      indentLevel = Math.max(0, indentLevel - 1)
      if (last.type === 'funcion') {
        currentFunction = null
      }
      if (last.type === 'inicio') {
        inMain = false
      }
      return
    }

    if (currentFunction) {
      currentFunction.body.push({ text: line, line: index + 1 })
      return
    }

    if (inMain) {
      mainBody.push({ text: line, line: index + 1 })
    }
  })

  if (blockStack.length) {
    const endToken = (type: BlockType) => {
      if (type === 'funcion' || type === 'inicio') return 'fin'
      if (type === 'mientras') return 'finmientras'
      if (type === 'para') return 'finpara'
      if (type === 'si') return 'finsi'
      return 'hasta(...)'
    }
    blockStack.forEach((block) => {
      diagnostics.push({
        from: lineOffset(lineStarts, block.line),
        to: lineOffset(lineStarts, block.line) + (lines[block.line] || '').length,
        severity: 'error',
        message: `Falta cerrar el bloque con "${endToken(block.type)}".`
      })
    })
  }

  if (!lines.some((line) => line.trim().toLowerCase() === 'inicio')) {
    diagnostics.push({
      from: 0,
      to: Math.min(text.length, 8),
      severity: 'error',
      message: 'Falta la seccion "inicio".'
    })
  }

  const flowNodes: { label: string; loopBackTo?: number }[] = [{ label: 'Inicio' }]
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

  const buildMermaid = (body: BodyLine[]) => {
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

  const cLines: string[] = []
  cLines.push('#include <stdio.h>')
  cLines.push('')

  const collectScopeVars = (body: BodyLine[], initial: string[] = []) => {
    const vars = new Set(initial)
    body.forEach((entry) => {
      const lower = entry.text.toLowerCase()
      if (lower.startsWith('leer ')) {
        const target = entry.text.slice('leer '.length).trim()
        const arrayMatch = parseArrayAccess(target)
        vars.add(arrayMatch ? arrayMatch[1] : target)
      }
      const arregloMatch = parseArreglo(entry.text)
      if (arregloMatch) vars.add(arregloMatch[1])
      const paraMatch = parsePara(entry.text)
      if (paraMatch) vars.add(paraMatch[1])
    })
    return Array.from(vars)
  }

  const mainScopeVars = collectScopeVars(mainBody)
  const functionScopes = functions.map((fn) => ({
    name: fn.name,
    vars: collectScopeVars(fn.body, fn.params)
  }))

  const variableSlots: { label: string; scope: string; name: string }[] = []
  const pushSlots = (scope: string, vars: string[]) => {
    vars.forEach((name) => {
      variableSlots.push({ label: name, scope, name })
    })
  }

  pushSlots('main', mainScopeVars)
  functionScopes.forEach((scope) => pushSlots(`fn:${scope.name}`, scope.vars))

  const buildTraceArray = (scope: string, mode: 'value' | 'cleared' | 'empty' = 'value') => {
    if (!variableSlots.length) return '[]'
    const entries = variableSlots.map((slot) => {
      if (slot.scope !== scope) return '""'
      if (mode === 'cleared') return `{ __cleared: true, value: ${slot.name} }`
      if (mode === 'empty') return '""'
      return `(typeof ${slot.name} === "undefined" ? "" : ${slot.name})`
    })
    return `[${entries.join(', ')}]`
  }

  const jsLines: string[] = []
  jsLines.push('return (async () => {')
  jsLines.push('  const __write = (text) => io.write(String(text));')
  jsLines.push('  const __readLine = (label) => io.read(label);')
  jsLines.push('  const __trace = (line, vars, output = "") => {')
  jsLines.push('    if (io.trace) io.trace(line, vars, output);')
  jsLines.push('    return true;')
  jsLines.push('  };')

  const emitBody = (body: BodyLine[], locals: Set<string>, arrays: Map<string, number>) => {
    const lines: string[] = []
    let indent = 1
    const pushLine = (text: string, indentOffset = 0) => {
      const level = Math.max(0, indent + indentOffset)
      lines.push(`${'  '.repeat(level)}${text}`)
    }

    body.forEach((entry) => {
      const line = entry.text
      const lower = line.toLowerCase()
      const arregloMatch = parseArreglo(line)
      if (arregloMatch) {
        const name = arregloMatch[1]
        const size = Number(arregloMatch[2])
        arrays.set(name, size)
        pushLine(`char ${name}[${size}][100];`)
        return
      }
      if (lower.startsWith('leer ')) {
        const target = line.slice('leer '.length).trim()
        const arrayMatch = parseArrayAccess(target)
        if (arrayMatch) {
          const name = arrayMatch[1]
          const index = translateIndices(arrayMatch[2])
          pushLine(`scanf("%99s", ${name}[${index}]);`)
          return
        }
        locals.add(target)
        pushLine(`scanf("%99s", ${target});`)
        return
      }
      const mientrasMatch = parseMientras(line)
      if (mientrasMatch) {
        pushLine(`while (${translateIndices(mientrasMatch[1])}) {`)
        indent += 1
        return
      }
      if (lower === 'finmientras') {
        indent = Math.max(1, indent - 1)
        pushLine('}')
        return
      }
      const paraMatch = parsePara(line)
      if (paraMatch) {
        const startExpr = translateIndices(paraMatch[2])
        const endExpr = translateIndices(paraMatch[3])
        pushLine(`for (int ${paraMatch[1]} = ${startExpr}; ${paraMatch[1]} <= ${endExpr}; ${paraMatch[1]} += 1) {`)
        indent += 1
        return
      }
      if (lower === 'finpara') {
        indent = Math.max(1, indent - 1)
        pushLine('}')
        return
      }
      if (lower === 'repetir') {
        pushLine('do {')
        indent += 1
        return
      }
      const hastaMatch = parseHasta(line)
      if (hastaMatch) {
        indent = Math.max(1, indent - 1)
        pushLine(`} while (!(${translateIndices(hastaMatch[1])}));`)
        return
      }
      const siMatch = parseSi(line)
      if (siMatch) {
        pushLine(`if (${translateIndices(siMatch[1])}) {`)
        indent += 1
        return
      }
      if (lower === 'entonces') {
        return
      }
      if (lower === 'sino') {
        indent = Math.max(1, indent - 1)
        pushLine('} else {')
        indent += 1
        return
      }
      if (lower === 'finsi') {
        indent = Math.max(1, indent - 1)
        pushLine('}')
        return
      }
      if (lower.startsWith('escribir ')) {
        const rawArgs = line.slice('escribir '.length).trim()
        const args = parseArguments(rawArgs).map((arg) => {
          if (arg.startsWith('"') && arg.endsWith('"')) return arg
          return translateIndices(arg)
        })
        pushLine(buildPrintf(args))
        return
      }
      if (lower === 'volver') {
        pushLine('return;')
        return
      }
      if (isCallLike(line)) {
        pushLine(`${line};`)
        return
      }
      pushLine(`/* ${line} */`)
    })
    return lines
  }

  const emitJsBody = (
    body: BodyLine[],
    locals: Set<string>,
    traceVars: string,
    clearVars: string | null,
    outputVars: string,
    arrays: Map<string, number>
  ) => {
    const lines: string[] = []
    let indent = 1
    let outIndex = 0
    const pushLine = (text: string, indentOffset = 0) => {
      const level = Math.max(0, indent + indentOffset)
      lines.push(`${'  '.repeat(level)}${text}`)
    }

    body.forEach((entry) => {
      const line = entry.text
      const lineNumber = entry.line
      const lower = line.toLowerCase()
      const arregloMatch = parseArreglo(line)
      if (arregloMatch) {
        const name = arregloMatch[1]
        const size = Number(arregloMatch[2])
        arrays.set(name, size)
        pushLine(`let ${name} = Array(${size}).fill("");`)
        return
      }
      if (lower.startsWith('leer ')) {
        const target = line.slice('leer '.length).trim()
        const arrayMatch = parseArrayAccess(target)
        if (arrayMatch) {
          const name = arrayMatch[1]
          const index = translateIndices(arrayMatch[2])
          pushLine(`${name}[${index}] = await __readLine("${name}");`)
        } else {
          locals.add(target)
          pushLine(`${target} = await __readLine("${target}");`)
        }
        pushLine(`__trace(${lineNumber}, ${traceVars});`)
        return
      }
      const mientrasMatch = parseMientras(line)
      if (mientrasMatch) {
        pushLine(`while (${translateIndices(mientrasMatch[1])}) {`)
        indent += 1
        return
      }
      if (lower === 'finmientras') {
        indent = Math.max(1, indent - 1)
        pushLine('}')
        return
      }
      const paraMatch = parsePara(line)
      if (paraMatch) {
        locals.add(paraMatch[1])
        pushLine(
          `for (let ${paraMatch[1]} = ${translateIndices(paraMatch[2])}; ${paraMatch[1]} <= ${translateIndices(
            paraMatch[3]
          )}; ${paraMatch[1]} += 1) {`
        )
        indent += 1
        return
      }
      if (lower === 'finpara') {
        indent = Math.max(1, indent - 1)
        pushLine('}')
        return
      }
      if (lower === 'repetir') {
        pushLine('do {')
        indent += 1
        return
      }
      const hastaMatch = parseHasta(line)
      if (hastaMatch) {
        indent = Math.max(1, indent - 1)
        pushLine(`} while (!(${translateIndices(hastaMatch[1])}));`)
        return
      }
      const siMatch = parseSi(line)
      if (siMatch) {
        pushLine(`if (${translateIndices(siMatch[1])}) {`)
        indent += 1
        return
      }
      if (lower === 'entonces') {
        return
      }
      if (lower === 'sino') {
        indent = Math.max(1, indent - 1)
        pushLine('} else {')
        indent += 1
        return
      }
      if (lower === 'finsi') {
        indent = Math.max(1, indent - 1)
        pushLine('}')
        return
      }
      if (lower.startsWith('escribir ')) {
        const rawArgs = line.slice('escribir '.length).trim()
        const args = parseArguments(rawArgs)
        const parts = args.map((arg) => {
          if (arg.startsWith('"') && arg.endsWith('"')) return arg
          return `String(${translateIndices(arg)})`
        })
        const outVar = `__out${outIndex++}`
        const outExpr = parts.length ? parts.join(' + ') : '""'
        pushLine(`const ${outVar} = ${outExpr};`)
        pushLine(`__write(${outVar});`)
        pushLine(`__trace(${lineNumber}, ${outputVars}, ${outVar});`)
        return
      }
      if (lower === 'volver') {
        if (clearVars) {
          pushLine(`__trace(${lineNumber}, ${clearVars});`)
        }
        pushLine('return;')
        return
      }
      if (isCallLike(line)) {
        pushLine(`await ${line};`)
        return
      }
      pushLine(`// ${line}`)
    })
    return lines
  }

  functions.forEach((fn) => {
    const locals = new Set<string>()
    const arrays = new Map<string, number>()
    const body = emitBody(fn.body, locals, arrays)
    const traceVars = buildTraceArray(`fn:${fn.name}`)
    const clearVars = buildTraceArray(`fn:${fn.name}`, 'cleared')
    const outputVars = buildTraceArray(`fn:${fn.name}`, 'empty')
    const jsBody = emitJsBody(fn.body, locals, traceVars, clearVars, outputVars, arrays)
    const params = fn.params.map((param) => `const char* ${param}`).join(', ')
    cLines.push(`void ${fn.name}(${params}) {`)
    locals.forEach((name) => {
      if (!fn.params.includes(name)) {
        cLines.push(`  char ${name}[100];`)
      }
    })
    body.forEach((line) => cLines.push(line))
    cLines.push('}')
    cLines.push('')

    jsLines.push(`  async function ${fn.name}(${fn.params.join(', ')}) {`)
    locals.forEach((name) => {
      if (!fn.params.includes(name)) {
        jsLines.push(`    let ${name};`)
      }
    })
    jsLines.push(`    __trace(${fn.headerLine}, ${traceVars});`)
    jsBody.forEach((line) => jsLines.push(`  ${line}`))
    jsLines.push('  }')
  })

  const mainLocals = new Set<string>()
  const mainArrays = new Map<string, number>()
  const mainBodyLines = emitBody(mainBody, mainLocals, mainArrays)
  const mainTraceVars = buildTraceArray('main')
  const mainOutputVars = buildTraceArray('main', 'empty')
  const mainJsBodyLines = emitJsBody(mainBody, mainLocals, mainTraceVars, null, mainOutputVars, mainArrays)
  cLines.push('int main(void) {')
  mainLocals.forEach((name) => {
    cLines.push(`  char ${name}[100];`)
  })
  mainBodyLines.forEach((line) => cLines.push(line))
  cLines.push('  return 0;')
  cLines.push('}')

  jsLines.push('  async function __main() {')
  mainLocals.forEach((name) => {
    jsLines.push(`    let ${name};`)
  })
  mainJsBodyLines.forEach((line) => jsLines.push(`  ${line}`))
  jsLines.push('  }')
  jsLines.push('  await __main();')
  jsLines.push('})();')

  return {
    flowSteps: flowNodes,
    cCode: cLines.join('\n'),
    jsCode: jsLines.join('\n'),
    mermaidCode: buildMermaid(mainBody),
    diagnostics,
    variables: variableSlots.map((slot) => slot.label)
  }
}

export const analyzePseudocode = (text: string) => parsePseudocode(text)

export const lintPseudocode = (text: string): Diagnostic[] => parsePseudocode(text).diagnostics
