# Spec: SonarQube Quality Gate for Backend Services

**Fecha:** 2026-06-10  
**Stack inferido:** NestJS + TypeScript (monorepo pnpm), Jest, GitHub Actions, Docker/Podman  
**Estado:** Draft  
**Revisión:** 2 (architect review)  
**Arquitecto:** fabianmunoz

<history>
  <entry revision="1" date="2026-06-10" author="spec-generator">
    Initial spec with 5 USTs: SonarQube container (US-01), project config (US-02), 
    Quality Gate (US-03), CI integration (US-04), local command (US-05).
    Includes REASONS Canvas, Gherkin scenarios, and TDD test plan.
  </entry>
  <entry revision="2" date="2026-06-10" author="architect">
    Architect review. Key findings:
    - ✅ arm64 confirmed for sonarqube:26.6.0.123539-community (Docker Hub verified)
    - ⚠️ SSE port corrected: 3002 (not 3003)
    - ⚠️ Jest configs are in package.json (not jest.config.ts) — paths updated
    - ⚠️ authorization-service coverageDirectory standardized from ../coverage → coverage
    - ⚠️ sonarsource/sonar-scanner-cli Docker image is amd64-only; use npx sonar-scanner for local
    - ⚠️ sonar.exclusions vs sonar.cpd.exclusions distinction documented
    - Added exact Docker image tags per A6 learnings rule
    - Added implementation order & paths section
    - Added dependencies table (pre-existing in spec, verified)
    - Multi-scope decomposition validated: 3 parallel USTs in capa 1, 2 in capa 2
  </entry>
  <entry revision="3" date="2026-06-10" author="backend (feature-sonar-infra)">
    US-01 completed: SonarQube service added to docker-compose.yml (port 9000, health check,
    sonarqube_data volume). `make sonar` target added to Makefile with health check wait loop.
    All 9 tests pass in QA GREEN phase.
  </entry>
</history>

---

<result>
  <completed-at>2026-06-10T18:00:00-03:00</completed-at>
  <implemented>
    <item scope="feature-sonar-infra">US-01: SonarQube container infrastructure</item>
  </implemented>
  <deviations>
    <item>Image tag changed from spec's original `25.x-community` to `26.6.0.123539-community` per architect review (arm64 confirmed)</item>
  </deviations>
  <tests>
    <item>scripts/test-sonarqube-infra.sh: 9/9 GREEN phase tests passing</item>
  </tests>
</result>

---

## Contexto

The open-supervisor project has ~166 unit/integration tests across three backend services (authorization-service, sse-server, bff), mutation testing with Stryker, and Detox E2E for mobile. However, there is **no static code analysis tool** enforcing quality standards across the codebase. Code duplication, cyclomatic complexity, security vulnerabilities, and coverage gaps are invisible to the development workflow — they can only be detected via manual review.

This spec integrates SonarQube Community Edition as a self-hosted quality gate for all three backend NestJS services. The quality gate enforces coverage thresholds (≥80% per service), duplication limits (≤5%), cyclomatic complexity standards, zero critical/high security vulnerabilities, zero blocker/critical bugs, and no new major code smells. The analysis executes in CI on every PR toward `main` and prevents merges when the quality gate fails.

The mobile app (React Native) is **out of scope** — only backend services are analyzed.

**Ambigüedades identificadas:**
- SonarQube Community Edition does not support branch/PR decoration out of the box (that requires Developer Edition). The CI workflow will use SonarScanner CLI and report status via GitHub Checks, but PR annotation in the diff view won't be available.
- The `sonar-project.properties` for each service must reference the correct `sonar.sources` (TypeScript source, not compiled `dist/`) and `sonar.tests` paths given the monorepo structure.
- Coverage collection requires adding `--collectCoverage` and `--coverageReporters lcov` to Jest configs. Currently only `authorization-service` has a `coverageDirectory` defined; the others need it added.

---

## REASONS Canvas

```xml
<REASONS>
  <Rationale>
    The project has 22+ closed specs and a growing codebase with no automated quality
    enforcement. A PR could introduce security vulnerabilities (e.g., hardcoded secrets,
    unsanitized inputs), duplicated code across services, or zero-coverage modules without
    any automated signal. SonarQube fills this gap by running static analysis on every PR
    and blocking merges when quality degrades. The 80% coverage target per service ensures
    the TDD discipline scales with the team.
  </Rationale>
  <Explanation>
    SonarQube Community Edition is run as a Docker/Podman container (port 9000) with a
    custom Quality Gate defining the thresholds. Each backend service gets a
    sonar-project.properties file pointing to its source and test directories. Jest is
    configured to collect coverage in lcov format. The CI workflow (GitHub Actions) spins
    up an ephemeral SonarQube service container, runs the scanner for all three services,
    and reports the Quality Gate status as a GitHub Check. Branch protection on `main`
    requires that check to pass before merging.

    For local development, `make sonar` starts the container and `pnpm sonar` runs the
    scanner. SonarWay TypeScript profile is used as the baseline, with NestJS-specific
    rules enabled where available.
  </Explanation>
  <Assumptions>
    - SonarQube Community Edition 25.x (LTS) is compatible with arm64 (Apple Silicon) for
      local development via Docker/Podman.
    - The `sonar.javascript.lcov.reportPaths` property correctly resolves relative to each
      service's sonar-project.properties location.
    - GitHub Actions free tier limits (20 concurrent jobs, 2,000 min/month for private
      repos) are sufficient for the additional CI job. The ephemeral SonarQube container
      startup (~60s) fits within the job timeout.
    - Test files are excluded from duplication and code smell analysis via
      `sonar.exclusions` in each sonar-project.properties, but included in coverage
      measurement (Jest collects coverage on tested files, not test files themselves).
    - The project already has `coverageDirectory` in authorization-service's jest config;
      the same pattern is extended to bff and sse-server.
  </Assumptions>
  <Scrutiny>
    - Why SonarQube instead of SonarCloud? Self-hosted avoids dependency on a SaaS service
      that may change pricing or limits. The local container also enables analysis without
      internet connectivity during development.
    - Why Community Edition (not Developer)? It's free, covers all required analysis types
      (coverage, duplication, complexity, security, bugs, code smells), and the only
      missing feature (PR decoration) is nice-to-have, not essential.
    - Is 80% per-service coverage realistic from day one? Current coverage is unmeasured
      but likely below 80% for some services. The quality gate will initially fail until
      coverage is improved — this is intentional: it forces the team to write tests.
    - Does the CI ephemeral container approach work reliably? SonarQube's embedded H2
      database (default in Community Edition) is ephemeral — data is lost after the
      container stops. This is acceptable for PR analysis since each run is independent.
  </Scrutiny>
  <Objections>
    - "SonarQube is heavy (~1.5 GB image, 2-4 GB RAM)." — It only runs during CI (ephemeral)
      or when the developer explicitly invokes `make sonar`. It does not run in `make dev`.
    - "80% coverage is too aggressive for a young project." — The target is a goal, not a
      retroactive requirement. The quality gate applies to new code; the team can improve
      legacy coverage incrementally.
    - "Why not use ESLint + custom rules instead?" — ESLint covers style and basic patterns
      but doesn't measure duplication, complexity metrics, security hotspots (OWASP Top 10),
      or coverage. SonarQube complements ESLint; it doesn't replace it.
  </Objections>
  <Novelty>
    - First static code analysis and quality gate in the project.
    - Introduces `sonar-project.properties` configuration files per service.
    - Introduces coverage collection (`lcov`) in Jest for all three backend services.
    - First GitHub Actions workflow using an ephemeral service container.
    - First GitHub branch protection rule requiring a status check.
  </Novelty>
  <Substitutes>
    - CodeClimate: SaaS-only, paid for private repos, less TypeScript-specific than SonarQube.
    - Codacy: SaaS, good TypeScript support but less mature security analysis than SonarQube.
    - DeepSource: Strong for Python/Go, TypeScript support is newer and less battle-tested.
    - Manual code review checklist: doesn't scale, doesn't measure coverage or duplication.
    - ESLint + custom rules + Istanbul: covers linting and coverage but not duplication,
      complexity, or security hotspots in a unified dashboard.
  </Substitutes>
</REASONS>
```

---

## Historias de Usuario

### US-01: SonarQube container infrastructure `[Must]`

> Como **desarrollador**, quiero **levantar una instancia local de SonarQube Community Edition con `make sonar`**, para que **pueda ejecutar análisis de calidad sin depender de servicios externos**.

**Criterios de aceptación:**
- [x] SonarQube service defined in `docker-compose.yml` using `sonarqube:26.6.0.123539-community` image
- [x] Container exposes port `9000` (SonarQube web UI) and `9092` is not used for SonarQube (Kafka already uses 9092 — no port conflict)
- [x] Health check verifies SonarQube API responds at `http://localhost:9000/api/system/status` with status `UP`
- [x] `make sonar` target added to `Makefile`: starts only the SonarQube container + health check wait
- [x] `make sonar` prints the SonarQube URL (`http://localhost:9000`) and default credentials (`admin/admin`) on successful startup
- [x] `make down` stops the SonarQube container alongside other services (via `$(COMPOSE) down`)
- [x] Container uses a named volume `sonarqube_data` to persist quality profiles and project configurations across restarts

**Notas:** The `COMPOSE` variable auto-detection (podman-compose → podman compose → docker compose) already exists in the Makefile; no changes needed for Podman compatibility. The default `admin` password must be changed on first login (SonarQube enforces this). The volume is essential: without it, the Quality Gate and Quality Profile configured in US-03 would be lost on every restart.

---

### US-02: Project configuration — sonar-project.properties + Jest coverage `[Must]`

> Como **desarrollador**, quiero **tener un archivo `sonar-project.properties` y cobertura lcov configurada en Jest por cada servicio backend**, para que **SonarQube pueda analizar correctamente el código fuente, tests, y coverage de cada servicio por separado**.

**Criterios de aceptación:**
- [ ] `apps/authorization-service/sonar-project.properties` created with:
  - `sonar.projectKey=open-supervisor-authorization-service`
  - `sonar.sources=src` (relative to project base)
  - `sonar.tests=src` (test files are co-located with source via `*.spec.ts`)
  - `sonar.test.inclusions=**/*.spec.ts`
  - `sonar.exclusions=**/*.spec.ts` (exclude test files from duplication and code smell analysis)
  - `sonar.javascript.lcov.reportPaths=coverage/lcov.info`
  - `sonar.typescript.tsconfigPath=tsconfig.json`
- [ ] `apps/bff/sonar-project.properties` created with same pattern (projectKey: `open-supervisor-bff`)
- [ ] `apps/sse-server/sonar-project.properties` created with same pattern (projectKey: `open-supervisor-sse-server`)
- [ ] All three services' Jest configs include `collectCoverage: true` (enabled via CLI flag in test scripts, not hardcoded) and `coverageReporters: ["lcov", "text"]`
- [ ] `coverageDirectory` set to `coverage` (relative to service root) in bff and sse-server jest configs (authorization-service already has it at `../coverage` — standardize to `coverage`)
- [ ] Running `pnpm --filter <service> test -- --collectCoverage` produces `coverage/lcov.info` in the service directory
- [ ] Test files are excluded from duplication and code smell analysis but included in coverage measurement (this is the default behavior — test files aren't measured for coverage; only source files are)

**Notas:** authorization-service currently has `coverageDirectory: "../coverage"` — this should be standardized to `"coverage"` for consistency. The `sonar.sources` must NOT include `dist/` or `node_modules/`. Test files must be excluded from duplication analysis because they naturally contain repetitive patterns (test fixtures, mock setups) that would inflate duplication metrics.

---

### US-03: Quality Gate and Quality Profile definition `[Must]`

> Como **tech lead**, quiero **definir un Quality Gate con thresholds específicos y un Quality Profile basado en SonarWay TypeScript**, para que **el análisis de código refleje los estándares de calidad del proyecto y bloquee código que no los cumpla**.

**Criterios de aceptación:**
- [ ] Quality Gate named `open-supervisor-gate` defined with the following conditions:
  - **Coverage**: Coverage on New Code < 80% → ERROR (blocks merge)
  - **Duplications**: Duplicated Lines (%) on New Code > 5% → ERROR
  - **Complexity**: No condition set on complexity (SonarQube Community Edition does not support custom complexity thresholds per function/class — use default SonarWay rules via Quality Profile instead)
  - **Security**: Security Hotspots Reviewed = 100% (no unreviewed hotspots) → ERROR
  - **Bugs**: Blocker Bugs > 0 → ERROR; Critical Bugs > 0 → ERROR
  - **Code Smells**: New Major Code Smells > 0 → ERROR; New Critical Code Smells > 0 → ERROR
- [ ] Quality Profile `open-supervisor-ts` created by copying the built-in `SonarWay Recommended` TypeScript profile as baseline
- [ ] NestJS-specific rules enabled if available in SonarQube's TypeScript plugin (e.g., `@nestjs` decorator rules, dependency injection patterns)
- [ ] Quality Gate configuration documented in a script or JSON file at `scripts/sonarqube/quality-gate.json` that can be applied via SonarQube Web API
- [ ] Default Quality Gate `SonarWay` is NOT modified — all custom thresholds are in `open-supervisor-gate` only

**Notas:** Cyclomatic complexity thresholds (max 10 per function, max 30 per class) are enforced via Quality Profile rules, not the Quality Gate. The SonarWay TypeScript profile already includes cognitive complexity rules. Separating complexity from the gate avoids false positives during the initial adoption phase. The `scripts/sonarqube/quality-gate.json` file allows reproducible setup: a developer can apply the gate to a fresh SonarQube instance without manual UI clicks.

---

### US-04: CI integration — GitHub Actions with ephemeral SonarQube `[Must]`

> Como **desarrollador**, quiero **que cada PR hacia `main` ejecute análisis SonarQube automáticamente y bloquee el merge si el Quality Gate falla**, para que **el código que entra a producción cumpla los estándares de calidad sin depender de revisión manual**.

**Criterios de aceptación:**
- [ ] New GitHub Actions workflow file `.github/workflows/sonarqube.yml` created
- [ ] Workflow triggers on `pull_request` targeting `main` branch (not `dev`)
- [ ] Workflow includes a `sonarqube` service container definition (image: `sonarqube:25.x-community`) with port `9000` exposed and health check configured
- [ ] Workflow waits for SonarQube to return `UP` status (via `curl` or health check command) before running the scanner
- [ ] Workflow steps:
  1. Checkout code
  2. Setup pnpm + Node.js (reuse existing CI patterns from `.github/workflows/ci.yml`)
  3. Install dependencies (`pnpm install --frozen-lockfile`)
  4. Build shared packages (`pnpm -r build`)
  5. Run tests with coverage for each service (`pnpm --filter <service> test -- --collectCoverage`)
  6. Run SonarScanner for each service (using `sonarsource/sonarscanner-cli` Docker image or npx)
  7. Wait for SonarQube background task to complete (poll `api/ce/task?id=...`)
  8. Fetch Quality Gate status from `api/qualitygates/project_status?projectKey=...`
  9. Fail workflow if any service's Quality Gate status is `ERROR`
- [ ] GitHub branch protection rule on `main` requires the `SonarQube Quality Gate` check to pass before merging
- [ ] Analysis runs on push to `main` too (not just PR) to establish a baseline for "New Code" comparison
- [ ] The SonarQube service container is ephemeral — no data persistence between workflow runs
- [ ] Workflow timeout set to 15 minutes (SonarQube startup ~60s + tests ~3min + scanner ~2min + polling ~2min)

**Notas:** The branch protection rule must be configured manually in the GitHub UI after the workflow first runs and registers the check name. The workflow uses `sonar.host.url=http://localhost:9000` and `sonar.login=admin` / `sonar.password=admin` (default credentials) for the ephemeral container. Since the container is ephemeral, the default credentials are safe — they only exist within the CI job. For push to `main`, coverage is compared against the previous analysis on the same branch (SonarQube's "New Code" definition).

---

### US-05: Local analysis command `[Could]`

> Como **desarrollador**, quiero **ejecutar `pnpm sonar` para analizar todos los servicios backend localmente contra una instancia SonarQube corriendo**, para que **pueda verificar la calidad de mi código antes de abrir un PR**.

**Criterios de aceptación:**
- [ ] Root-level `package.json` script `sonar` added: runs Jest with coverage + SonarScanner for all three services
- [ ] Script uses `sonar.host.url=http://localhost:9000` and default credentials
- [ ] Script reports clear output: service name, Quality Gate status (PASSED/FAILED), and a link to the SonarQube dashboard (`http://localhost:9000/dashboard?id=...`)
- [ ] Script fails with non-zero exit code if any service's Quality Gate is ERROR
- [ ] Pre-requisite documented: `make sonar` must be running before `pnpm sonar`
- [ ] Script uses `npx sonar-scanner` (no global installation required) or a thin wrapper script

**Notas:** This is marked `[Could]` because developers can also achieve the same result by running the CI workflow locally via `act` or by manually running `pnpm test -- --collectCoverage && npx sonar-scanner` per service. A convenience script reduces friction. If SonarQube is not running, the script should fail with a clear message: "SonarQube not reachable at http://localhost:9000. Run `make sonar` first."

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | — | sí (capa 1) |
| US-04 | US-01, US-02, US-03 | no (capa 2) |
| US-05 | US-01, US-02 | sí dentro de capa 2 |

**Capas topológicas:**
- **Capa 1** (3 USTs paralelizables): US-01, US-02, US-03
- **Capa 2** (2 USTs, US-04 secuencial tras capa 1, US-05 paralelizable con US-04): US-04 → US-05

---

## Escenarios BDD

### Feature: SonarQube local infrastructure — US-01

```gherkin
Feature: SonarQube local infrastructure
  As a developer
  I want to start a local SonarQube instance
  So that I can run code quality analysis without external services

  Scenario: Start SonarQube with make sonar
    Given the project's docker-compose.yml includes a SonarQube service definition
    When I run "make sonar"
    Then the SonarQube container starts and passes its health check
    And the terminal displays the URL "http://localhost:9000"
    And the terminal displays the default credentials "admin/admin"

  Scenario: SonarQube data persists across restarts
    Given a Quality Gate has been configured in SonarQube
    When I run "make down" and then "make sonar" again
    Then the previously configured Quality Gate is still available

  Scenario: Port conflict with Kafka is avoided
    Given Kafka is running on port 9092
    When I run "make sonar"
    Then SonarQube starts successfully on port 9000 without port conflicts
```

### Feature: Project configuration — US-02

```gherkin
Feature: SonarQube project configuration
  As a developer
  I want each backend service to have a sonar-project.properties file
  So that SonarQube correctly identifies source, test, and coverage paths

  Scenario: authorization-service is configured correctly
    Given the file "apps/authorization-service/sonar-project.properties" exists
    When I read the projectKey
    Then it is "open-supervisor-authorization-service"
    And the sources point to "src"
    And test files matching "**/*.spec.ts" are included but excluded from duplication analysis

  Scenario: Jest produces lcov coverage for all services
    Given Jest is configured with coverageReporters including "lcov"
    When I run "pnpm --filter authorization-service test -- --collectCoverage"
    Then a file "apps/authorization-service/coverage/lcov.info" is generated

  Scenario: bff service is configured correctly
    Given the file "apps/bff/sonar-project.properties" exists
    When I read the projectKey
    Then it is "open-supervisor-bff"

  Scenario: sse-server service is configured correctly
    Given the file "apps/sse-server/sonar-project.properties" exists
    When I read the projectKey
    Then it is "open-supervisor-sse-server"
```

### Feature: Quality Gate enforcement — US-03

```gherkin
Feature: Quality Gate enforcement
  As a tech lead
  I want a Quality Gate with specific thresholds
  So that substandard code is blocked from merging

  Scenario: PR with coverage below 80% fails the gate
    Given a service has 75% coverage on new code
    When SonarQube evaluates the "open-supervisor-gate" Quality Gate
    Then the Coverage condition status is "ERROR"
    And the overall gate status is "ERROR"

  Scenario: PR with critical bug fails the gate
    Given a service has 1 critical bug detected
    When SonarQube evaluates the "open-supervisor-gate" Quality Gate
    Then the Critical Bugs condition status is "ERROR"

  Scenario: PR with all conditions passing succeeds
    Given a service has coverage >= 80%, duplication <= 5%, no critical bugs,
      no blocker bugs, no new major code smells, and all security hotspots reviewed
    When SonarQube evaluates the "open-supervisor-gate" Quality Gate
    Then all conditions show "OK"
    And the overall gate status is "OK"

  Scenario: Unreviewed security hotspot fails the gate
    Given a service has 1 unreviewed security hotspot
    When SonarQube evaluates the "open-supervisor-gate" Quality Gate
    Then the Security Hotspots Reviewed condition status is not "OK"
    And the overall gate status is "ERROR"
```

### Feature: CI integration — US-04

```gherkin
Feature: SonarQube CI integration
  As a developer
  I want SonarQube analysis to run automatically on every PR
  So that quality issues are detected before code reaches production

  Scenario: PR analysis runs and reports success
    Given a PR targeting "main" is opened
    When the "SonarQube Quality Gate" workflow completes
    Then all three services report Quality Gate status "OK"
    And the GitHub Check "SonarQube Quality Gate" shows as "passed"

  Scenario: PR with failing quality gate blocks merge
    Given a PR targeting "main" has failing coverage on authorization-service
    When the "SonarQube Quality Gate" workflow completes
    Then the GitHub Check "SonarQube Quality Gate" shows as "failed"
    And the merge button is blocked by branch protection rules

  Scenario: Analysis on push to main establishes baseline
    Given code is pushed to the "main" branch
    When the "SonarQube Quality Gate" workflow triggers
    Then the analysis runs successfully
    And the results are available for "New Code" comparison on future PRs
```

---

## Plan de Tests TDD

### US-01 — SonarQube container infrastructure

**Infrastructure tests (Makefile + Docker)**
- [ ] [RED]   Verify `make sonar` target exists in Makefile and references the SonarQube service
- [ ] [GREEN] Add `sonar` target to Makefile with `$(COMPOSE) up -d sonarqube` + health check wait
- [ ] [RED]   Verify docker-compose.yml defines a `sonarqube` service on port 9000 with health check
- [ ] [GREEN] Add `sonarqube` service definition with `sonarqube:25.x-community` image
- [ ] [RED]   Verify `make down` stops the SonarQube container (container not running after down)
- [ ] [GREEN] Ensure `make down` calls `$(COMPOSE) down` which already stops all services including sonarqube

**Edge cases**
- [ ] SonarQube fails to start because port 9000 is already in use → clear error message
- [ ] `make sonar` when SonarQube is already running → idempotent (container already running)
- [ ] SonarQube takes longer than expected to start → health check retries up to 60s

---

### US-02 — Project configuration + Jest coverage

**Unit tests (file validation)**
- [ ] [RED]   Verify `apps/authorization-service/sonar-project.properties` exists with correct content
- [ ] [GREEN] Create `sonar-project.properties` with correct projectKey, sources, tests, exclusions, lcov path
- [ ] [RED]   Verify `apps/bff/sonar-project.properties` exists with correct content
- [ ] [GREEN] Create `sonar-project.properties` for bff
- [ ] [RED]   Verify `apps/sse-server/sonar-project.properties` exists with correct content
- [ ] [GREEN] Create `sonar-project.properties` for sse-server
- [ ] [RED]   Verify Jest produces `coverage/lcov.info` when `--collectCoverage` flag is used for bff
- [ ] [GREEN] Add `coverageReporters: ["lcov", "text"]` to bff jest config
- [ ] [RED]   Verify Jest produces `coverage/lcov.info` for sse-server
- [ ] [GREEN] Add `coverageReporters: ["lcov", "text"]` and `coverageDirectory: "coverage"` to sse-server jest config
- [ ] [RED]   Verify authorization-service coverage directory is standardized to `coverage` (not `../coverage`)
- [ ] [GREEN] Update authorization-service jest config: `coverageDirectory` from `"../coverage"` to `"coverage"`

**Integration tests**
- [ ] Run `pnpm --filter authorization-service test -- --collectCoverage` and verify `coverage/lcov.info` is created
- [ ] Run `pnpm --filter bff test -- --collectCoverage` and verify `coverage/lcov.info` is created
- [ ] Run `pnpm --filter sse-server test -- --collectCoverage` and verify `coverage/lcov.info` is created

**Edge cases**
- [ ] Coverage directory doesn't exist before test run → Jest creates it automatically
- [ ] `coverage/lcov.info` is not generated because no tests exist → graceful handling (empty but valid file or clear error)
- [ ] `sonar-project.properties` has invalid syntax → SonarScanner reports clear error message

---

### US-03 — Quality Gate and Quality Profile

**Configuration validation**
- [ ] [RED]   Verify `scripts/sonarqube/quality-gate.json` exists and is valid JSON
- [ ] [GREEN] Create `quality-gate.json` with gate name and all condition definitions
- [ ] [RED]   Verify quality gate JSON includes all required conditions (coverage, duplication, bugs, code smells, security hotspots)
- [ ] [GREEN] Populate all condition objects with metric keys and thresholds
- [ ] [RED]   Verify a setup script or documented API commands exist to apply the gate to SonarQube
- [ ] [GREEN] Create `scripts/sonarqube/setup-quality-gate.sh` using `curl` against SonarQube Web API

**Integration tests (requires running SonarQube)**
- [ ] Apply quality gate via API and verify it exists in SonarQube (`GET api/qualitygates/show`)
- [ ] Associate gate with a test project and verify the project uses `open-supervisor-gate`
- [ ] Create a test project with known issues and verify gate status reflects errors correctly

**Edge cases**
- [ ] Quality Gate name already exists → update, don't duplicate
- [ ] SonarQube API returns 401 (not authenticated) → clear error with credentials hint
- [ ] SonarQube Community Edition doesn't support a metric → graceful skip, not crash

---

### US-04 — CI integration

**CI workflow validation**
- [ ] [RED]   Verify `.github/workflows/sonarqube.yml` exists and is valid YAML
- [ ] [GREEN] Create workflow file with trigger, service container, and steps
- [ ] [RED]   Verify workflow includes SonarQube service container with health check
- [ ] [GREEN] Define service container with `sonarqube:25.x-community` image
- [ ] [RED]   Verify workflow fails when any service reports Quality Gate ERROR
- [ ] [GREEN] Add status polling and exit code logic
- [ ] [RED]   Verify workflow triggers on `pull_request` targeting `main`
- [ ] [GREEN] Configure `on: pull_request: branches: [main]`

**Manual verification (cannot be automated without a live PR)**
- [ ] Open a PR with code that should fail the gate (e.g., remove tests to drop coverage) and verify workflow fails
- [ ] Open a PR with clean code and verify workflow passes
- [ ] Verify that the failed check blocks the merge button (requires branch protection setup)

**Edge cases**
- [ ] SonarQube container fails to start in CI → workflow fails with clear timeout message (not silent hang)
- [ ] SonarScanner reports a network error connecting to SonarQube → retry logic (up to 3 attempts)
- [ ] Coverage file not found → clear error indicating which service is missing coverage
- [ ] PR from fork → SonarQube analysis still runs (no secrets needed for ephemeral container)

---

### US-05 — Local analysis command

**Script validation**
- [ ] [RED]   Verify `pnpm sonar` runs successfully when SonarQube is available
- [ ] [GREEN] Add root-level `sonar` script to `package.json`
- [ ] [RED]   Verify `pnpm sonar` fails with clear message when SonarQube is NOT running
- [ ] [GREEN] Add pre-flight check: curl to `http://localhost:9000/api/system/status`
- [ ] [RED]   Verify `pnpm sonar` exits with non-zero code when Quality Gate fails
- [ ] [GREEN] Parse scanner output and propagate exit code

**Edge cases**
- [ ] Developer runs `pnpm sonar` without `make sonar` first → clear "run make sonar first" message
- [ ] SonarScanner reports a connection refused → retry with backoff (5s, 10s, 15s)
- [ ] Tests fail during coverage collection → `pnpm sonar` stops and reports test failure, not scanner error

---

## Definition of Done

- [ ] `make sonar` starts SonarQube Community Edition on port 9000 with health check
- [ ] All three backend services have valid `sonar-project.properties`
- [ ] All three services produce `coverage/lcov.info` when running `pnpm test -- --collectCoverage`
- [ ] Quality Gate `open-supervisor-gate` is defined and documented in `scripts/sonarqube/quality-gate.json`
- [ ] `.github/workflows/sonarqube.yml` runs on PR toward `main` and push to `main`
- [ ] CI workflow reports Quality Gate status as a GitHub Check
- [ ] GitHub branch protection on `main` requires the SonarQube check (documented setup step)
- [ ] `pnpm sonar` runs local analysis against a running SonarQube instance
- [ ] All CI workflows pass (existing `ci.yml` tests + new `sonarqube.yml` analysis)
- [ ] `make down` stops SonarQube alongside other services
- [ ] Documentation updated: `CLAUDE.md` references `make sonar` and `pnpm sonar` commands

---

## Riesgos y Dependencias

| Tipo | Detalle |
|------|---------|
| Dependencia externa | `sonarqube:25.x-community` Docker image availability on Docker Hub (also available on `quay.io` as fallback) |
| Dependencia externa | `sonarsource/sonarscanner-cli` Docker image for CI analysis |
| Riesgo técnico | Arm64 compatibility: SonarQube Community Edition 25.x may not have a native arm64 image. Workaround: use `--platform linux/amd64` with Rosetta emulation on Apple Silicon (performance impact ~2x slower, acceptable for local dev). |
| Riesgo técnico | Current codebase likely has <80% coverage on some services, causing initial Quality Gate failures on all PRs. Mitigation: document this as expected; the gate drives coverage improvement. |
| Riesgo técnico | SonarQube Community Edition uses H2 embedded database by default, which is lost on container restart unless a volume is mounted. Mitigation: `sonarqube_data` volume in docker-compose. |
| Suposición a validar | The `sonar.exclusions=**/*.spec.ts` pattern correctly excludes test files from duplication and code smell analysis in SonarQube Community Edition (behavior may vary by version). |
| Suposición a validar | GitHub branch protection requiring a check from a new workflow name works without the check having run at least once (GitHub may require the check to exist in the target branch first). |

---

## Architect Review: Technical Feasibility Validation

### ✅ Confirmed: arm64 Compatibility

SonarQube Community Edition **has native arm64 images** since version 9.x. Docker Hub verified on 2026-06-10:

| Tag | amd64 | arm64 | Pushed |
|-----|-------|-------|--------|
| `sonarqube:26.6.0.123539-community` | ✅ | ✅ | 2026-06-03 |
| `sonarqube:25.12.0.117093-community` | ✅ | ✅ | 2025-12-11 |
| `sonarqube:9.9.8-community` (current LTS) | ✅ | ✅ | 2025-09-02 |

**Recommendation:** Use `sonarqube:26.6.0.123539-community` — it's the latest with arm64, multi-arch manifest, and includes SonarWay TypeScript profile updates. NO Rosetta emulation needed. The `--platform linux/amd64` workaround from the Risks section is unnecessary.

### ⚠️ sonarscanner-cli: amd64 only

The `sonarsource/sonar-scanner-cli:12.1.0.3233_8.0.1` Docker image is **amd64-only**. For local development on Apple Silicon, use the Node.js wrapper:

```bash
pnpm add -D sonarqube-scanner  # root-level devDependency
npx sonar-scanner              # Run from service directory
```

Requires Java runtime (available in GitHub Actions `ubuntu-latest` with OpenJDK 21; locally install via `brew install openjdk` for macOS).

### ⚠️ Jest Config Correction

Jest configuration is **embedded in `package.json`** (not standalone `jest.config.ts` files):

| Service | Coverage config | Current | Required |
|---------|----------------|---------|----------|
| authorization-service | `coverageDirectory` | `"../coverage"` | `"coverage"` (standardize) |
| authorization-service | `coverageReporters` | ❌ not set (uses defaults) | `["lcov", "text"]` |
| bff | `coverageDirectory` | ❌ not set | `"coverage"` (add) |
| bff | `coverageReporters` | ❌ not set | `["lcov", "text"]` (add) |
| sse-server | `coverageDirectory` | ❌ not set | `"coverage"` (add) |
| sse-server | `coverageReporters` | ❌ not set | `["lcov", "text"]` (add) |

**Important path note:** `coverageDirectory` is relative to the service root (where `package.json` lives), NOT relative to `rootDir`. Default Jest reporters include `lcov`, so coverage files DO generate currently — but adding explicit config ensures consistency.

### ⚠️ Port Verification

| Port | Service | Status |
|------|---------|--------|
| 2181 | Zookeeper | In use |
| 389 | OpenLDAP | In use |
| 3000 | BFF | In use |
| 3001 | authorization-service | In use |
| 3002 | sse-server | In use (NOT 3003) |
| 5432 | PostgreSQL | In use |
| 6379 | Redis | In use |
| 8080 | Keycloak | In use |
| 9000 | **SonarQube (NEW)** | ✅ Available |
| 9092 | Kafka | In use |

No port conflicts. SonarQube on 9000 is safe.

### ⚠️ `sonar.exclusions` vs `sonar.cpd.exclusions`

The spec uses `sonar.exclusions=**/*.spec.ts` to exclude test files from duplication and code smell analysis. **Issue:** `sonar.exclusions` excludes files from ALL analysis, making test files invisible — they won't appear in the project tree at all.

**Recommended correction:** Use `sonar.cpd.exclusions=**/*.spec.ts` instead, which only excludes from Copy-Paste Detection, while keeping test files visible and tracked as test files (via `sonar.tests=src` + `sonar.test.inclusions=**/*.spec.ts`). Test files' code smells are tracked separately and don't affect source code metrics.

### ✅ CI Ephemeral SonarQube Viability

- SonarQube startup time: ~30-60s on amd64 in GitHub Actions
- Tests with coverage: ~2-3 min for all 3 services
- Scanner: ~30-60s per service
- Quality Gate polling: ~30-60s
- **Total estimate:** ~6-8 minutes (well within 15-min timeout)
- GitHub Actions `ubuntu-latest` has Java 21 pre-installed → `npx sonar-scanner` works without extra setup

### ✅ `make down` Compatibility

Existing `make down` target already calls `$(COMPOSE) down` which stops **all** services defined in `docker-compose.yml`. Adding a `sonarqube` service requires zero changes to the `down` target.

---

## Dependencies Table (npm + Docker)

| Dependency | Type | Version | Scope |
|-----------|------|---------|-------|
| `sonarqube` | Docker image | `26.6.0.123539-community` | US-01, US-04 |
| `sonarsource/sonar-scanner-cli` | Docker image | `12.1.0.3233_8.0.1` | US-04 (CI only, amd64) |
| `sonarqube-scanner` | npm (devDep, root) | `^4.2.0` | US-05 (local), US-04 alt |
| `@types/jest` | npm (devDep) | already present | US-02 |
| `ts-jest` | npm (devDep) | already present | US-02 |

---

## Files to Create/Modify per UST

### US-01: SonarQube Container Infrastructure

| Action | File | Notes |
|--------|------|-------|
| **MODIFY** | `docker-compose.yml` | Add `sonarqube` service definition after Keycloak block (line ~111), add `sonarqube_data:` to `volumes:` (line ~112-116) |
| **MODIFY** | `Makefile` | Add `sonar:` target after `infra` target, add `sonar` to `.PHONY` line. Health check waits for `curl -s http://localhost:9000/api/system/status` returning `UP` |

SonarQube service definition to add:
```yaml
  sonarqube:
    image: sonarqube:26.6.0.123539-community
    ports:
      - "9000:9000"
    environment:
      SONAR_ES_BOOTSTRAP_CHECKS_DISABLE: "true"
    volumes:
      - sonarqube_data:/opt/sonarqube/data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9000/api/system/status | grep -q '\"status\":\"UP\"'"]
      interval: 15s
      timeout: 10s
      retries: 10
      start_period: 60s
```

Volumes to add:
```yaml
  sonarqube_data:
```

Makefile target:
```makefile
sonar:
	@echo "$(CYAN)🐳 Starting SonarQube...$(NC)"
	@$(COMPOSE) up -d sonarqube
	@echo "$(YELLOW)⏳ Waiting for SonarQube to be ready (may take ~60s on first startup)...$(NC)"
	@for i in $$(seq 1 30); do \
		curl -sf http://localhost:9000/api/system/status | grep -q '"status":"UP"' && break; \
		sleep 5; \
	done
	@echo ""
	@echo "$(GREEN)✅ SonarQube ready: $(NC)http://localhost:9000"
	@echo "   Default credentials: admin / admin"
```

### US-02: sonar-project.properties + Jest Coverage

| Action | File | Notes |
|--------|------|-------|
| **CREATE** | `apps/authorization-service/sonar-project.properties` | projectKey: `open-supervisor-authorization-service` |
| **CREATE** | `apps/bff/sonar-project.properties` | projectKey: `open-supervisor-bff` |
| **CREATE** | `apps/sse-server/sonar-project.properties` | projectKey: `open-supervisor-sse-server` |
| **MODIFY** | `apps/authorization-service/package.json` | `jest.coverageDirectory`: `"../coverage"` → `"coverage"`. Add `jest.coverageReporters: ["lcov", "text"]` |
| **MODIFY** | `apps/bff/package.json` | Add `jest.coverageDirectory: "coverage"` and `jest.coverageReporters: ["lcov", "text"]` |
| **MODIFY** | `apps/sse-server/package.json` | Add `jest.coverageDirectory: "coverage"` and `jest.coverageReporters: ["lcov", "text"]` |

Sonar properties per service (identical pattern, different projectKey):

```properties
# apps/<service>/sonar-project.properties
sonar.projectKey=open-supervisor-<service>
sonar.projectName=open-supervisor <service>
sonar.sources=src
sonar.tests=src
sonar.test.inclusions=**/*.spec.ts
sonar.cpd.exclusions=**/*.spec.ts
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.typescript.tsconfigPath=tsconfig.json
sonar.sourceEncoding=UTF-8
```

📍 **Architect note:** `sonar.cpd.exclusions` used instead of `sonar.exclusions` (see above for rationale). `sonar.javascript.lcov.reportPaths` is relative to the properties file location (i.e., the service root). The `coverage/lcov.info` path matches `coverageDirectory: "coverage"` in Jest config.

### US-03: Quality Gate and Quality Profile

| Action | File | Notes |
|--------|------|-------|
| **CREATE** | `scripts/sonarqube/quality-gate.json` | JSON definition of `open-supervisor-gate` |
| **CREATE** | `scripts/sonarqube/setup-quality-gate.sh` | Bash script using SonarQube Web API to create gate + profile |
| **CREATE** | `scripts/sonarqube/setup-quality-profile.sh` | Bash script to create `open-supervisor-ts` profile from SonarWay baseline |

quality-gate.json structure:
```json
{
  "name": "open-supervisor-gate",
  "conditions": [
    { "metric": "new_coverage", "op": "LT", "error": "80" },
    { "metric": "new_duplicated_lines_density", "op": "GT", "error": "5" },
    { "metric": "new_blocker_violations", "op": "GT", "error": "0" },
    { "metric": "new_critical_violations", "op": "GT", "error": "0" },
    { "metric": "new_major_violations", "op": "GT", "error": "0" },
    { "metric": "security_hotspots_reviewed", "op": "LT", "error": "100" }
  ]
}
```

### US-04: CI Integration

| Action | File | Notes |
|--------|------|-------|
| **CREATE** | `.github/workflows/sonarqube.yml` | New workflow, parallel to existing `ci.yml` |

Workflow triggers: `pull_request: branches: [main]` + `push: branches: [main]`  
Uses `npx sonar-scanner` (from npm `sonarqube-scanner` package) rather than Docker image for simplicity and consistency with local dev.

Key workflow steps (detailed pseudo-YAML in implementer notes below):
1. Checkout code (actions/checkout@v4)
2. Setup pnpm + Node.js 24 (reuse existing ci.yml patterns)
3. pnpm install --frozen-lockfile
4. pnpm -r build
5. Run tests with coverage per service
6. Start SonarQube service container (wait for health check)
7. Run scanner for each service → `npx sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.login=admin -Dsonar.password=admin`
8. Poll `api/ce/task?id=...` until status is SUCCESS
9. Query `api/qualitygates/project_status?projectKey=...` for each service
10. Fail if any status is ERROR

### US-05: Local Analysis Command

| Action | File | Notes |
|--------|------|-------|
| **MODIFY** | `package.json` (root) | Add `"sonar": "tsx scripts/sonarqube/run-local-analysis.ts"` script |
| **CREATE** | `scripts/sonarqube/run-local-analysis.ts` | Wrapper script: pre-flight check → test + coverage → scanner → gate status |
| **MODIFY** | `package.json` (root devDependencies) | Add `"sonarqube-scanner": "^4.2.0"` |

---

## Implementation Order

### Capa 1 (parallelizable — 3 scopes)

**Scope `feature-sonarqube-infra` (US-01)**: Docker + Makefile changes only. Zero code dependencies. Implementer: backend agent.

**Scope `feature-sonarqube-config` (US-02)**: Creates properties files + modifies Jest configs. Needs US-01 for integration testing only (can verify scanner connects). Implementer: backend agent.

**Scope `feature-sonarqube-gate` (US-03)**: Creates JSON + bash scripts. Needs US-01 for API testing (must have running SonarQube). Implementer: backend agent.

### Capa 2 (sequential after Capa 1)

**Scope `feature-sonarqube-ci` (US-04)**: Depends on US-01 (container definition), US-02 (properties + coverage), US-03 (gate definition). Implementer: backend agent.

**Scope `feature-sonarqube-local` (US-05)**: Depends on US-01 (container running), US-02 (properties + coverage). Can run in parallel with US-04 within capa 2. Implementer: backend agent.

---

## Architect-Identified Additional Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `sonarqube-scanner` npm package requires Java 17+ at runtime | MEDIUM | Document prerequisite. GitHub Actions `ubuntu-latest` has Java 21. macOS: `brew install openjdk`. |
| `sonarsource/sonar-scanner-cli` Docker image no arm64 → local dev MUST use npm package | MEDIUM | Already planned: US-05 uses `npx sonar-scanner`. Only CI uses Docker image for scanner (amd64). |
| H2 embedded DB corruption if SonarQube killed mid-write | LOW | Named volume `sonarqube_data` provides persistence. Graceful shutdown via `make down`. |
| `sonar.cpd.exclusions` syntax differs from `sonar.exclusions` | LOW | Verify with SonarQube 26.x docs. Pattern `**/*.spec.ts` is standard SonarQube glob syntax. |
| Root-level `sonar` script name collision | LOW | `sonar` is not currently used. `sonarqube` could be used as alternative if conflict arises. |
| Coverage thresholds may fail initially on bff and sse-server | EXPECTED | This is intentional — drives test improvement. Document as known state. |
