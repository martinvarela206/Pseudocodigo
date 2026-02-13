import './style.css'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { lintGutter, linter } from '@codemirror/lint'
import { highlightSelectionMatches } from '@codemirror/search'
import { indentOnInput, indentUnit } from '@codemirror/language'
import mermaid from 'mermaid'
import { analyzePseudocode, lintPseudocode, pseudocodeLanguage } from './pseudocode'

const initialCode = `programa HolaMundo
funcion Hola(nombre)
  escribir "Hola, como estas ",nombre
  volver
fin
inicio
  escribir "Ingrese su nombre"
  leer nombre
  mientras(nombre!="fin")
    Hola(nombre)
    leer nombre
  finmientras
  escribir "Ingrese su edad"
  leer edad
  si edad>=18
    entonces
      escribir "Usted es mayor de edad"
    sino
      escribir "Usted es menor de edad"
  finsi
fin
`

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="shell">
    <header class="app-header">
      <div class="title-block">
        <p class="eyebrow">Editor de pseudocodigo</p>
        <h1>Pseudocodigo a C</h1>
        <p class="subtitle">Escribe a la izquierda, revisa el flujo y la traduccion a la derecha.</p>
      </div>
      <div class="header-meta">
        <span class="chip">Sintaxis + errores</span>
        <span class="chip">Flujo de ejecucion</span>
        <span class="chip">C puro</span>
      </div>
    </header>

    <main class="workspace">
      <section class="pane editor-pane">
        <div class="pane-header">
          <h2>Codigo</h2>
          <span class="pane-hint">Pseudocodigo</span>
        </div>
        <div id="editor" class="editor"></div>
      </section>

      <section class="pane output-pane">
        <div class="tabs">
          <button class="tab active" data-tab="flow">Diagrama de flujo</button>
          <button class="tab" data-tab="c">Traduccion a C</button>
          <button class="tab" data-tab="run">Ejecucion</button>
        </div>
        <div class="tab-panels">
          <div class="panel active" id="panel-flow">
            <div class="flowchart" id="flowchart"></div>
          </div>
          <div class="panel" id="panel-c">
            <pre class="code-block"><code id="c-code"></code></pre>
          </div>
          <div class="panel" id="panel-run">
            <div class="console">
              <div class="console-output" id="console-output"></div>
              <div class="console-input">
                <input id="console-input" type="text" placeholder="Ingresa un valor..." />
                <button id="console-send" type="button">Enviar</button>
              </div>
              <div class="console-actions">
                <button id="console-run" type="button">Ejecutar</button>
                <button id="console-clear" type="button">Limpiar</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
`

const editorParent = document.querySelector<HTMLDivElement>('#editor')
const flowchartEl = document.querySelector<HTMLDivElement>('#flowchart')
const cCodeEl = document.querySelector<HTMLElement>('#c-code')
const consoleOutputEl = document.querySelector<HTMLDivElement>('#console-output')
const consoleInputEl = document.querySelector<HTMLInputElement>('#console-input')
const consoleSendBtn = document.querySelector<HTMLButtonElement>('#console-send')
const consoleRunBtn = document.querySelector<HTMLButtonElement>('#console-run')
const consoleClearBtn = document.querySelector<HTMLButtonElement>('#console-clear')

if (
  !editorParent ||
  !flowchartEl ||
  !cCodeEl ||
  !consoleOutputEl ||
  !consoleInputEl ||
  !consoleSendBtn ||
  !consoleRunBtn ||
  !consoleClearBtn
) {
  throw new Error('No se pudo inicializar la interfaz.')
}

let lastDoc = initialCode
let runnerPromise: Promise<void> | null = null
let waitingResolver: ((value: string) => void) | null = null
let mermaidCounter = 0

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })

const appendConsole = (text: string) => {
  const line = document.createElement('div')
  line.textContent = text
  consoleOutputEl.appendChild(line)
  consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight
}

const clearConsole = () => {
  consoleOutputEl.innerHTML = ''
}

const renderMermaid = async (diagram: string) => {
  const id = `mermaid-${mermaidCounter++}`
  try {
    const { svg } = await mermaid.render(id, diagram)
    flowchartEl.innerHTML = svg
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    flowchartEl.innerHTML = `<pre class="mermaid-error">${message}</pre>`
  }
}

const updateOutputs = (text: string) => {
  lastDoc = text
  const result = analyzePseudocode(text)

  cCodeEl.textContent = result.cCode
  void renderMermaid(result.mermaidCode)
}

const editor = new EditorView({
  parent: editorParent,
  state: EditorState.create({
    doc: initialCode,
    extensions: [
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      history(),
      indentOnInput(),
      indentUnit.of('  '),
      highlightActiveLine(),
      highlightSelectionMatches(),
      lintGutter(),
      linter((view) => lintPseudocode(view.state.doc.toString())),
      pseudocodeLanguage,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          updateOutputs(update.state.doc.toString())
        }
      })
    ]
  })
})

updateOutputs(editor.state.doc.toString())

window.addEventListener('resize', () => updateOutputs(lastDoc))

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'))
const panels = {
  flow: document.querySelector<HTMLDivElement>('#panel-flow'),
  c: document.querySelector<HTMLDivElement>('#panel-c'),
  run: document.querySelector<HTMLDivElement>('#panel-run')
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((btn) => btn.classList.remove('active'))
    tab.classList.add('active')

    Object.entries(panels).forEach(([key, panel]) => {
      if (!panel) return
      if (tab.dataset.tab === key) {
        panel.classList.add('active')
      } else {
        panel.classList.remove('active')
      }
    })
  })
})

const executeProgram = async () => {
  if (runnerPromise) return

  clearConsole()
  appendConsole('> Ejecutando...')
  const source = analyzePseudocode(lastDoc)
  const io = {
    write: (text: string) => appendConsole(text),
    read: (label: string) =>
      new Promise<string>((resolve) => {
        waitingResolver = resolve
        consoleInputEl.placeholder = label ? `Entrada: ${label}` : 'Ingresa un valor...'
        consoleInputEl.focus()
      })
  }

  const runFn = new Function('io', source.jsCode) as (io: { write: (t: string) => void; read: (l: string) => Promise<string> }) => Promise<void>

  runnerPromise = runFn(io)
    .catch((error) => {
      appendConsole(`Error: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      appendConsole('> Fin de la ejecucion')
      runnerPromise = null
      waitingResolver = null
      consoleInputEl.placeholder = 'Ingresa un valor...'
    })
}

const submitInput = () => {
  if (!waitingResolver) return
  const value = consoleInputEl.value
  consoleInputEl.value = ''
  waitingResolver(value)
  waitingResolver = null
}

consoleSendBtn.addEventListener('click', submitInput)
consoleInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    submitInput()
  }
})

consoleRunBtn.addEventListener('click', executeProgram)
consoleClearBtn.addEventListener('click', () => {
  if (runnerPromise) return
  clearConsole()
})
