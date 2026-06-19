// Shared pipeline core — single source of truth for pipeline enforcement.
//
// Consumed by BOTH runtimes so the pipeline is enforced identically:
//   - opencode:    .opencode/plugins/pipeline-enforcer.js  (imports this module)
//   - Claude Code: .opencode/pipeline/pipeline-cli.mjs      (imports this module,
//                  wired via PreToolUse/PostToolUse hooks in .claude/settings.json)
//
// There must be NO divergence between the two. Any change to enforcement logic
// goes here, once.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn, execSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))

// This module lives in .opencode/pipeline/ — siblings are state/patterns/scripts.
export const PIPELINE_DIR = __dirname
export const STATE_PATH = join(__dirname, "state.json")
export const CLOSE_PENDING_PATH = join(__dirname, "close-pending.json")
export const PATTERNS_PATH = join(__dirname, "hardcode-patterns.json")
export const PRE_SPEC_PATH = join(__dirname, "pre-spec.sh")
export const REPO_ROOT = dirname(dirname(__dirname))

export const SCOPE_REGEX = /^\[([\w.-]+)\]\s*/
export const EDIT_TOOLS = new Set(["edit", "write"])

// ── Hardcode detection ────────────────────────────────────────────────────────
// Patterns defined in .opencode/pipeline/hardcode-patterns.json
// Shared source of truth with scripts/validate-hardcodes.sh

let hardcodePatterns = null
let allowlistFiles = []

export function loadHardcodePatterns() {
  if (hardcodePatterns) return // cached
  try {
    if (existsSync(PATTERNS_PATH)) {
      const data = JSON.parse(readFileSync(PATTERNS_PATH, "utf-8"))
      hardcodePatterns = (data.patterns || []).map((p) => ({
        id: p.id,
        regex: new RegExp(p.regex, "gm"),
        suggestion: p.suggestion,
      }))
      allowlistFiles = data.allowlist?.files || []
    }
  } catch (e) {
    // Silently fail — don't block pipeline on pattern load error
    console.error("[pipeline-core] Could not load hardcode patterns:", e.message)
  }
}

export function isAllowlisted(filePath) {
  if (!allowlistFiles.length) return false
  return allowlistFiles.some((f) => filePath.includes(f))
}

export function scanForHardcodes(content, filePath) {
  if (!hardcodePatterns || hardcodePatterns.length === 0) return []
  if (isAllowlisted(filePath)) return []

  const found = []
  for (const pattern of hardcodePatterns) {
    // Skip files with # hardcode-ok comment
    if (/^\s*#\s*hardcode-ok:/m.test(content)) continue

    pattern.regex.lastIndex = 0
    const match = pattern.regex.exec(content)
    if (match) {
      const lineNum = content.substring(0, match.index).split("\n").length
      found.push({
        patternId: pattern.id,
        line: lineNum,
        suggestion: pattern.suggestion,
      })
    }
  }
  return found
}

export function buildHardcodeErrorMessage(found, filePath) {
  const lines = found
    .map((f) => `  - ${filePath}:${f.line} — ${f.patternId}\n    ${f.suggestion}`)
    .join("\n")

  return `Pipeline enforcement: hardcodeo(s) detectado(s) en ${filePath}.

${lines}

Reglas de portabilidad:
  - Usá rutas relativas o $(git rev-parse --show-toplevel)
  - Usá make infra o detección dinámica de motor de contenedores
  - Usá $COMPOSE exec <servicio>, no nombres de contenedor con prefijo

Si el hardcodeo es legítimo, agregá al archivo:
  # hardcode-ok: <razón>

Archivos en allowlist: ${allowlistFiles.join(", ") || "ninguno"}
`
}

// ── Git state helpers ───────────────────────────────────────────────────────

// Allow edits during merge-conflict resolution.
export function hasUnmergedFiles() {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf8", cwd: REPO_ROOT })
    return status.split("\n").some((line) => line.startsWith("UU "))
  } catch {
    return false
  }
}

// Pre-spec guard: runs pre-spec.sh when a new scope activates.
// Throws if the check fails — blocks pipeline activation.
export function runPreSpecCheck(scopeName) {
  if (!existsSync(PRE_SPEC_PATH)) return // script not present yet — graceful

  try {
    execSync(`bash "${PRE_SPEC_PATH}"`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "")
    throw new Error(
      `Pre-spec check falló al activar el scope '${scopeName}'.\n` +
        `Resuelve los issues antes de iniciar el pipeline:\n\n` +
        out +
        `\nEjecuta: bash .opencode/pipeline/pre-spec.sh para ver el detalle completo.\n`
    )
  }
}

// ── State persistence ────────────────────────────────────────────────────────

export function loadState() {
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

export function saveState(state) {
  const dir = dirname(STATE_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

// ── Scope parsing ────────────────────────────────────────────────────────────

export function parseScopeGroups(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return null

  const groups = {}
  const order = []

  for (const todo of todos) {
    const content = todo.content || ""
    const match = content.match(SCOPE_REGEX)
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

export function detectPipelineType(todos) {
  const content = todos.map((t) => t.content || "").join(" ")
  if (/feature|spec|generator|architect/i.test(content)) return "feature"
  if (/bugfix|fix|triage|reproducir/i.test(content)) return "bugfix"
  if (/debug|investigar/i.test(content)) return "debug"
  if (/chore|scope|renombrar/i.test(content)) return "chore"
  return "unknown"
}

export function detectCurrentStep(scopeTodos) {
  let maxStep = 0
  for (const t of scopeTodos) {
    if (t.status !== "in_progress") continue
    const m = (t.content || "").match(/(\d+)\/\d+/)
    if (m) maxStep = Math.max(maxStep, parseInt(m[1]))
  }
  return maxStep
}

export function writeClosePending(scopeName, state) {
  const dir = dirname(CLOSE_PENDING_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const payload = {
    scope: scopeName,
    type: state.scopes[scopeName]?.type || "unknown",
    completed_at: new Date().toISOString(),
  }
  writeFileSync(CLOSE_PENDING_PATH, JSON.stringify(payload, null, 2))
}

// ── Learnings extraction ─────────────────────────────────────────────────────
// Spawns `npx tsx scripts/extract-learnings.ts` after a scope closes.
// Non-blocking; only logs warnings. Claude Code also has a Stop hook that does
// this, so the CLI sync-todos path passes onClose=undefined to avoid double runs.
export function extractLearningsAfterClose() {
  if (!existsSync(CLOSE_PENDING_PATH)) return

  try {
    const pendingData = JSON.parse(readFileSync(CLOSE_PENDING_PATH, "utf-8"))
    const completedAt = new Date(pendingData.completed_at).getTime()
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    if (completedAt < fiveMinAgo) return // stale — already processed
  } catch (e) {
    return
  }

  const child = spawn("npx", ["tsx", "scripts/extract-learnings.ts"], {
    cwd: REPO_ROOT,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  })

  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })
  child.on("error", (err) => {
    console.warn(`[pipeline-core] Could not spawn extract-learnings.ts: ${err.message}`)
  })
  child.on("close", (code) => {
    if (code !== 0) {
      console.warn(`[pipeline-core] extract-learnings.ts exited with code ${code}:\n${stderr.trim()}`)
    }
  })
}

// ── State update from todos (multi-scope) ────────────────────────────────────
// Pure-ish: takes the previous in-memory scope snapshot, returns the new one.
// Persists state.json as a side effect. `onClose(name)` fires once per scope
// that transitions into "all completed".
export function updateStateFromTodos(todos, { previousScopeState = {}, onClose } = {}) {
  if (!Array.isArray(todos) || todos.length === 0) return previousScopeState

  const parsed = parseScopeGroups(todos)
  if (!parsed) return previousScopeState

  const { groups, order } = parsed
  const state = loadState()
  const prevScopes = { ...previousScopeState }

  // Ensure all current scopes exist in state
  for (const name of order) {
    if (!state.scopes[name]) {
      state.scopes[name] = { active: false, type: null, step: 0, started_at: null, completed_at: null }
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
      if (typeof onClose === "function") onClose(name)
    } else {
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
  const allScopesDone = Object.values(state.scopes).every((s) => s.completed_at)
  if (allScopesDone && Object.keys(state.scopes).length > 0) {
    state.global.pipeline_active = false
  }

  saveState(state)

  // Return the new snapshot for the next transition detection
  const nextSnapshot = {}
  for (const [name, data] of Object.entries(groups)) {
    nextSnapshot[name] = { hasActive: data.hasActive, allDone: data.allDone }
  }
  return nextSnapshot
}

// ── Pre-spec activation check (for todowrite) ────────────────────────────────
// Runs pre-spec.sh for each scope transitioning inactive → active. Throws if any
// check fails. "Was active" is derived from BOTH the in-memory snapshot (opencode
// keeps one across calls) AND the persisted state.json (so the stateless Claude
// CLI detects the transition correctly). Returns the previousScopeState snapshot.
export function checkScopeActivation(todos, previousScopeState = {}) {
  const parsed = parseScopeGroups(todos)
  if (!parsed) return previousScopeState
  const state = loadState()
  for (const [name, data] of Object.entries(parsed.groups)) {
    const wasActive = previousScopeState[name]?.hasActive || state.scopes[name]?.active || false
    if (!wasActive && data.hasActive) {
      runPreSpecCheck(name) // throws on failure
    }
  }
  return previousScopeState
}

// ── Edit guard ───────────────────────────────────────────────────────────────
// The single decision point for "may this edit/write proceed?".
// Returns { ok: true } or { ok: false, kind: "hardcode"|"pipeline", reason }.

export const PIPELINE_BLOCK_MESSAGE = `Pipeline enforcement: no puedes editar archivos sin iniciar el pipeline primero.

Ejecuta todowrite con el pipeline correspondiente.

Formato multi-scope (varias tareas independientes):

[feature.mi-feature]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad técnica
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Implementación → código
[ ] 5/6 QA (GREEN) → suite completa
[ ] 6/6 Cierre → close checklist

[bugfix.mi-fix]
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

export function evaluateEdit({ tool, filePath = "", content = "" }) {
  const t = (tool || "").toLowerCase()
  if (!EDIT_TOOLS.has(t)) return { ok: true }

  // Hardcode detection runs regardless of pipeline state.
  loadHardcodePatterns()
  if (content) {
    const found = scanForHardcodes(content, filePath)
    if (found.length > 0) {
      return { ok: false, kind: "hardcode", reason: buildHardcodeErrorMessage(found, filePath) }
    }
  }

  // Internal plugin files never require an active pipeline.
  if (
    filePath.includes(".opencode/pipeline/state.json") ||
    filePath.includes(".opencode/pipeline/close-pending.json")
  ) {
    return { ok: true }
  }

  const state = loadState()
  if (state.global.pipeline_active) return { ok: true }

  // Allow edits while resolving a merge conflict.
  if (hasUnmergedFiles()) return { ok: true }

  return { ok: false, kind: "pipeline", reason: PIPELINE_BLOCK_MESSAGE }
}
