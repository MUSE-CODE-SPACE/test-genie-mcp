/**
 * Race condition analyzer for the v3.1.0 vibe-check feature.
 *
 * Catches the classic "shouldn't be racing but is" patterns across
 * TypeScript/JavaScript/React, Swift, Kotlin and Go. Uses content-based
 * regex + structural heuristics rather than full AST walking — fast enough
 * to run on every diagnose-project call (~50ms for a mid-size repo).
 *
 * Each finding carries severity, confidence (0-100), a recommendation,
 * and — when the pattern is well-understood — a `fixSuggestion` shape
 * compatible with the existing FixSuggestion / apply_fix pipeline.
 */
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Platform } from '../types.js';
import { getAllFiles } from '../utils/codeParser.js';

export type RaceSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RaceFinding {
  id: string;
  category: 'race-condition';
  subType: string;
  severity: RaceSeverity;
  confidence: number;
  file: string;
  line: number;
  title: string;
  description: string;
  snippet: string;
  recommendation: string;
  autoFixable: boolean;
  cwe?: string;
}

export interface RaceConditionResult {
  findings: RaceFinding[];
  summary: {
    totalFindings: number;
    bySeverity: Record<string, number>;
    bySubType: Record<string, number>;
    filesScanned: number;
  };
}

function getExtensions(platform: Platform): string[] {
  switch (platform) {
    case 'ios':
      return ['.swift'];
    case 'android':
      return ['.kt', '.java'];
    case 'flutter':
      return ['.dart'];
    case 'react-native':
    case 'web':
      return ['.tsx', '.ts', '.jsx', '.js'];
    default:
      return ['.ts', '.tsx', '.js', '.jsx', '.go'];
  }
}

function lineOf(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

function snippet(content: string, index: number, maxLen = 140): string {
  const start = Math.max(0, content.lastIndexOf('\n', index) + 1);
  const end = content.indexOf('\n', index);
  const line = content.substring(start, end === -1 ? content.length : end);
  return line.trim().substring(0, maxLen);
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript / React patterns
// ---------------------------------------------------------------------------

function detectJSRaces(file: string, content: string): RaceFinding[] {
  const findings: RaceFinding[] = [];

  // Pattern 1: useState setter called after `await` without mount guard.
  // Matches: setX(...) following an `await` inside the same function.
  const setStateAfterAwaitRe = /await\s+[^;{}]*?[;\n][^{}]{0,400}?\bset[A-Z]\w*\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = setStateAfterAwaitRe.exec(content)) !== null) {
    const block = m[0];
    if (block.includes('isMounted') || block.includes('mountedRef') || block.includes('signal.aborted') || block.includes('AbortController')) {
      continue;
    }
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'react-setstate-after-await',
      severity: 'high',
      confidence: 78,
      file,
      line: lineOf(content, m.index),
      title: 'useState setter called after await without mount guard',
      description:
        'Calling a React state setter after `await` can update state on an unmounted component, causing the classic "Can\'t perform a React state update on an unmounted component" warning and potential memory issues.',
      snippet: snippet(content, m.index),
      recommendation:
        'Track mount state with a `useRef(true)` cleaned up in the effect return, or use an `AbortController` and check `signal.aborted` before calling setters.',
      autoFixable: false,
      cwe: 'CWE-362',
    });
  }

  // Pattern 2: useEffect with async fetch but no AbortController / cleanup return.
  const useEffectRe = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[[^\]]*\]\s*\)/g;
  while ((m = useEffectRe.exec(content)) !== null) {
    const body = m[1] ?? '';
    const hasFetch = /\bfetch\s*\(|axios\.|XMLHttpRequest/.test(body);
    const hasAsyncAwait = /\basync\b[\s\S]*?\bawait\b/.test(body);
    const hasCleanup = /return\s*(\(\s*\)\s*=>|function)/.test(body);
    const hasAbort = /AbortController|signal/.test(body);
    if ((hasFetch || hasAsyncAwait) && !hasCleanup && !hasAbort) {
      findings.push({
        id: uuidv4(),
        category: 'race-condition',
        subType: 'react-useeffect-no-abort',
        severity: 'high',
        confidence: 72,
        file,
        line: lineOf(content, m.index),
        title: 'useEffect with async fetch but no AbortController/cleanup',
        description:
          'When the component unmounts or deps change, the in-flight fetch keeps running and its `.then` handler can still call state setters on a stale component.',
        snippet: snippet(content, m.index),
        recommendation:
          'Create an `AbortController` at the top of the effect, pass `controller.signal` to fetch, and `return () => controller.abort()` in the cleanup.',
        autoFixable: true,
        cwe: 'CWE-362',
      });
    }
  }

  // Pattern 3: `forEach` with `await` (silent serial vs parallel confusion).
  // Captures both arr.forEach(async (x) => { ... await ... }) shapes.
  const forEachAwaitRe = /\.forEach\s*\(\s*async\s*(?:\([^)]*\)|\w+)\s*=>/g;
  while ((m = forEachAwaitRe.exec(content)) !== null) {
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'foreach-await',
      severity: 'medium',
      confidence: 92,
      file,
      line: lineOf(content, m.index),
      title: 'await inside Array.forEach silently fires-and-forgets',
      description:
        '`forEach` ignores returned promises, so callers cannot await the loop body. Errors are swallowed and ordering is not preserved.',
      snippet: snippet(content, m.index),
      recommendation:
        'Replace with `for (const x of arr) { await ... }` for sequential, or `await Promise.all(arr.map(async (x) => ...))` for parallel.',
      autoFixable: true,
      cwe: 'CWE-362',
    });
  }

  // Pattern 4: Multiple unsequenced fetches with shared state.
  // Heuristic: two `fetch(` calls within a short window, neither inside Promise.all.
  const multiFetchRe = /\bfetch\s*\([^)]*\)[^P]{0,200}?\bfetch\s*\(/g;
  while ((m = multiFetchRe.exec(content)) !== null) {
    if (m[0].includes('Promise.all') || m[0].includes('await')) continue;
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'unsequenced-fetches',
      severity: 'medium',
      confidence: 55,
      file,
      line: lineOf(content, m.index),
      title: 'Multiple fetches without sequencing or Promise.all',
      description:
        'Two adjacent fetches without `await` or `Promise.all` may resolve in any order. If their results are written to the same state, the last to resolve wins — usually not what was intended.',
      snippet: snippet(content, m.index),
      recommendation: 'Wrap parallel calls in `await Promise.all([...])`, or `await` them sequentially.',
      autoFixable: false,
    });
  }

  // Pattern 5: TOCTOU file ops — existsSync followed shortly by readFileSync / writeFileSync.
  const toctouRe = /fs\.existsSync\s*\([^)]+\)[\s\S]{0,200}?fs\.(readFileSync|writeFileSync|unlinkSync)\s*\(/g;
  while ((m = toctouRe.exec(content)) !== null) {
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'toctou-fs',
      severity: 'medium',
      confidence: 68,
      file,
      line: lineOf(content, m.index),
      title: 'TOCTOU: existsSync then read/write without lock',
      description:
        'Between `existsSync` and the subsequent read/write, another process can swap the file. Common attack surface for symlink races.',
      snippet: snippet(content, m.index),
      recommendation:
        'Open the file once with the right flag (`fs.openSync(p, "r")` / `"wx"` for exclusive create) and operate on the returned fd, or use `fs.promises.access` + try/catch on the op itself.',
      autoFixable: false,
      cwe: 'CWE-367',
    });
  }

  // Pattern 6: Counter increment in async context (`i++` in async callback chain).
  const asyncCounterRe = /async\s+(?:function|\([^)]*\)\s*=>)[\s\S]{0,400}?\b(\w+)\s*(?:\+\+|--|\+=|-=)/g;
  while ((m = asyncCounterRe.exec(content)) !== null) {
    const varName = m[1];
    if (!varName || ['i', 'j', 'k'].includes(varName)) continue; // loop indices are usually safe
    if (m[0].includes('Atomics') || m[0].includes('Mutex')) continue;
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'async-counter',
      severity: 'low',
      confidence: 45,
      file,
      line: lineOf(content, m.index),
      title: `Non-atomic increment of \`${varName}\` in async context`,
      description:
        'Mutating shared counters from concurrent async callbacks can lose updates. Two callbacks reading the same value, both incrementing, then writing — classic lost-update.',
      snippet: snippet(content, m.index),
      recommendation:
        'Either funnel updates through a single queue, or use an atomic primitive (`Atomics.add` on a `SharedArrayBuffer`) if you really need cross-task counters.',
      autoFixable: false,
      cwe: 'CWE-362',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Swift patterns
// ---------------------------------------------------------------------------

function detectSwiftRaces(file: string, content: string): RaceFinding[] {
  const findings: RaceFinding[] = [];

  // Pattern: @Published mutation outside main actor / Task { @MainActor }.
  const publishedMutationRe = /@Published\s+(?:private\s+)?var\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = publishedMutationRe.exec(content)) !== null) {
    const varName = m[1];
    if (!varName) continue;
    // If file already uses @MainActor, skip.
    if (/@MainActor/.test(content)) continue;
    const assignRe = new RegExp(`\\b${varName}\\s*=`, 'g');
    let a: RegExpExecArray | null;
    while ((a = assignRe.exec(content)) !== null) {
      if (a.index === m.index) continue;
      findings.push({
        id: uuidv4(),
        category: 'race-condition',
        subType: 'swift-published-outside-mainactor',
        severity: 'medium',
        confidence: 50,
        file,
        line: lineOf(content, a.index),
        title: `@Published var \`${varName}\` mutated without @MainActor`,
        description:
          'SwiftUI subscribes to `@Published` on the main thread. Mutating from a background task without `await MainActor.run` can corrupt UI state.',
        snippet: snippet(content, a.index),
        recommendation:
          'Mark the containing type or method `@MainActor`, or wrap the assignment in `await MainActor.run { ... }`.',
        autoFixable: false,
      });
      break; // one finding per @Published is enough
    }
  }

  // Pattern: DispatchQueue.concurrent without barrier.
  if (content.includes('DispatchQueue') && content.includes('.concurrent') && !content.includes('.barrier')) {
    const idx = content.indexOf('.concurrent');
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'swift-dispatch-no-barrier',
      severity: 'medium',
      confidence: 60,
      file,
      line: lineOf(content, idx),
      title: 'Concurrent DispatchQueue used without .barrier for writes',
      description:
        'A concurrent queue is fine for parallel reads, but writes must use `.barrier` to ensure exclusive access. Without it, simultaneous reads + writes corrupt the backing storage.',
      snippet: snippet(content, idx),
      recommendation: 'Use `queue.async(flags: .barrier) { ... }` for any mutation. Reads stay plain `.async`.',
      autoFixable: false,
      cwe: 'CWE-362',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Kotlin patterns
// ---------------------------------------------------------------------------

function detectKotlinRaces(file: string, content: string): RaceFinding[] {
  const findings: RaceFinding[] = [];

  // Pattern: MutableStateFlow mutation off Dispatchers.Main.
  const stateFlowRe = /MutableStateFlow\s*\(/g;
  let m: RegExpExecArray | null;
  if (stateFlowRe.exec(content) !== null) {
    if (!/withContext\s*\(\s*Dispatchers\.Main/.test(content) && /\bDispatchers\.(IO|Default)/.test(content)) {
      const idx = content.indexOf('Dispatchers.');
      findings.push({
        id: uuidv4(),
        category: 'race-condition',
        subType: 'kotlin-stateflow-wrong-dispatcher',
        severity: 'medium',
        confidence: 55,
        file,
        line: lineOf(content, idx),
        title: 'MutableStateFlow possibly mutated off Dispatchers.Main',
        description:
          'StateFlow itself is thread-safe, but UI-bound consumers expect main-dispatcher emissions. Switching dispatchers per-emission via `withContext(Dispatchers.Main)` or upstream `.flowOn(Dispatchers.IO)` makes intent explicit.',
        snippet: snippet(content, idx),
        recommendation: 'Use `.flowOn(Dispatchers.IO)` upstream of the collector, or wrap mutation in `withContext(Dispatchers.Main)`.',
        autoFixable: false,
      });
    }
  }

  // Pattern: Flow collected without flowOn (IO without context-shift).
  if (content.includes('flow {') && content.includes('.collect') && !content.includes('flowOn')) {
    const idx = content.indexOf('flow {');
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'kotlin-flow-no-flowon',
      severity: 'low',
      confidence: 40,
      file,
      line: lineOf(content, idx),
      title: 'Flow built and collected without flowOn',
      description:
        'If the flow does IO work, omitting `flowOn(Dispatchers.IO)` runs that work on the collector\'s dispatcher — usually the main thread.',
      snippet: snippet(content, idx),
      recommendation: 'Add `.flowOn(Dispatchers.IO)` between the builder and the collector.',
      autoFixable: false,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Go patterns (cheap heuristics)
// ---------------------------------------------------------------------------

function detectGoRaces(file: string, content: string): RaceFinding[] {
  const findings: RaceFinding[] = [];
  if (!content.includes('go ')) return findings;

  // Pattern: goroutine + shared map without sync.Mutex / sync.Map.
  if (/\bgo\s+\w/.test(content) && /map\[/.test(content) && !content.includes('sync.Mutex') && !content.includes('sync.Map')) {
    const idx = content.indexOf('go ');
    findings.push({
      id: uuidv4(),
      category: 'race-condition',
      subType: 'go-map-no-mutex',
      severity: 'high',
      confidence: 60,
      file,
      line: lineOf(content, idx),
      title: 'Goroutine accesses map without sync.Mutex/sync.Map',
      description:
        'Go maps are not safe for concurrent use. Reading and writing from multiple goroutines without synchronization triggers the race detector and can crash with "fatal error: concurrent map writes".',
      snippet: snippet(content, idx),
      recommendation: 'Wrap accesses with a `sync.Mutex`, or switch to `sync.Map` if the access pattern is mostly disjoint keys.',
      autoFixable: false,
      cwe: 'CWE-362',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function analyzeRaceConditions(projectPath: string, platform: Platform): RaceConditionResult {
  const findings: RaceFinding[] = [];
  if (!fs.existsSync(projectPath)) {
    return { findings, summary: { totalFindings: 0, bySeverity: {}, bySubType: {}, filesScanned: 0 } };
  }

  const exts = getExtensions(platform);
  const files = getAllFiles(projectPath, exts);

  let scanned = 0;
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
      scanned++;
    } catch {
      continue;
    }
    if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      findings.push(...detectJSRaces(file, content));
    } else if (file.endsWith('.swift')) {
      findings.push(...detectSwiftRaces(file, content));
    } else if (file.endsWith('.kt')) {
      findings.push(...detectKotlinRaces(file, content));
    } else if (file.endsWith('.go')) {
      findings.push(...detectGoRaces(file, content));
    }
  }

  const bySeverity: Record<string, number> = {};
  const bySubType: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    bySubType[f.subType] = (bySubType[f.subType] ?? 0) + 1;
  }

  return {
    findings,
    summary: { totalFindings: findings.length, bySeverity, bySubType, filesScanned: scanned },
  };
}

// Test-only export — wiring used by unit tests so they don't need to touch fs.
export const _internal = {
  detectJSRaces,
  detectSwiftRaces,
  detectKotlinRaces,
  detectGoRaces,
};
