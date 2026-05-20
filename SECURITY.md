# Security Policy

## Reporting Vulnerabilities

Please report security issues privately to the maintainer via GitHub Security
Advisories on the `MUSE-CODE-SPACE/test-genie-mcp` repository, or by email at
`gongyoonkyoung@gmail.com`. Do NOT open a public issue for security reports.

We aim to acknowledge reports within 72 hours and ship a fix within 14 days
for high/critical severity issues.

---

## Capabilities-based Path Safety

`test-genie-mcp` operates on user project paths (iOS, Android, Flutter, React
Native, Web). To prevent path traversal and "accidental" filesystem access
outside the project the user intended, the server enforces an **allowed
root** boundary on every tool that takes a `projectPath` argument.

### How it works

On startup the server resolves the allowed root in this order:

1. `TEST_GENIE_ALLOWED_ROOT` environment variable (if set and non-empty).
2. Otherwise `process.cwd()` — the directory the server was launched from.

Every tool that accepts `projectPath` passes the value through
`validatePathWithinAllowedRoot()` (see [`src/security.ts`](src/security.ts))
before the path is used to read files, write fixes, or spawn subprocesses.
If the resolved absolute path is not equal to or a descendant of the allowed
root, the call fails with a structured `ToolError(code='PATH_TRAVERSAL')`.

### Example: restricting test-genie to a specific project tree

```bash
TEST_GENIE_ALLOWED_ROOT=/Users/you/projects npx test-genie-mcp
```

With the above, ANY `projectPath` outside `/Users/you/projects/...` is
rejected — even if the MCP client requests it. The server logs the resolved
allowed root on startup:

```
[security] Allowed root: /Users/you/projects
```

### Tools covered (Phase 1)

All 19 MCP tools that accept `projectPath` are validated:

- `analyze_app_structure`, `generate_scenarios`, `create_test_plan`
- `run_scenario_test`, `run_simulation`, `run_stress_test`
- `detect_memory_leaks`, `detect_logic_errors`
- `suggest_fixes`, `apply_fix`, `rollback_fix`, `confirm_fix`
- `run_full_automation`, `generate_report`
- `get_pending_fixes`, `get_test_history`
- `analyze_performance`, `analyze_code_deep`, `generate_cicd_config`

---

## Subprocess / Command Execution Safety

Several tools (iOS/Android/Flutter/React Native/Web test runners) spawn
external commands (`xcrun`, `adb`, `flutter`, `npx`, etc.). The Phase 1
baseline establishes safety primitives in [`src/security.ts`](src/security.ts):

- `ALLOWED_EXECUTABLES` — an allow-list of executable names the server is
  permitted to invoke.
- `validateCommandArg(arg)` — rejects shell metacharacters
  (`; & | \` $ < > ( ) { } [ ] \\ ! * ? ~ \n \r`).
- `validateCommand(command, args[])` — validates both pieces together for
  use with `child_process.spawn(command, args, opts)`.

### Phase 1 status

- The Metro-bundler shell-concat in `src/platforms/react-native/index.ts`
  (`exec(\`cd "${projectPath}" && npx react-native start ...\`)`) was the
  one direct command-injection sink touching a user-supplied path.
  This has been refactored to `spawn('npx', [...], { cwd })`.
- The remaining `execAsync(command, ...)` call sites in
  `src/platforms/{ios,android,flutter,react-native,web}/index.ts` build
  command strings from values like `scheme`, `device`, `testCommand`, etc.
  These values may originate from user MCP arguments. They are guarded
  today only by the allow-listed `projectPath` boundary and by the user
  trusting their own MCP client.

### Phase 5 plan

Phase 5 will refactor every `execAsync(command, ...)` call site to
`spawn(executable, argv[], opts)` with `validateCommand()` enforced at
each boundary. Trackers:

- iOS `xcodebuild`, `xcrun simctl`, `instruments` — argv refactor + scheme
  validation regex.
- Android `adb` shell payloads — argv refactor + package-name validation.
- Flutter `flutter test`, `flutter drive` — argv refactor.
- React Native `jest`, `detox` — argv refactor.
- Web `playwright`, `cypress` — argv refactor.

Tracked in `MIGRATION.md` under "Deferred Phase 5 items".

---

## Capability Summary

| Capability | Default | How to constrain |
|---|---|---|
| Read user project files | Allowed within `process.cwd()` | Set `TEST_GENIE_ALLOWED_ROOT` to a tighter path |
| Write user project files (apply_fix, etc.) | Same allowed root | Same |
| Spawn subprocesses (test runners, build tools) | Allow-listed executables only | Edit `ALLOWED_EXECUTABLES` in `src/security.ts` |
| Network access | Currently none in core; transport is stdio only | n/a |

---

## Threat Model (Phase 1)

**In scope:**
- Path traversal via `projectPath` and related path arguments.
- Direct command injection via shell-concatenated user input.
- Accidental filesystem access outside the intended project tree.

**Out of scope (Phase 5):**
- Indirect command injection via still-shell-formatted platform commands
  (scheme, device-id, etc. — tracked above).
- Untrusted MCP clients invoking destructive `apply_fix` calls — relies on
  the user's trust in their MCP client. Phase 5 will add `dry-run by default`
  + diff preview + max-LOC guardrails.
