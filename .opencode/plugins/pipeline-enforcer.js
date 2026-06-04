import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = join(__dirname, "..", "pipeline", "state.json")
const CLOSE_PENDING_PATH = join(__dirname, "..", "pipeline", "close-pending.json")

const SCOPE_REGEX = /^\[([\w.-]+)\]\s*/

const EDIT_TOOLS = new Set(["edit", "write"])

function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, "utf-8"))
    }
  } catch (e) {}
  return {
    global: { pipeline_active: false },
    scopes: {
      main: { active: false, type: null, step: 0, started_at: null, completed_at: null },
    },
  }
}

function saveState(state) {
  const dir = dirname(STATE_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function parseScopeGroups(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return null

  const groups = {}
  const order = []

  for (const todo of todos) {
    const match = todo.content.match(SCOPE_REGEX)
    const name = match ? match[1] : "main"
    if (!groups[name]) {
      groups[name] = { name, todos: [], hasActive: false, allDone: true }
      order.push(name)
    }
    groups[name].todos.push(todo)
    if (todo.status === "in_progress") groups[name].hasActive = true
    if (todo.status !== "completed" && todo.status !== "cancelled") {
      groups[name].allDone = false
    }
  }

  return { groups, order }
}

function detectPipelineType(todos) {
  const content = todos.map((t) => t.content).join(" ")
  if (/feature|spec|generator|architect/i.test(content)) return "feature"
  if (/bugfix|fix|triage|reproducir/i.test(content)) return "bugfix"
  if (/debug|investigar/i.test(content)) return "debug"
  if (/chore|scope|renombrar/i.test(content)) return "chore"
  return "unknown"
}

function detectCurrentStep(scopeTodos) {
  let maxStep = 0
  for (const t of scopeTodos) {
    if (t.status !== "in_progress") continue
    const m = t.content.match(/(\d+)\/\d+/)
    if (m) maxStep = Math.max(maxStep, parseInt(m[1]))
  }
  return maxStep
}

function writeClosePending(scopeName, state) {
  const dir = dirname(CLOSE_PENDING_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const payload = {
    scope: scopeName,
    type: state.scopes[scopeName]?.type || "unknown",
    completed_at: new Date().toISOString(),
  }
  writeFileSync(CLOSE_PENDING_PATH, JSON.stringify(payload, null, 2))
}

export default async () => {
  let previousScopeState = {}

  // Helper: extrae la lógica de update de state (usada por el hook de tracking)
  // Lê todos de múltiples paths defensivamente porque la forma exacta del input
  // de tool.execute.after no está 100% documentada en opencode.
  const updateStateFromTodos = (todos) => {
    if (!Array.isArray(todos) || todos.length === 0) return

    const parsed = parseScopeGroups(todos)
    if (!parsed) return

    const { groups, order } = parsed
    const state = loadState()
    const prevScopes = { ...previousScopeState }

    // Ensure all current scopes exist in state
    for (const name of order) {
      if (!state.scopes[name]) {
        state.scopes[name] = {
          active: false,
          type: null,
          step: 0,
          started_at: null,
          completed_at: null,
        }
      }
    }

    // Detect transitions and update state per scope
    for (const [name, data] of Object.entries(groups)) {
      const wasActive = prevScopes[name]?.hasActive || state.scopes[name]?.active || false
      const nowActive = data.hasActive

      // Transition: was active → now all completed → trigger close
      if (wasActive && !nowActive && data.allDone && !state.scopes[name]?.completed_at) {
        state.scopes[name].type = state.scopes[name]?.type || detectPipelineType(data.todos)
        state.scopes[name].completed_at = new Date().toISOString()
        state.scopes[name].active = false
        state.scopes[name].step = 6
        writeClosePending(name, state)
      } else {
        // Normal update
        state.scopes[name].active = nowActive
        if (nowActive) {
          state.scopes[name].type = state.scopes[name]?.type || detectPipelineType(data.todos)
          state.scopes[name].started_at = state.scopes[name]?.started_at || new Date().toISOString()
          state.scopes[name].completed_at = null
        }
        if (data.allDone && !state.scopes[name]?.completed_at) {
          state.scopes[name].completed_at = new Date().toISOString()
          state.scopes[name].active = false
          state.scopes[name].step = 6
        }
        if (!data.allDone && data.hasActive) {
          state.scopes[name].step = detectCurrentStep(data.todos)
        }
      }
    }

    // Remove stale scopes from state
    for (const name of Object.keys(state.scopes)) {
      if (!groups[name] && name !== "main") {
        delete state.scopes[name]
      }
    }

    // Global active flag: true if ANY scope is active
    state.global.pipeline_active = Object.values(state.scopes).some((s) => s.active)

    // Mark global completed if all scopes done
    const allScopesDone = Object.values(state.scopes).every((s) => s.completed_at)
    if (allScopesDone && Object.keys(state.scopes).length > 0) {
      state.global.pipeline_active = false
    }

    saveState(state)

    // Track current state for next transition detection
    previousScopeState = {}
    for (const [name, data] of Object.entries(groups)) {
      previousScopeState[name] = { hasActive: data.hasActive, allDone: data.allDone }
    }
  }

  return {
    // Hook de tracking de scopes. Reemplaza el antiguo "todo.updated" (que
    // no era un evento válido en opencode). Ahora disparamos desde
    // tool.execute.after del tool `todowrite` con la lista actualizada.
    "tool.execute.after": async (input, output) => {
      if (input?.tool !== "todowrite") return
      // El tool todowrite recibe { todos: [...] } como arg. Leemos de
      // múltiples paths por si la forma exacta varía entre versiones de opencode.
      const todos =
        input?.args?.todos ??
        output?.args?.todos ??
        input?.output?.todos ??
        output?.output?.todos ??
        []
      updateStateFromTodos(todos)
    },

    "tool.execute.before": async (input, output) => {
      if (!EDIT_TOOLS.has(input?.tool)) return

      const state = loadState()
      if (state.global.pipeline_active) return

      throw new Error(
        `Pipeline enforcement: no puedes editar archivos sin iniciar el pipeline primero.

Ejecuta todowrite con el pipeline correspondiente.

Formato multi-scope (varias tareas independientes):

[feature/mi-feature]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad técnica
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Implementación → código
[ ] 5/6 QA (GREEN) → suite completa
[ ] 6/6 Cierre → close checklist

[bugfix/mi-fix]
[▶] 1/5 Triage → confirmar bug
[ ] 2/5 Reproducir → test que falla
[ ] 3/5 Fix → corregir
[ ] 4/5 Verify → tests + typecheck
[ ] 5/5 Cierre → close checklist

O un solo scope (tarea única):

[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect
[ ] 3/6 QA (RED)
[ ] 4/6 Implementación
[ ] 5/6 QA (GREEN)
[ ] 6/6 Cierre
`
      )
    },
  }
}
