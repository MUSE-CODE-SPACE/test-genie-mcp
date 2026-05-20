# The Iterate-Fix-Test Loop

`run_iterative_fix_loop` is the v3.0.0 headline tool. It runs a closed-loop "test → detect → fix → re-test" cycle with strong safety guards. This document is the walkthrough.

## The loop

```
┌─────────────────────────────────────────────────────────────────────┐
│ START (loopId = uuid, iteration n = 1)                              │
└────────────┬────────────────────────────────────────────────────────┘
             │
             ▼
   ┌──────────────────────┐
   │ 1. collect tests     │  (run_scenario_test if not supplied)
   └────────────┬─────────┘
                │
                ▼
   ┌──────────────────────┐
   │ 2. pass-rate ≥ thr?  │── yes ──▶ status = success
   └────────────┬─────────┘
                │ no
                ▼
   ┌──────────────────────┐
   │ 3. detect issues     │  memory + logic, optional override for tests
   └────────────┬─────────┘
                │
   issues = ∅? ── yes ──▶ status = stuck (no fixes to attempt)
                │ no
                ▼
   ┌──────────────────────┐
   │ 4. suggest fixes     │  strategy:
   │                      │   - rule-based      → only rules
   │                      │   - llm             → only LLM
   │                      │   - hybrid (default)→ rules; LLM for low-conf
   └────────────┬─────────┘
                │
                ▼
   ┌──────────────────────┐
   │ 5. dry-run + syntax  │  TS compiler API for TS/JS;
   │    validate          │  swiftc / kotlinc / javac / dart for native;
   │                      │  brace-balance fallback (downgraded: true)
   └────────────┬─────────┘
                │
   autoApply = false ─ yes ─▶ PAUSE: return pending confirmations + resumeToken
                │ true
                ▼
   ┌──────────────────────┐
   │ 6. apply with backup │  fs.writeFile; backup at .test-genie-backups/
   └────────────┬─────────┘
                │
                ▼
   ┌──────────────────────┐
   │ 7. re-run tests      │  (subject to timeoutPerIteration)
   └────────────┬─────────┘
                │
   pass count  ── dropped? ── yes ──▶ rollback this iteration's fixes
   went UP/EQ                          (regressionsRolledBack++)
                │
                ▼
   converged?  ── yes ──▶ status = success
                │ no
   no progress made for 1 full iteration? ── yes ──▶ status = stuck
                │
   n < maxIterations? ── yes ──▶ n++, goto 1
                │ no
                ▼
            status = exhausted
```

## Status legend

| status | What it means | What to do |
|---|---|---|
| `success` | Pass-rate met `acceptableThreshold` | Ship it. Review applied fixes if desired (`resource://test-genie/applied-fixes/{path}`). |
| `paused-for-confirmation` | `autoApply: false` and candidates exist | Inspect `pendingConfirmations`, then re-call with `autoApply: true` and `resumeToken`. |
| `stuck` | No more fixes to try, but tests still failing | Manual review needed. Iteration logs are at `resource://test-genie/iteration-logs/{loopId}`. |
| `exhausted` | Ran out of `maxIterations` | Either raise `maxIterations` or examine why the loop isn't converging. |
| `cancelled` | Iteration / total timeout hit | Re-call with the returned `resumeToken` after fixing what timed out. |
| `error` | App analysis or unrecoverable failure | Check stderr; usually a path-validation issue. |

## Safety guards

1. **Default conservative.** `autoApply: false`, `maxIterations: 5`, `strategy: 'hybrid'`. Nothing is touched without explicit consent unless you opt in.
2. **Dry-run + strong syntax check** before any disk write. Bad fixes never reach the file.
3. **Per-file backup.** Every patched file gets `<filename>.<timestamp>.bak` in `.test-genie-backups/` next to it. Rollback is a `cp backup → original`.
4. **Regression auto-rollback.** If post-fix pass count drops, the iteration's fixes are reverted. The drop event is logged with `notes: 'regression detected...'`.
5. **Per-iteration + total timeouts.** Default 5 min per iteration, 30 min total. Hitting either marks the loop `cancelled` and emits a `resumeToken`.
6. **Resumable.** Pass `resumeToken: <returned value>` to pick up an interrupted loop without re-running the green portion.
7. **Audit trail.** Every loop persists to `~/.test-genie-mcp/iteration-logs.json` and is readable via the MCP resource API.

## Strategy reference

| Strategy | When rule-based fires | When LLM fires |
|---|---|---|
| `rule-based` | Always (only path) | Never |
| `llm` | Never | Always (requires API key) |
| `hybrid` (default) | Always first | When rule confidence < `hybridConfidenceThreshold` (default 80), OR no rule match |

LLM-proposed fixes carry confidence from the model. We refuse anything < 40 even if the model returned it, because low-confidence diffs cause regressions more often than they fix bugs.

## Sequence diagram (Claude ↔ test-genie ↔ project)

```
Claude (MCP client)            test-genie-mcp               your project
       │                              │                          │
       │  tools/call run_iterative_   │                          │
       │  fix_loop(autoApply=false)   │                          │
       │ ───────────────────────────▶ │                          │
       │                              │  read source files       │
       │                              │ ───────────────────────▶ │
       │                              │  run test runner         │
       │                              │ ───────────────────────▶ │
       │                              │  ◀──── results ──────── │
       │                              │  detect issues           │
       │                              │  suggest fixes (rules)   │
       │                              │  [LLM fallback if hybrid]│
       │                              │  dry-run + syntax check  │
       │  status=paused-for-          │                          │
       │  confirmation,               │                          │
       │  pendingConfirmations[…],    │                          │
       │  resumeToken=abc             │                          │
       │ ◀─────────────────────────── │                          │
       │                              │                          │
       │  user reviews                │                          │
       │                              │                          │
       │  tools/call run_iterative_   │                          │
       │  fix_loop(autoApply=true,    │                          │
       │  resumeToken=abc)            │                          │
       │ ───────────────────────────▶ │                          │
       │                              │  apply fixes with backup │
       │                              │ ───────────────────────▶ │
       │                              │  re-run tests            │
       │                              │ ───────────────────────▶ │
       │                              │  ◀──── pass=10/10 ───── │
       │  status=success              │                          │
       │ ◀─────────────────────────── │                          │
```
