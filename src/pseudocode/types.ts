import type { Diagnostic } from '@codemirror/lint'

export type BlockType = 'funcion' | 'inicio' | 'mientras' | 'para' | 'repetir' | 'si'

export type FunctionBlock = {
  name: string
  params: string[]
  body: BodyLine[]
  headerLine: number
}

export type BodyLine = {
  text: string
  line: number
}

export type FlowStep = { label: string; loopBackTo?: number }

export type ParseResult = {
  flowSteps: FlowStep[]
  cCode: string
  jsCode: string
  mermaidCode: string
  diagnostics: Diagnostic[]
  variables: string[]
}

export type ParsedProgram = {
  functions: FunctionBlock[]
  mainBody: BodyLine[]
  diagnostics: Diagnostic[]
}
