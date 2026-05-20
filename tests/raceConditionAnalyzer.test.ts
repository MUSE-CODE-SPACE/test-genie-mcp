/**
 * Race condition analyzer tests — v3.1.0.
 *
 * Covers the pattern detectors with both positive and negative fixtures
 * so regressions surface immediately, plus a smoke test against the
 * planted race-react fixture.
 */
import * as path from 'path';
import {
  analyzeRaceConditions,
  _internal as raceInternal,
} from '../src/analyzers/raceConditionAnalyzer.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'race-react');

describe('raceConditionAnalyzer — JS/TS patterns', () => {
  it('detects useState setter after await without mount guard (positive)', () => {
    const code = `
async function load() {
  const data = await fetch('/x');
  setUser(data);
}`;
    const findings = raceInternal.detectJSRaces('UserProfile.tsx', code);
    expect(findings.some((f) => f.subType === 'react-setstate-after-await')).toBe(true);
  });

  it('does NOT flag setState after await when AbortController is in scope (negative)', () => {
    const code = `
async function load(signal) {
  const data = await fetch('/x', { signal });
  if (!signal.aborted) setUser(data);
}`;
    const findings = raceInternal.detectJSRaces('UserProfile.tsx', code);
    expect(findings.some((f) => f.subType === 'react-setstate-after-await')).toBe(false);
  });

  it('detects useEffect with async fetch and no AbortController (positive)', () => {
    const code = `useEffect(() => { fetch('/x').then(r => r.json()).then(d => setUser(d)); }, [id]);`;
    const findings = raceInternal.detectJSRaces('X.tsx', code);
    expect(findings.some((f) => f.subType === 'react-useeffect-no-abort')).toBe(true);
  });

  it('does NOT flag useEffect when cleanup is returned (negative)', () => {
    const code = `useEffect(() => { const ctrl = new AbortController(); fetch('/x', { signal: ctrl.signal }); return () => ctrl.abort(); }, [id]);`;
    const findings = raceInternal.detectJSRaces('X.tsx', code);
    expect(findings.some((f) => f.subType === 'react-useeffect-no-abort')).toBe(false);
  });

  it('detects forEach with await (positive)', () => {
    const code = `items.forEach(async (i) => { await save(i); });`;
    const findings = raceInternal.detectJSRaces('X.ts', code);
    const found = findings.find((f) => f.subType === 'foreach-await');
    expect(found).toBeDefined();
    expect(found!.severity).toBe('medium');
    expect(found!.confidence).toBeGreaterThanOrEqual(80);
  });

  it('does NOT flag for-of with await (negative)', () => {
    const code = `for (const i of items) { await save(i); }`;
    const findings = raceInternal.detectJSRaces('X.ts', code);
    expect(findings.some((f) => f.subType === 'foreach-await')).toBe(false);
  });

  it('detects TOCTOU existsSync → readFileSync (positive)', () => {
    const code = `if (fs.existsSync(p)) { return fs.readFileSync(p, 'utf-8'); }`;
    const findings = raceInternal.detectJSRaces('X.ts', code);
    const found = findings.find((f) => f.subType === 'toctou-fs');
    expect(found).toBeDefined();
    expect(found!.cwe).toBe('CWE-367');
  });

  it('does NOT flag a single try/catch-protected fs op (negative)', () => {
    const code = `try { return fs.readFileSync(p, 'utf-8'); } catch { return '{}'; }`;
    const findings = raceInternal.detectJSRaces('X.ts', code);
    expect(findings.some((f) => f.subType === 'toctou-fs')).toBe(false);
  });
});

describe('raceConditionAnalyzer — Swift patterns', () => {
  it('flags concurrent DispatchQueue without barrier', () => {
    const code = `let q = DispatchQueue(label: "x", attributes: .concurrent)
q.async { items.append(1) }`;
    const findings = raceInternal.detectSwiftRaces('X.swift', code);
    expect(findings.some((f) => f.subType === 'swift-dispatch-no-barrier')).toBe(true);
  });

  it('does NOT flag concurrent queue with barrier', () => {
    const code = `let q = DispatchQueue(label: "x", attributes: .concurrent)
q.async(flags: .barrier) { items.append(1) }`;
    const findings = raceInternal.detectSwiftRaces('X.swift', code);
    expect(findings.some((f) => f.subType === 'swift-dispatch-no-barrier')).toBe(false);
  });
});

describe('raceConditionAnalyzer — Kotlin patterns', () => {
  it('flags flow with collect but no flowOn', () => {
    const code = `val f = flow { emit(1) }
launch { f.collect { it } }`;
    const findings = raceInternal.detectKotlinRaces('X.kt', code);
    expect(findings.some((f) => f.subType === 'kotlin-flow-no-flowon')).toBe(true);
  });

  it('does NOT flag flow that uses flowOn', () => {
    const code = `val f = flow { emit(1) }.flowOn(Dispatchers.IO)
launch { f.collect { it } }`;
    const findings = raceInternal.detectKotlinRaces('X.kt', code);
    expect(findings.some((f) => f.subType === 'kotlin-flow-no-flowon')).toBe(false);
  });
});

describe('raceConditionAnalyzer — Go patterns', () => {
  it('flags goroutine + map without mutex', () => {
    const code = `m := map[string]int{}
go func() { m["a"] = 1 }()`;
    const findings = raceInternal.detectGoRaces('X.go', code);
    expect(findings.some((f) => f.subType === 'go-map-no-mutex')).toBe(true);
  });

  it('does NOT flag with sync.Mutex protection', () => {
    const code = `var mu sync.Mutex
m := map[string]int{}
go func() { mu.Lock(); m["a"] = 1; mu.Unlock() }()`;
    const findings = raceInternal.detectGoRaces('X.go', code);
    expect(findings.some((f) => f.subType === 'go-map-no-mutex')).toBe(false);
  });
});

describe('raceConditionAnalyzer — fixture integration', () => {
  it('detects multiple race patterns in the race-react fixture', () => {
    const r = analyzeRaceConditions(FIXTURE, 'web');
    expect(r.findings.length).toBeGreaterThanOrEqual(4);
    const subTypes = new Set(r.findings.map((f) => f.subType));
    expect(subTypes.has('react-setstate-after-await')).toBe(true);
    expect(subTypes.has('react-useeffect-no-abort')).toBe(true);
    expect(subTypes.has('foreach-await')).toBe(true);
    expect(subTypes.has('toctou-fs')).toBe(true);
  });

  it('all findings carry a recommendation and line number', () => {
    const r = analyzeRaceConditions(FIXTURE, 'web');
    for (const f of r.findings) {
      expect(f.recommendation.length).toBeGreaterThan(10);
      expect(f.line).toBeGreaterThan(0);
    }
  });

  it('summary counts match findings array', () => {
    const r = analyzeRaceConditions(FIXTURE, 'web');
    const sevSum = Object.values(r.summary.bySeverity).reduce((a, b) => a + b, 0);
    expect(sevSum).toBe(r.findings.length);
    expect(r.summary.totalFindings).toBe(r.findings.length);
  });

  it('returns empty result for nonexistent path', () => {
    const r = analyzeRaceConditions('/this/does/not/exist/xyz', 'web');
    expect(r.findings).toEqual([]);
    expect(r.summary.totalFindings).toBe(0);
  });
});
