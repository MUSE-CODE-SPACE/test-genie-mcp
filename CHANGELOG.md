# Changelog

All notable changes to `test-genie-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
