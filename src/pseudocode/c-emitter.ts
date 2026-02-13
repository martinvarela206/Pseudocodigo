import type { BodyLine, FunctionBlock } from './types'
import {
  parseArrayAccess,
  parseArreglo,
  parseMientras,
  parseHasta,
  parsePara,
  parseSi,
  translateIndices,
  parseArguments,
  buildPrintf,
  isCallLike
} from './utils'

export const buildCCode = (functions: FunctionBlock[], mainBody: BodyLine[]) => {
  const cLines: string[] = []
  cLines.push('#include <stdio.h>')
  cLines.push('')

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
        const type = arregloMatch[1].toLowerCase()
        const name = arregloMatch[2]
        const size = Number(arregloMatch[3])
        arrays.set(name, size)
        const cType = type === 'entero' ? 'int' : 'char'
        const elemSize = type === 'cadena' ? '[100]' : ''
        pushLine(`${cType} ${name}[${size}]${elemSize};`)
        return
      }
      if (lower.startsWith('leer ')) {
        const target = line.slice('leer '.length).trim()
        const arrayMatch = parseArrayAccess(target)
        if (arrayMatch) {
          const name = arrayMatch[1]
          const index = `(${translateIndices(arrayMatch[2])}) - 1`
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
        pushLine(
          `for (int ${paraMatch[1]} = ${startExpr} - 1; ${paraMatch[1]} < ${endExpr} - 1 + 1; ${paraMatch[1]} += 1) {`
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

  functions.forEach((fn) => {
    const locals = new Set<string>()
    const arrays = new Map<string, number>()
    const body = emitBody(fn.body, locals, arrays)
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
  })

  const mainLocals = new Set<string>()
  const mainArrays = new Map<string, number>()
  const mainBodyLines = emitBody(mainBody, mainLocals, mainArrays)
  cLines.push('int main(void) {')
  mainLocals.forEach((name) => {
    cLines.push(`  char ${name}[100];`)
  })
  mainBodyLines.forEach((line) => cLines.push(line))
  cLines.push('  return 0;')
  cLines.push('}')

  return cLines.join('\n')
}
