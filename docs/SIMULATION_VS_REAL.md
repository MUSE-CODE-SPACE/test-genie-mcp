# Simulation vs Real Execution

test-genie tools fall into one of three execution modes. The mode is part of every tool's description so MCP clients see it in `tools/list`.

| mode | meaning |
|---|---|
| **simulated** | The tool never spawns a real process / device. Results are heuristically generated from the analyzed app structure. Useful when no simulator/emulator is available or when you want fast feedback. |
| **real** | The tool runs only static analysis or filesystem operations on the project source. Deterministic; no external subprocesses needed. |
| **hybrid** | The tool tries real subprocess execution first (e.g., real `xcodebuild test`, real `flutter test`) and falls back to simulated when the platform tooling isn't on PATH. Results include `actualMode` for transparency. |

## Per-tool mode

| Tool | Mode | Real-mode dependency |
|---|---|---|
| `analyze_app_structure` | real | fs only |
| `generate_scenarios` | real | fs + parsed AST |
| `create_test_plan` | real | stored scenarios |
| `run_scenario_test` | hybrid | platform test runner if installed |
| `run_simulation` | simulated | — (always heuristic) |
| `run_stress_test` | hybrid | k6, curl, fetch |
| `detect_memory_leaks` | real | source AST |
| `detect_logic_errors` | real | source AST |
| `suggest_fixes` | real | source AST + rule table |
| `confirm_fix` / `apply_fix` / `rollback_fix` | real | fs |
| `run_full_automation` | hybrid | composite |
| `run_iterative_fix_loop` | hybrid | composite |
| `generate_report` | real | stored state |
| `get_*` | real | stored state |
| `analyze_performance` / `analyze_code_deep` | real | AST |
| `generate_cicd_config` | real | template render |

## Why the distinction matters

- **CI dashboards** want `real`-only tools because nothing in `simulated` mode produces auditable results.
- **Local development loops** are usually happy with `hybrid` — the fast path is real if the toolchain is set up, but the loop doesn't hard-fail if you're on a different machine.
- **Tests of test-genie itself** use `simulated` so the suite stays hermetic (no real simulator required in CI).

## Knowing what really ran

Hybrid tools include `actualMode` in their result so the caller can tell which path was taken. Example for `run_scenario_test`:

```jsonc
{
  "status": "passed",
  "duration": 1234,
  // ...
  "actualMode": "real"  // or "simulated" if the platform tool wasn't on PATH
}
```
