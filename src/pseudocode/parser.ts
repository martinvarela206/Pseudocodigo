import type { Diagnostic } from '@codemirror/lint'
import type { BlockType, FunctionBlock, BodyLine, ParsedProgram } from './types'
import {
  buildLineIndex,
  lineOffset,
  isKnownStatement,
  parseFunctionHeader,
  parseMientras,
  parseHasta,
  parsePara,
  parseSi,
  parseArreglo
} from './utils'

export const parsePseudocodeText = (text: string): ParsedProgram => {
  const lines = text.split(/\r?\n/)
  const lineStarts = buildLineIndex(text)
  const diagnostics: Diagnostic[] = []

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

    if (lower.startsWith('arreglo ')) {
      diagnostics.push({
        from: lineOffset(lineStarts, index),
        to: lineOffset(lineStarts, index) + rawLine.length,
        severity: 'error',
        message: 'Sintaxis invalida. Usa: tipo nombre[cantidad]. Ejemplo: entero numeros[5]'
      })
    }

    if (lower.startsWith('programa ')) {
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

  return { functions, mainBody, diagnostics }
}
