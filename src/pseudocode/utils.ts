export const isCallLike = (line: string) => /[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*$/.test(line)

export const parseMientras = (line: string) => /^mientras\s*\((.*)\)\s*$/i.exec(line)

export const parseHasta = (line: string) => /^hasta\s*\((.*)\)\s*$/i.exec(line)

export const parsePara = (line: string) =>
  /^para\s+([A-Za-z_][A-Za-z0-9_]*)\s+desde\s+(.+?)\s+hasta\s+(.+?)\s+hacer\s*$/i.exec(line)

export const parseSi = (line: string) => /^si\s+(.+)$/i.exec(line)

export const parseArreglo = (line: string) =>
  /^(entero|cadena|caracter|booleano)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)\]\s*$/i.exec(line)

export const parseArrayAccess = (text: string) => /^([A-Za-z_][A-Za-z0-9_]*)\s*\[(.+)\]$/.exec(text)

export const translateIndices = (expr: string) =>
  expr.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*\[([^\]]+)\]/g, (_match, name, index) => {
    return `${name}[(${index}) - 1]`
  })

export const isKnownStatement = (line: string) => {
  const lower = line.toLowerCase()
  return (
    lower.startsWith('programa ') ||
    lower.startsWith('funcion ') ||
    lower === 'inicio' ||
    lower === 'fin' ||
    lower.startsWith('entero ') ||
    lower.startsWith('cadena ') ||
    lower.startsWith('caracter ') ||
    lower.startsWith('booleano ') ||
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

export const buildLineIndex = (text: string) => {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

export const lineOffset = (starts: number[], lineIndex: number) =>
  starts[Math.min(lineIndex, starts.length - 1)]

export const parseFunctionHeader = (line: string) => {
  const match = /^funcion\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/i.exec(line)
  if (!match) return null
  const params = match[2]
    .split(',')
    .map((param) => param.trim())
    .filter(Boolean)
  return { name: match[1], params }
}

export const parseArguments = (text: string) => {
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

export const buildPrintf = (args: string[]) => {
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

export const sanitizeMermaidLabel = (label: string) =>
  label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/"/g, '&quot;')
