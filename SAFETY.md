# test-genie Safety Guarantees

These are the actual safety guards in the **v3.1.1** codebase. Every claim
links to the code that implements it (file + line) and the test that
verifies it. No aspirational items — if a guard isn't here, it isn't
implemented yet.

Rule we hold ourselves to: a behavior may only appear in this document if
(a) the code does it and (b) a test asserts it. See
`[[feedback-no-fake-claims]]` for the project memory rule.

---

## 1. Path safety (system boundaries)

### 1.1 Allowed root capability

`src/security.ts:80` — `getAllowedRoot()` returns `TEST_GENIE_ALLOWED_ROOT`
when set, otherwise `process.cwd()`.

`src/security.ts:94` — `validatePathWithinAllowedRoot(filePath, allowedRoot)`
resolves the input and throws `ToolError(code='PATH_TRAVERSAL')` if the
resolved path is not the allowed root itself or a descendant of it.

The autoFix pipeline re-validates each finding's file path before any
write: `src/tools/automation/diagnoseAutoFix.ts:278`.

**Tested at:**
- `tests/security.test.ts:31` (`rejects ../ escapes`)
- `tests/security.test.ts:26` (`accepts paths inside the allowed root`)
- `tests/diagnoseAutoFix.test.ts:163` (`rejects findings whose file is
  outside TEST_GENIE_ALLOWED_ROOT (no write)`)

### 1.2 Excluded path segments

`src/tools/automation/diagnoseAutoFix.ts:50` — `EXCLUDED_SEGMENTS =
['node_modules', '.git', 'dist', 'build']`.

`src/tools/automation/diagnoseAutoFix.ts:90` — `isExcluded(filePath)` walks
the path's segments and returns true if any equals an excluded name.

Auto-fix calls this guard at
`src/tools/automation/diagnoseAutoFix.ts:290` before any write, regardless
of the allow-root.

**Tested at:** `tests/diagnoseAutoFix.test.ts:198` (`skips findings inside
node_modules/ regardless of allow-root`).

---

## 2. Filesystem modifications

### 2.1 Backup before write

`src/tools/fixing/applyFix.ts:142` — when `backup: true` (the default),
`applyFix` copies the target file to
`{dirname(file)}/.test-genie-backups/{basename}.{timestamp}.bak` before
writing. The backup directory is created if missing
(`src/tools/fixing/applyFix.ts:145-147`).

**Tested at:** `tests/diagnoseAutoFix.test.ts:91-96` (backup file exists,
content equals original).

### 2.2 Dry-run validation first

`src/tools/automation/diagnoseAutoFix.ts:348` — every auto-applied fix
goes through `applyFix({fixId, backup:true, validate:true, dryRun:true})`
first. The dry-run path
(`src/tools/fixing/applyFix.ts:129-139`) computes the diff and returns
without writing. Only fixes whose dry-run succeeded proceed to the real
apply at `src/tools/automation/diagnoseAutoFix.ts:360`.

### 2.3 Syntax validation

`src/tools/fixing/applyFix.ts:184` — after writing, the file is re-read
and `validateSyntax(file, newContent)` runs. The implementation delegates
to `src/core/syntaxValidator.ts` which uses the TypeScript compiler API
for JS/TS and platform compilers (swiftc/kotlinc/javac/dart) when
available.

### 2.4 Rollback on syntax failure

`src/tools/fixing/applyFix.ts:185-202` — if `validationResult.valid` is
false, the file is restored from the backup created in step 2.1
(`fs.writeFileSync(fix.file, originalContent)`), and an error is returned
to the caller. The autoFix pipeline records this as a `skippedFixes`
entry with the syntax error in its `reason`.

> **Important scope note.** This rollback fires on **syntax failure**, not
> on test-regression failure. The `diagnose_project autoFix` path in
> v3.1.1 does **not** re-run tests. If you want regression-driven
> rollback, use `run_iterative_fix_loop` instead — that path is
> documented in `docs/ITERATE_FIX_LOOP.md`.

### 2.5 Hard caps

`src/tools/automation/diagnoseAutoFix.ts:40` — `MAX_AUTOFIX_PER_RUN = 5`.
Enforced at `src/tools/automation/diagnoseAutoFix.ts:301`.

`src/tools/automation/diagnoseAutoFix.ts:45` — `MAX_FILES_PER_RUN = 3`.
Enforced at `src/tools/automation/diagnoseAutoFix.ts:312`.

Excess findings are reported as `skippedFixes` with
`reason: "cap exceeded (...)"` — never silently dropped.

**Tested at:** `tests/diagnoseAutoFix.test.ts:125-160` (`enforces
MAX_AUTOFIX_PER_RUN cap`).

### 2.6 Severity floor

`src/tools/automation/diagnoseAutoFix.ts:52` — `SEVERITY_RANK` ordering;
the gate at `src/tools/automation/diagnoseAutoFix.ts:266` rejects any
finding below `high`. Low/medium-severity issues are reported in the
finding list but never modified automatically.

---

## 3. Subprocess safety

### 3.1 Argv-only spawn

Every platform integration uses `spawn(cmd, [args])` with an explicit
allowlist for `cmd`.

`src/security.ts:149-164` — `ALLOWED_EXECUTABLES` (the allow-list).

`src/security.ts:166` — `SHELL_METACHARS` regex.

`src/security.ts:175-187` — `validateCommandArg` throws
`ToolError(code='COMMAND_INJECTION')` on any shell metacharacter.

`src/security.ts:194-204` — `validateCommand(cmd, args)` rejects
non-allowlisted executables and runs `validateCommandArg` on every arg.

`src/core/subprocess.ts:92` — `runProcess` calls `validateCommand` before
spawning, and `src/core/subprocess.ts:110` calls
`spawn(command, args, spawnOpts)` (argv form, no shell string).

**Tested at:**
- `tests/security.test.ts:51` (`rejects shell metacharacters`)
- `tests/security.test.ts:68` (`accepts allowlisted executables`)
- `tests/security.test.ts:74` (`rejects non-allowlisted executables`)
- `tests/security.test.ts:103` (`rejects shell metachars even on
  allowlisted commands`)

**Migration history.** v3.0.0 converted 78 prior `execAsync(commandStr)`
sites to `spawn + argv`. See `SECURITY.md` "Subprocess hardening" for
the audit. We have not introduced any new shell-string execution since.

---

## 4. What v3.1.1 auto-fix WILL touch

Only when `autoFix: true` is explicitly passed to `diagnose_project`,
**and** all guards above pass:

| Subtype | Replacement | Severity floor | Strategy |
|---|---|---|---|
| `weak-hash` (`createHash('md5'\|'sha1')`) | `createHash('sha256')` | high | `src/tools/automation/diagnoseAutoFix.ts:149` (`strategyWeakHash`) |
| `insecure-random` (standalone `Math.random()` assignment) | `crypto.randomInt(...)/MAX_SAFE_INTEGER` | high | `src/tools/automation/diagnoseAutoFix.ts:182` (`strategyInsecureRandom`) |

The `weak-hash` analyzer escalates severity to `high` only when the file
contains security-context keywords (password, token, secret, session,
auth, etc.) — `src/analyzers/securityAnalyzer.ts:256-258`. Otherwise it
stays `medium` (below the auto-fix floor).

The `insecure-random` strategy is guarded by a strict
end-of-statement regex (`src/tools/automation/diagnoseAutoFix.ts:189`):
if `Math.random()` is mixed into arithmetic, the strategy returns null
and the finding becomes `skippedFixes`.

---

## 5. What v3.1.1 auto-fix WILL NOT touch

- **Race conditions.** No race-condition fixes are auto-applied in
  v3.1.1. The analyzer's flags for `react-useeffect-no-abort` and
  `foreach-await` were flipped to `autoFixable: false`
  (`src/analyzers/raceConditionAnalyzer.ts:137,165`) because the
  mechanical rewrite is structural (cleanup-order semantics,
  serial-vs-parallel) and we can't prove safety statically.
- **`eval()` / `new Function()`.** Flagged but `autoFixable: false`
  (`src/analyzers/securityAnalyzer.ts:202`). Requires architectural
  refactor.
- **`child_process.exec` template-literal injection.** Flagged but
  `autoFixable: false`
  (`src/analyzers/securityAnalyzer.ts:288`). Fix needs spawn+argv
  refactor.
- **`Math.random` in arithmetic.** Analyzer marks `autoFixable: false`
  when the line doesn't match the standalone pattern
  (`src/analyzers/securityAnalyzer.ts:224,238`).
- **`.env` not in `.gitignore`.** Flagged but `autoFixable: false`
  (`src/analyzers/securityAnalyzer.ts:423`). Rotation must follow,
  which can't be automated.
- **`yaml.load` without safe schema.** Flagged but `autoFixable: false`
  (`src/analyzers/securityAnalyzer.ts:379`). Requires call-site
  refactor + possible import.
- **Anything in `node_modules/`, `.git/`, `dist/`, `build/`** —
  excluded segment guard, §1.2.
- **Anything outside `TEST_GENIE_ALLOWED_ROOT`** — path guard, §1.1.
- **Anything below `severity: 'high'`** — severity floor, §2.6.

---

## 6. What the test suite verifies

| Guard | Test |
|-------|------|
| Path traversal rejected | `tests/security.test.ts:31` |
| Path inside allowed root accepted | `tests/security.test.ts:26` |
| Allowed-root excludes node_modules in auto-fix path | `tests/diagnoseAutoFix.test.ts:198` |
| Allowed-root excludes files outside its tree | `tests/diagnoseAutoFix.test.ts:163` |
| Shell metachars rejected | `tests/security.test.ts:51` |
| Executable allow-list enforced | `tests/security.test.ts:68,74` |
| `MAX_AUTOFIX_PER_RUN` enforced | `tests/diagnoseAutoFix.test.ts:125` |
| Real weak-hash fix writes sha256 + creates backup | `tests/diagnoseAutoFix.test.ts:62` |
| `autoFix: false` is a no-op (no write, no `autoFixResult`) | `tests/diagnoseAutoFix.test.ts:103` |

Total in v3.1.1: **115 tests** across **10 suites**.

---

## 7. Reporting safety bugs

If you find a case where the auto-fix path writes outside its guards
(path escape, capacity overshoot, behavior-changing replacement on a
"safe" subtype), please open an issue with a reproduction repo, or
email the maintainer privately — credentials in `SECURITY.md`.
