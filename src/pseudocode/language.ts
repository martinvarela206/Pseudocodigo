import { StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'

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
