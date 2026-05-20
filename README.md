# test-genie-mcp

**Built for vibe coders: one command, get a prioritized list of what's actually broken about your project.**

Self-healing test automation for iOS, Android, Flutter, React Native and Web apps — as an MCP server.

[![npm version](https://img.shields.io/npm/v/test-genie-mcp.svg)](https://www.npmjs.com/package/test-genie-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/MUSE-CODE-SPACE/test-genie-mcp/ci.yml?branch=main)](https://github.com/MUSE-CODE-SPACE/test-genie-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-1.29-blue)](https://modelcontextprotocol.io)

> **v3.1.1 — vibe-check + honest auto-fix.** One MCP call, ~30 seconds: race conditions + security issues + memory leaks + logic errors + perf smells, prioritized. Stays on your machine, no telemetry. Pass `autoFix: true` for the small, safe mechanical fixes (weak-hash, simple `Math.random` assignment) — backup + syntax-validate + rollback-on-syntax-fail. For test-verified application of harder fixes, use [v3.0.0](#how-the-iterate-fix-loop-works)'s iterate-fix loop.

---

## Vibe coders quickstart

You don't read the docs. You open the project, talk to Claude, and want a verdict. Here it is:

In Claude (with test-genie-mcp installed — [setup](#5-minute-quickstart)):

```
/vibe-check /Users/me/my-app
```

Claude calls `diagnose_project` under the hood. ~30 seconds later you see:

```text
# vibe-check report

- Project: /Users/me/my-app
- Platform: web
- Findings: 11 total — 4 critical, 4 high, 1 medium, 1 low
- Estimated fix time: ~85 min

## Top 5 issues

### 1. [CRIT] Hardcoded AWS access key id found in source
- File: `server.js:7`
- Category: security / secret (CWE-798)
- Confidence: 95%
- Fix: Move the value to an env var, gitignore the config, rotate the leaked key.

### 2. [CRIT] SQL string built by concatenating user input
- File: `server.js:21`
- Category: security / injection (CWE-89)
- Fix: Use parameterized queries (`db.query("... WHERE id = ?", [id])`).

### 3. [HIGH] useState setter called after await without mount guard
- File: `UserProfile.tsx:16`
- Category: race-condition / react-setstate-after-await (CWE-362)
- Confidence: 78%
- Fix: Use AbortController and check signal.aborted before calling setters.

… (top 5 shown — full list at output: "detailed")

## Next steps
1. Address the critical / high findings above.
2. Re-run diagnose_project after fixing to confirm convergence.
3. Use run_iterative_fix_loop for test-driven verification of each fix.
```

If any finding is `autoFixable: true` and is at `high`/`critical` severity, the `diagnose_project` call accepts `autoFix: true` to apply the mechanical replacement directly (with backup + syntax validation — see [SAFETY.md](SAFETY.md) for the exact guards). The v3.1.1 honest scope is narrow: weak hash (`createHash('md5'|'sha1')` → `createHash('sha256')`) and standalone `Math.random()` in security-sensitive files. For broader/structural fixes (race conditions, eval, exec injection) run `run_iterative_fix_loop` separately — it re-runs tests and auto-rolls-back on regression.

---

## Why test-genie?

The bottleneck in mobile + cross-platform test automation isn't writing tests — it's the loop *between* a failing test and a passing test. test-genie closes that loop:

```
failing test → analyzer flags issue → fix proposed → dry-run + syntax check →
applied with backup → affected tests re-run → regression check → loop or stop
```

This full loop is the `run_iterative_fix_loop` tool. The `diagnose_project autoFix: true` path in v3.1.1 covers a strict subset — backup + dry-run + syntax-validate + apply, **without** re-running tests (so no test-regression rollback in that path). Use the right tool for the job — and see [SAFETY.md](SAFETY.md) for the exact guards on each.

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

> The flows below describe the **`run_iterative_fix_loop` path** (v3.0
> headline) — full detect → propose → dry-run → apply-with-backup →
> re-run-tests → rollback-on-regression. The `diagnose_project autoFix`
> path in v3.1.1 is the narrower mechanical-replacement-only path; see
> [SAFETY.md](SAFETY.md) §4 for what that one actually touches.

### 1. React Native memory-leak self-healing

A team adds `setInterval(...)` in a `useEffect` and forgets cleanup. test-genie's `detect_memory_leaks` flags it, `suggest_fixes` proposes `return () => clearInterval(id)` (`src/tools/fixing/suggestFixes.ts:169-179`), the loop dry-runs the patch through the TS compiler, applies with backup, re-runs only the affected snapshot test, confirms 100% pass, stops. **Before:** 1 failing snapshot. **After:** 0 failing, 1 fix applied, 1 backup at `.test-genie-backups/`.

### 2. Flutter widget `dispose()` automation

`AnimationController` left undisposed. test-genie sees the missing `dispose()` override, generates a Dart `@override dispose() { controller.dispose(); super.dispose(); }` block (`suggestFixes.ts:214-217`), runs `dart analyze` on the patched file, applies, re-runs `flutter test`, converges.

### 3. iOS retain-cycle (closure capture)

`self.timer = Timer.scheduledTimer(...) { _ in self.tick() }` — rule-based detector flags closure self-capture, fixer rewrites to `[weak self] _ in guard let self = self else { return }; self.tick()` (`suggestFixes.ts:239-242`). If `swiftc` is on PATH the syntax check is real; otherwise test-genie reports "downgraded validation" so you know.

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

## Tools (23)

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
| 14 | `run_iterative_fix_loop` (v3.0 headline) | hybrid |
| 15 | `generate_report` | real |
| 16 | `get_pending_fixes` | real |
| 17 | `get_test_history` | real |
| 18 | `analyze_performance` | real |
| 19 | `analyze_code_deep` | real |
| 20 | `generate_cicd_config` | real |
| 21 | **`diagnose_project`** (v3.1 headline — vibe-check) | real |
| 22 | `detect_race_conditions` | real |
| 23 | `detect_security_issues` | real |

`mode` legend in **[docs/SIMULATION_VS_REAL.md](docs/SIMULATION_VS_REAL.md)**.

Plus 4 resources (`test-genie://iteration-logs`, `…/test-history/{path}`, `…/iteration-logs/{loopId}`, `…/applied-fixes/{path}`) and 3 prompts (`full-test-pipeline`, `diagnose-failure`, `vibe-check`).

---

## What vibe-check catches

Race conditions (`detect_race_conditions` / `diagnose_project`):

| Pattern | Language | Severity | Auto-fixable (v3.1.1) |
|---|---|---|---|
| `useState` setter called after `await` without mount guard | TS/JS/React | high | no (structural) |
| `useEffect` with async fetch, no AbortController/cleanup | TS/JS/React | high | no (structural) |
| `arr.forEach(async ...)` (silent fire-and-forget) | TS/JS | medium | no (ordering-sensitive) |
| Adjacent fetches without `Promise.all` / sequencing | TS/JS | medium | no |
| TOCTOU: `existsSync` then `readFileSync` without lock | TS/JS Node | medium | no |
| Non-atomic counter increment in async context | TS/JS | low | no |
| `@Published` mutation outside `@MainActor` | Swift | medium | no |
| Concurrent `DispatchQueue` writes without `.barrier` | Swift | medium | no |
| `MutableStateFlow` mutated off `Dispatchers.Main` | Kotlin | medium | no |
| `Flow` collected without `flowOn` | Kotlin | low | no |
| Goroutine + shared map without `sync.Mutex` | Go | high | no |

> v3.1.1 honesty audit: `useEffect-no-abort` and `forEach-await` were
> previously advertised as auto-fixable. They are not — wrapping with
> `AbortController` or rewriting to `Promise.all(arr.map(...))` changes
> behavior we can't verify statically. They are now report-only. See
> [SAFETY.md](SAFETY.md).

Security (`detect_security_issues` / `diagnose_project`):

| Pattern | Severity | CWE | Auto-fixable (v3.1.1) |
|---|---|---|---|
| Hardcoded AWS / Stripe / GitHub / Google / Slack token | critical / high | CWE-798 | no (rotate) |
| Hardcoded JWT secret literal | high | CWE-798 | no |
| API token in URL query string | high | CWE-200 | no |
| `.env` file present but not gitignored | high | CWE-538 | no (rotation must follow) |
| SQL string concat with `req.params` / `req.body` | critical | CWE-89 | no |
| `innerHTML` / `dangerouslySetInnerHTML` with dynamic value | high | CWE-79 | no |
| `eval()` / `new Function()` with non-literal | critical | CWE-95 | no |
| `Math.random()` in security-sensitive file, **standalone assignment** | high | CWE-338 | **yes** (`crypto.randomInt`) |
| `Math.random()` mixed into arithmetic | high | CWE-338 | no (semantic) |
| `createHash('md5'\|'sha1')` in security-keyword file | high | CWE-327 | **yes** (`'sha256'`) |
| `createHash('md5'\|'sha1')` elsewhere | medium | CWE-327 | no (below severity floor) |
| `child_process.exec` with user-input template literal | critical | CWE-78 | no |
| `fetch(req.query.url)` (SSRF) | high | CWE-918 | no |
| CORS `*` origin + `Allow-Credentials: true` | high | CWE-942 | no |
| Cookie set without `httpOnly` / `secure` / `sameSite` | low | CWE-1004 | no |
| `yaml.load` without safe schema | medium | CWE-502 | no |

> v3.1.1 honesty audit: `.env`/`Math.random` (general)/`yaml.load` were
> previously advertised as auto-fixable. They were either too risky to
> rewrite blindly or no strategy shipped — flipped to report-only. See
> [SAFETY.md](SAFETY.md) §5.

---

## What vibe-check misses (honest list)

This is a "catch the obvious stuff in 30s" filter, not Snyk / Semgrep / a full SAST tool. We don't catch:

- **Cross-file data-flow.** If user input flows through three files before reaching a `db.query`, the regex won't connect the dots. A real SAST traces taint across the call graph. Roadmap: ts-morph reference walking for top-N entry points.
- **Vulnerable transitive deps.** We don't query npm advisories — that's `npm audit`'s job, and bundling a stale advisory list would lie. Run `npm audit --json` in parallel if you want dep-CVE coverage.
- **Race conditions across processes.** We catch in-process JS / Swift / Kotlin / Go races. Distributed races (lock ordering across services, DB transactions) need different tooling.
- **Type-correct but logic-broken code.** The analyzer is syntactic, not semantic. A `Math.random()` named `getNonce` won't fool us; a properly-named `crypto.randomBytes` used with a tiny entropy budget will.
- **Custom secret formats.** Internal company tokens with unique prefixes need a regex you can add to `securityAnalyzer.SECRET_PATTERNS`. PR welcome.
- **Real-time / dynamic issues.** Memory leaks under load, network timeouts, slow renders mid-interaction — those need `run_stress_test` / `run_simulation`, not static analysis.

If you want deeper coverage on top of vibe-check: feed the findings into `run_iterative_fix_loop` for test-verified application, or escalate to Snyk / Semgrep / GitHub Advanced Security for compliance use cases.

---

## vibe-check vs alternatives

|                        | vibe-check (test-genie) | Snyk | Semgrep | GitHub Advanced Security |
|------------------------|-------------------------|------|---------|--------------------------|
| Runs locally           | yes                     | hybrid (cloud) | yes  | no (cloud) |
| Telemetry-free         | yes (zero network calls) | no  | partial | no |
| Fix loop integration   | yes (`run_iterative_fix_loop`) | no | no | no |
| Race-condition detection | yes (JS/Swift/Kotlin/Go) | no | partial | partial |
| Cross-file taint flow  | no (roadmap)            | yes  | yes     | yes |
| Setup time             | none (already installed if test-genie is installed) | account + auth | install + ruleset | repo-level enable |

If your goal is "before I commit, what's broken?", vibe-check wins on latency. If your goal is "compliance + supply chain audit", use the dedicated tools.

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
| **Iterative fix loop** | **✅** (`run_iterative_fix_loop`) | ❌ | ❌ | ❌ |
| Auto-rollback on test regression | ✅ inside `run_iterative_fix_loop` only | ❌ | ❌ | ❌ |
| Auto-rollback on syntax failure | ✅ all apply paths | ❌ | ❌ | ❌ |
| MCP-native (talks to Claude / agents) | ✅ | ❌ | ❌ | ❌ |
| Multi-platform | iOS+Android+Web+Flutter+RN | iOS+Android | iOS+Android | iOS only |

> Scope note: `diagnose_project autoFix: true` rolls back on syntax-validate
> failure (`applyFix.ts:185-202`) but does **not** re-run tests, so it
> cannot detect test regressions. For test-driven rollback use
> `run_iterative_fix_loop`. See [SAFETY.md](SAFETY.md) §2.4.

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
