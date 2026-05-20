# test-genie-mcp

**Self-healing test automation for iOS, Android, Flutter, React Native, and Web apps — as an MCP server.**

[![npm version](https://img.shields.io/npm/v/test-genie-mcp.svg)](https://www.npmjs.com/package/test-genie-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/MUSE-CODE-SPACE/test-genie-mcp/ci.yml?branch=main)](https://github.com/MUSE-CODE-SPACE/test-genie-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-1.29-blue)](https://modelcontextprotocol.io)

> v3.0.0 ships the headline feature: a **self-healing iterate-fix-test loop** that detects failing tests, proposes fixes, validates them, applies them with backups, re-runs the affected tests, auto-rolls-back regressions, and either converges to green or stops cleanly with a resumable token.

<!-- TODO: demo GIF goes here -->

---

## Why test-genie?

The bottleneck in mobile + cross-platform test automation isn't writing tests — it's the loop *between* a failing test and a passing test. test-genie closes that loop:

```
failing test → analyzer flags issue → fix proposed → dry-run + syntax check →
applied with backup → affected tests re-run → regression check → loop or stop
```

Other tools (Detox, Maestro, Playwright, `xcodebuild test`) run tests. test-genie **runs tests *and* drives the fix until the bar is met or it can no longer make progress** — without you scrubbing through stack traces.

---

## 5-minute Quickstart

```bash
# 1. Install
npm install -g test-genie-mcp

# 2. Add to Claude Desktop config (~/.config/claude/claude_desktop_config.json)
{
  "mcpServers": {
    "test-genie": {
      "command": "npx",
      "args": ["test-genie-mcp"],
      "env": {
        "TEST_GENIE_ALLOWED_ROOT": "/path/to/your/project"
      }
    }
  }
}

# 3. Restart Claude Desktop. From a chat:
#    "Run the iterate-fix loop on /Users/me/my-rn-app with autoApply=false"
```

Expected output (truncated):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Iterative fix loop f8b3… — PAUSED-FOR-CONFIRMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Iterations completed: 1
Fixes applied:        0
Regressions rolled back: 0
Final tests:          7/10 passing (3 failing)

Pending confirmations (3):
  - 71fbe…: Fix: useEffect missing cleanup for setInterval (confidence: 85)
  - 92ad1…: Fix: Force-unwrap on possibly-undefined name (confidence: 85)
  - …

Resume token: f8b3…
```

Re-call with `autoApply: true` (or `resumeToken: "f8b3…"`) to actually patch the files.

---

## Real use cases

### 1. React Native memory-leak self-healing

A team adds `setInterval(...)` in a `useEffect` and forgets cleanup. test-genie's `detect_memory_leaks` flags it, `suggest_fixes` proposes `return () => clearInterval(id)`, dry-runs the patch through the TS compiler, applies it with a backup, re-runs only the affected snapshot test, confirms 100% pass, stops. **Before:** 1 failing snapshot. **After:** 0 failing, 1 fix applied, 1 backup at `.test-genie-backups/`.

### 2. Flutter widget `dispose()` automation

`AnimationController` left undisposed. test-genie sees the missing `dispose()` override, generates a Dart `@override dispose() { controller.dispose(); super.dispose(); }` block, runs `dart analyze` on the patched file, applies, re-runs `flutter test`, converges.

### 3. iOS retain-cycle (closure capture)

`self.timer = Timer.scheduledTimer(...) { _ in self.tick() }` — rule-based detector flags closure self-capture, fixer rewrites to `[weak self] _ in guard let self = self else { return }; self.tick()`. If `swiftc` is on PATH the syntax check is real; otherwise test-genie reports "downgraded validation" so you know.

---

## How the iterate-fix loop works

```
┌────────────────────┐
│   collect tests    │  (run_scenario_test / supplied list)
└─────────┬──────────┘
          │
   pass-rate ≥ threshold? ── yes ──▶  SUCCESS
          │ no
          ▼
┌────────────────────┐
│  detect issues     │   memory + logic analyzers
└─────────┬──────────┘
          │
┌────────────────────┐
│  suggest fixes     │   rule-based (default) → LLM (hybrid, optional)
└─────────┬──────────┘
          │
┌────────────────────┐
│  dry-run + syntax  │   TS compiler API / platform compiler / brace check
└─────────┬──────────┘
          │
┌────────────────────┐
│  apply with backup │   per-file `.test-genie-backups/`
└─────────┬──────────┘
          │
┌────────────────────┐
│  re-run tests      │   regression?  yes → auto-rollback
└─────────┬──────────┘
          │
          ▼
   loop (≤ maxIterations, ≤ totalTimeout)
```

See **[docs/ITERATE_FIX_LOOP.md](docs/ITERATE_FIX_LOOP.md)** for a sequence diagram and the full safety-guard list.

---

## Tools (20)

| # | Tool | Mode |
|---|------|------|
| 1 | `analyze_app_structure` | real |
| 2 | `generate_scenarios` | real |
| 3 | `create_test_plan` | real |
| 4 | `run_scenario_test` | hybrid |
| 5 | `run_simulation` | simulated |
| 6 | `run_stress_test` | hybrid |
| 7 | `detect_memory_leaks` | real |
| 8 | `detect_logic_errors` | real |
| 9 | `suggest_fixes` | real |
| 10 | `confirm_fix` | real |
| 11 | `apply_fix` | real |
| 12 | `rollback_fix` | real |
| 13 | `run_full_automation` | hybrid |
| 14 | **`run_iterative_fix_loop`** ⭐ | hybrid |
| 15 | `generate_report` | real |
| 16 | `get_pending_fixes` | real |
| 17 | `get_test_history` | real |
| 18 | `analyze_performance` | real |
| 19 | `analyze_code_deep` | real |
| 20 | `generate_cicd_config` | real |

`mode` legend in **[docs/SIMULATION_VS_REAL.md](docs/SIMULATION_VS_REAL.md)**.

Plus 4 resources (`test-genie://iteration-logs`, `…/test-history/{path}`, `…/iteration-logs/{loopId}`, `…/applied-fixes/{path}`) and 2 prompts (`full-test-pipeline`, `diagnose-failure`).

---

## When NOT to use test-genie

- **Production-gate test runs.** test-genie is built for the *development* feedback loop. For shipping decisions, use a proper CI that you control end-to-end.
- **Code your team must hand-review every line of.** The loop's job is to *propose and apply* fixes; if every fix needs a human eye, leave `autoApply: false` (the default) and use it as a fix-proposal generator only.
- **No backup / no version control situations.** test-genie's auto-rollback is best-effort and requires the per-file backup to exist. Always run inside a git working tree.

---

## Comparison

| | test-genie | Detox | Maestro | xcodebuild test |
|---|---|---|---|---|
| Runs E2E / unit tests | ✅ (via Jest/Detox/etc.) | ✅ | ✅ | ✅ |
| Detects code issues | ✅ rule + LLM | ❌ | ❌ | ❌ |
| **Iterative fix loop** | **✅** | ❌ | ❌ | ❌ |
| Auto-rollback on regression | ✅ | ❌ | ❌ | ❌ |
| MCP-native (talks to Claude / agents) | ✅ | ❌ | ❌ | ❌ |
| Multi-platform | iOS+Android+Web+Flutter+RN | iOS+Android | iOS+Android | iOS only |

test-genie *uses* tools like Jest, Detox, and `xcodebuild test` under the hood — it sits at the orchestration layer, not the test-runner layer.

---

## Known limitations

- **Platform syntax check downgrade.** For Swift/Kotlin/Java/Dart we try the platform compiler in `-typecheck` mode. If the compiler isn't on PATH, we fall back to brace-balance validation and surface `downgraded: true` in the result. Install `swiftc` / `kotlinc` / `javac` / `dart` for real validation.
- **LLM is optional and gated.** `strategy: 'hybrid'` only kicks LLM in when rule-based confidence is below threshold. Without an API key the loop is rule-based-only — no failure.
- **Storage is per-machine.** Test history / iteration logs live under `$TEST_GENIE_STORAGE_DIR` (defaults to `~/.test-genie-mcp`). Not synced across machines.
- **Simulated mode is "simulation," not magic.** `run_simulation` returns *plausible* anomalies, not real ones. Use `run_scenario_test` (hybrid) for real-device runs.

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `TEST_GENIE_ALLOWED_ROOT` | `cwd` | Capability-based path safety — server refuses to read/write outside this root. |
| `TEST_GENIE_STORAGE_DIR` | `~/.test-genie-mcp` | Where scenarios / results / iteration logs live. |
| `TEST_GENIE_LLM_PROVIDER` | auto-detect | `anthropic` / `openai` / `none`. |
| `ANTHROPIC_API_KEY` | — | Used when provider = `anthropic`. |
| `OPENAI_API_KEY` | — | Used when provider = `openai`. |
| `TEST_GENIE_ANTHROPIC_MODEL` | `claude-haiku-4-5` | Override Anthropic model. |
| `TEST_GENIE_OPENAI_MODEL` | `gpt-4o-mini` | Override OpenAI model. |

---

## Migrating from v2.x

- `run_full_automation` still works. The `confirmMode` / `autoFix` options are kept for compatibility but **`autoApply: boolean` is the new way** — `autoApply: true` is equivalent to `confirmMode: 'auto'`.
- Subprocess hardening means platform tools now reject scheme / device / package-name arguments that contain shell metacharacters. If your CI was passing weird-looking values, sanitize them first.
- See **[CHANGELOG.md](CHANGELOG.md)** for the full breaking-change list + migration recipes.

---

## Roadmap

- LLM-based fix-proposal **voting** (multiple proposals → pick the best by syntax + retest delta)
- Multi-repo sync (run the loop across N repos in parallel from one MCP call)
- A "watch mode" that runs the loop on file save
- Better Detox / Maestro artifact ingestion (link videos into iteration logs)

---

## Contributing

Issues, PRs, and ideas welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** (TODO). Code lives under `src/`, tests under `tests/`. Run `npm test` before sending a PR.

## Maintainer

[@MUSE-CODE-SPACE](https://github.com/MUSE-CODE-SPACE) — Yoonkyoung Gong.

## License

MIT — see [LICENSE](LICENSE).
