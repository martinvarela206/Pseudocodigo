import type { Diagnostic } from '@codemirror/lint'
import type { ParseResult } from './types'
import { parsePseudocodeText } from './parser'
import { buildFlowSteps, buildMermaid } from './diagram'
import { buildCCode } from './c-emitter'
import { buildJsCode } from './execution'
import { buildScopeVars, getTraceVariables } from './trace'

export { pseudocodeLanguage } from './language'

export const analyzePseudocode = (text: string): ParseResult => {
  const parsed = parsePseudocodeText(text)
  const scopeVars = buildScopeVars(parsed.functions, parsed.mainBody)

  return {
    flowSteps: buildFlowSteps(parsed.mainBody),
    cCode: buildCCode(parsed.functions, parsed.mainBody),
    jsCode: buildJsCode(parsed.functions, parsed.mainBody, scopeVars),
    mermaidCode: buildMermaid(parsed.mainBody),
    diagnostics: parsed.diagnostics,
    variables: getTraceVariables(scopeVars)
  }
}

export const lintPseudocode = (text: string): Diagnostic[] =>
  parsePseudocodeText(text).diagnostics
