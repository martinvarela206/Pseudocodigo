import type { BodyLine, FunctionBlock } from './types'
import { parseArrayAccess, parseArreglo, parsePara } from './utils'

export type TraceMode = 'value' | 'cleared' | 'empty' | 'force'

export type ScopeVars = {
  main: string[]
  functions: { name: string; vars: string[] }[]
  scopeVarMap: Map<string, string[]>
  variableSlots: { label: string; scope: string; name: string }[]
}

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
    if (arregloMatch) vars.add(arregloMatch[2])
    const paraMatch = parsePara(entry.text)
    if (paraMatch) vars.add(paraMatch[1])
  })
  return Array.from(vars)
}

export const buildScopeVars = (functions: FunctionBlock[], mainBody: BodyLine[]): ScopeVars => {
  const main = collectScopeVars(mainBody)
  const fnScopes = functions.map((fn) => ({
    name: fn.name,
    vars: collectScopeVars(fn.body, fn.params)
  }))

  const variableSlots: { label: string; scope: string; name: string }[] = []
  const pushSlots = (scope: string, vars: string[]) => {
    vars.forEach((name) => {
      variableSlots.push({ label: name, scope, name })
    })
  }

  pushSlots('main', main)
  fnScopes.forEach((scope) => pushSlots(`fn:${scope.name}`, scope.vars))

  const scopeVarMap = new Map<string, string[]>()
  scopeVarMap.set('main', main)
  fnScopes.forEach((scope) => scopeVarMap.set(`fn:${scope.name}`, scope.vars))

  return { main, functions: fnScopes, scopeVarMap, variableSlots }
}

export const buildTraceArrayFor = (
  scopeVars: ScopeVars,
  scope: string,
  names: string[],
  mode: TraceMode = 'value'
) => {
  if (!scopeVars.variableSlots.length) return '[]'
  const nameSet = new Set(names)
  const entries = scopeVars.variableSlots.map((slot) => {
    if (slot.scope !== scope || !nameSet.has(slot.name)) return '""'
    if (mode === 'cleared') return `{ __cleared: true, value: ${slot.name} }`
    if (mode === 'empty') return '""'
    if (mode === 'force') return `{ __force: true, value: ${slot.name} }`
    return `(typeof ${slot.name} === "undefined" ? "" : ${slot.name})`
  })
  return `[${entries.join(', ')}]`
}

export const buildTraceArray = (scopeVars: ScopeVars, scope: string, mode: TraceMode = 'value') => {
  return buildTraceArrayFor(scopeVars, scope, scopeVars.scopeVarMap.get(scope) ?? [], mode)
}

export const getTraceVariables = (scopeVars: ScopeVars) =>
  scopeVars.variableSlots.map((slot) => slot.label)
