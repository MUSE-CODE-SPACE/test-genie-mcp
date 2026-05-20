# Changelog

All notable changes to `test-genie-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] — 2026-05-20

### Highlights — what's now possible

This release flips test-genie from "test runner with auto-fix" into a **self-healing test loop**.

- **One MCP call** drives test → detect → fix → re-test → converge. Regressions roll back automatically. Hitting `maxIterations` or a timeout returns a `resumeToken` so you can pick up later.
- **Strong syntax validation** before any patch lands: TypeScript compiler API for TS/JS, platform compilers (`swiftc`, `kotlinc`, `javac`, `dart analyze`) for native code, brace-balance fallback with `downgraded: true` flagging.
- **Optional LLM-backed fix proposals** when rule-based confidence is low. SDKs are `optionalDependencies`, so `npm install test-genie-mcp` stays slim — set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to opt in.
- **McpServer high-level API**: the 700-line `switch` in v2.x `src/index.ts` is gone. Tools live in a declarative registry; entry-point boilerplate is ~30 lines.
- **Subprocess hardening sweep**: every platform integration (iOS, Android, Flutter, React Native, web) now goes through `spawn(cmd, argv[])` with an executable allowlist and per-argument regex validation. The old `execAsync('… ${user-input} …')` pattern is gone.
- **MCP resources + prompts**: 4 resources (iteration logs index + 3 templated views) and 2 prompts (`full-test-pipeline`, `diagnose-failure`).
- **Self-test corpus**: 5 mini-broken fixture projects (RN, web, Flutter, iOS, Android) drive integration tests of the iterate-fix loop. CI gates coverage on the core surface.

### Added

- `run_iterative_fix_loop` tool — the headline feature. Safe defaults (`autoApply: false`, `maxIterations: 5`, `strategy: 'hybrid'`). Returns structured iteration logs.
- `core/syntaxValidator.ts` — TS compiler API + platform-compiler fallback chain.
- `core/subprocess.ts` — `runProcess` + `spawnBackground` helpers that enforce the executable allowlist and argv-array discipline.
- `core/toolRegistry.ts` + `core/mcpServerFactory.ts` — single source of truth for all 20 tools, 4 resources, 2 prompts.
- `core/resources.ts` — MCP resource handlers for test history, iteration logs, applied fixes.
- `core/prompts.ts` — `full-test-pipeline` and `diagnose-failure` prompt templates.
- `llm/index.ts` + `tools/fixing/llmFixSuggester.ts` — Anthropic / OpenAI fallback (provider auto-detect mirrors error-doctor-mcp).
- `storage/iteration-logs.json` — persisted loop history (last 200 across all projects).
- `tests/` — 6 suites, 52 tests: security regression, syntax validator, iterate-loop fixture convergence, registry shape, LLM detection, per-tool happy/error.
- `tests/fixtures/{react-native-app,web-app,flutter-app,ios-app,android-app}/` — deliberately-broken mini projects.
- `docs/ITERATE_FIX_LOOP.md`, `docs/SIMULATION_VS_REAL.md`.
- Env vars: `TEST_GENIE_LLM_PROVIDER`, `TEST_GENIE_STORAGE_DIR`, `TEST_GENIE_ANTHROPIC_MODEL`, `TEST_GENIE_OPENAI_MODEL`.
- npm `optionalDependencies`: `@anthropic-ai/sdk`, `openai`.

### Changed

- `src/index.ts` shrunk from 737 lines to ~30. All tool dispatch lives in `core/toolRegistry`.
- `apply_fix` now uses `core/syntaxValidator.validateSyntax` instead of the v2.x brace-counter. Drop-in compatible — the caller-facing shape `{ valid, error }` is unchanged.
- `ALLOWED_EXECUTABLES` (in `src/security.ts`) gains `swiftc`, `kotlinc`, `javac`, `lighthouse`, `k6`, `where`, `which` to support the new syntax validator and web platform integrations.
- Platform files (`src/platforms/{ios,android,flutter,react-native,web}/index.ts`) refactored to use `runProcess(cmd, [args])` — no more shell concatenation.
- Tool descriptions now include a `[mode: simulated | real | hybrid]` tag for execution-mode clarity.

### Fixed

- `run_full_automation` no longer silently shells out user-controlled `scheme`, `device`, `testPath`, etc. — these are validated against allowlist regexes before reaching `spawn`.

### Security

- ~30 `execAsync(commandStr)` call sites across platform integrations replaced with hardened `runProcess(cmd, [argv])` equivalents. See `SECURITY.md` § Phase 5 subprocess audit.
- Per-arg shell-metacharacter rejection extended to all `runProcess` paths even when `skipAllowlist: true` (for the few legitimate `sh -c` cases).
- New tests in `tests/security.test.ts` lock in the hardening so future refactors can't silently weaken it.

### Breaking changes

- **`run_full_automation` option rename.** `confirmMode` is *deprecated*; use `autoApply: boolean` instead. The v2.x option is still accepted for backwards compat — `confirmMode: 'auto'` is equivalent to `autoApply: true`.
  - Migration: replace
    ```jsonc
    { "confirmMode": "auto", "autoFix": true }
    ```
    with
    ```jsonc
    { "autoApply": true }
    ```
- **Platform tool subprocess hardening.** Identifier arguments (`scheme`, `device`, `package`, `testClass`, …) are now validated against `^[A-Za-z0-9._-]+$` (or a slightly looser regex for fields like `destination`). Calls that previously passed values containing spaces, semicolons, or backticks will now be rejected with `ToolError(code='COMMAND_INJECTION')`. Sanitize at the caller — most real values already match.
- **Server identity bumped to `test-genie-mcp v3.0.0`** in the MCP `initialize` response. Clients pinning on `"version": "2.x"` need to relax the constraint.

### Contributors

- Self (Claude Opus 4.7, 1M context) — co-author on the Phase 5 implementation.

## [2.1.0] — 2026-05-20

### Phase 1 — Production-quality baseline

This release lays the safe foundation before the deeper Phase 5 work on the
iterate-fix-test loop. See [`MIGRATION.md`](MIGRATION.md) for the full list of
Phase 5 deferrals.

#### Added
- **Capabilities-based path safety**: every `projectPath` tool argument is
  validated against `TEST_GENIE_ALLOWED_ROOT` (defaults to `process.cwd()`).
  Tools fail closed with a structured `ToolError(code='PATH_TRAVERSAL')`
  when called outside the allowed root.
- **Security utilities** (`src/security.ts`): `validatePathWithinAllowedRoot`,
  `validateCommandArg`, `validateCommand`, `ToolError` class, and an
  `ALLOWED_EXECUTABLES` allow-list for future subprocess hardening.
- **GitHub Actions CI** (`.github/workflows/ci.yml`): Node 20, `npm ci`,
  type-check + build, tests when configured.
- **GitHub Actions Release** (`.github/workflows/release.yml`): tag-triggered
  `npm publish` with provenance.
- **`SECURITY.md`**: capability boundaries, threat model, and Phase 5 plan.
- **`MIGRATION.md`**: Phase 1 / Phase 5 boundary documentation.

#### Changed
- **MCP SDK** `@modelcontextprotocol/sdk` `^1.0.0` → `^1.25.0` (resolves to
  1.29.0). No breaking changes on the low-level `Server` API surface used by
  test-genie. Full `McpServer` high-level refactor deferred to Phase 5.
- **Server version** advertised to MCP clients bumped `2.0.0` → `2.1.0`.
- **React Native Metro start** (`src/platforms/react-native/index.ts`)
  refactored from `exec(\`cd "\${projectPath}" && npx react-native start\`)`
  to `spawn('npx', ['react-native', 'start', '--reset-cache'], { cwd })`.
  This was the one direct command-injection sink touching a user-supplied
  path; remaining `execAsync(commandStr)` patterns are documented for
  Phase 5 refactor in `SECURITY.md`.
- **npm package `files` whitelist** tightened: only `dist/`, `templates/`,
  `README.md`, `SECURITY.md`, `LICENSE`, `CHANGELOG.md` are shipped.

#### Security
- Path traversal hardening on all 19 tools.
- One direct command-injection sink removed.
- Allow-listed executable model defined for Phase 5 enforcement.

---

## [2.0.3] — prior baseline

State of the repository before Phase 1 work began.

- 19 MCP tools across analysis / execution / detection / fixing / automation.
- `@modelcontextprotocol/sdk ^1.0.0`.
- Low-level `Server` + giant switch pattern in `src/index.ts`.
- No CI, no Dockerfile, no tests (jest installed but empty test dir).
- npm-published as `test-genie-mcp`. MCP Registry-listed.
