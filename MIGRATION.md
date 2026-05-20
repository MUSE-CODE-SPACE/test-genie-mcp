# Migration Notes

## v2.1.0 — Phase 1 baseline (current)

### MCP SDK ^1.0.0 → ^1.25.x

- `@modelcontextprotocol/sdk` bumped from `^1.0.0` to `^1.25.0` (installed
  resolved to `1.29.0`).
- No breaking API changes affecting test-genie's surface:
  - The low-level `Server` class and `setRequestHandler(...Schema, handler)`
    pattern is unchanged.
  - `CallToolResult` shape (`{ content: [{ type: 'text', text }], isError? }`)
    is unchanged.
- `npm run build` passes cleanly with no diagnostics.

### Deferred Phase 5 items

These were intentionally **not** done in Phase 1 because they require deep
refactors that interact with the iterate-fix-test loop being designed in
Phase 5.

#### 1. `Server` → `McpServer` high-level API

- Current state: 19 tools in a single ~700-line switch in `src/index.ts`
  using the low-level `Server` + `ListToolsRequestSchema` /
  `CallToolRequestSchema` pattern.
- Phase 5 plan: decompose into per-tool `server.tool(name, schema, handler)`
  registrations, one file per tool, with Zod schemas. This will unlock:
  - Per-tool type safety (no more `args.x as any`).
  - Easier dogfood-test scaffolding.
  - Cleaner Resources / Prompts integration when those land.

#### 2. Subprocess argv refactor

- Current state: most platform integrations (`src/platforms/{ios,android,
  flutter,react-native,web}/index.ts`) build command strings via template
  literals and call `execAsync(commandStr)`.
- Phase 1 mitigation: `projectPath` is constrained to the allowed root.
  The one direct shell-concat of `projectPath` (Metro start) has been
  refactored to `spawn(..., { cwd })`.
- Phase 5 plan: every `execAsync(commandStr)` becomes
  `spawn(executable, argv[], opts)` with `validateCommand()` from
  `src/security.ts` enforced at each call site. Per-platform value
  validators (scheme regex, package-name regex, device-id regex).

#### 3. iterate-fix-test loop deepening

The original product value of test-genie is the **iterate-fix-test
loop**: detect issue → suggest fix → apply fix → re-run tests → confirm
or rollback. Phase 5 will add:

- Default dry-run mode on `apply_fix` + machine-readable diff.
- Max-files / max-LOC guardrails on bulk fixes.
- Auto-rollback if post-fix tests regress.
- Per-iteration history exposed as `resource://fix/<id>/history`.

#### 4. Test scaffolding

`jest` is installed but the test directory is empty. Phase 5 (or earlier
Phase 3 if prioritized) will add per-tool happy-path + input-validation
tests, plus integration tests for the iterate-fix-test loop.
