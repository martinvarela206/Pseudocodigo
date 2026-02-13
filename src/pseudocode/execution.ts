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
  isCallLike
} from './utils'
import { buildTraceArrayFor, buildTraceArray, type ScopeVars } from './trace'

export const buildJsCode = (functions: FunctionBlock[], mainBody: BodyLine[], scopeVars: ScopeVars) => {
  const jsLines: string[] = []
  jsLines.push('return (async () => {')
  jsLines.push('  const __write = (text) => io.write(String(text));')
  jsLines.push('  const __readLine = (label) => io.read(label);')
  jsLines.push('  const __trace = (line, vars, output = "") => {')
  jsLines.push('    if (io.trace) io.trace(line, vars, output);')
  jsLines.push('    return true;')
  jsLines.push('  };')

  const emitJsBody = (
    body: BodyLine[],
    locals: Set<string>,
    clearVars: string | null,
    outputVars: string,
    scopeKey: string,
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
        const type = arregloMatch[1].toLowerCase()
        const name = arregloMatch[2]
        const size = Number(arregloMatch[3])
        arrays.set(name, size)
        const fillValue = type === 'cadena' ? '""' : type === 'booleano' ? 'false' : '0'
        pushLine(`let ${name} = Array(${size}).fill(${fillValue});`)
        pushLine(`__trace(${lineNumber}, ${buildTraceArrayFor(scopeVars, scopeKey, [name])});`)
        return
      }
      if (lower.startsWith('leer ')) {
        const target = line.slice('leer '.length).trim()
        const arrayMatch = parseArrayAccess(target)
        if (arrayMatch) {
          const name = arrayMatch[1]
          const index = `(${translateIndices(arrayMatch[2])}) - 1`
          pushLine(`${name}[${index}] = await __readLine("${name}");`)
          pushLine(`__trace(${lineNumber}, ${buildTraceArrayFor(scopeVars, scopeKey, [name])});`)
        } else {
          locals.add(target)
          pushLine(`${target} = await __readLine("${target}");`)
          pushLine(`__trace(${lineNumber}, ${buildTraceArrayFor(scopeVars, scopeKey, [target])});`)
        }
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
        const startExpr = translateIndices(paraMatch[2])
        const endExpr = translateIndices(paraMatch[3])
        pushLine(
          `for (let ${paraMatch[1]} = ${startExpr}; ${startExpr} <= ${endExpr} ? ${paraMatch[1]} <= ${endExpr} : ${paraMatch[1]} >= ${endExpr}; ${paraMatch[1]} += ${startExpr} <= ${endExpr} ? 1 : -1) {`
        )
        indent += 1
        pushLine(
          `__trace(${lineNumber}, ${buildTraceArrayFor(scopeVars, scopeKey, [paraMatch[1]], 'force')});`
        )
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
    const traceVars = buildTraceArray(scopeVars, `fn:${fn.name}`)
    const clearVars = buildTraceArray(scopeVars, `fn:${fn.name}`, 'cleared')
    const outputVars = buildTraceArray(scopeVars, `fn:${fn.name}`, 'empty')
    const jsBody = emitJsBody(fn.body, locals, clearVars, outputVars, `fn:${fn.name}`, arrays)
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
  const mainOutputVars = buildTraceArray(scopeVars, 'main', 'empty')
  const mainJsBodyLines = emitJsBody(mainBody, mainLocals, null, mainOutputVars, 'main', mainArrays)
  jsLines.push('  async function __main() {')
  mainLocals.forEach((name) => {
    jsLines.push(`    let ${name};`)
  })
  mainJsBodyLines.forEach((line) => jsLines.push(`  ${line}`))
  jsLines.push('  }')
  jsLines.push('  await __main();')
  jsLines.push('})();')

  return jsLines.join('\n')
}
