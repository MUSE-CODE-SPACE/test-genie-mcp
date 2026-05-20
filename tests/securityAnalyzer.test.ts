/**
 * Security analyzer tests — v3.1.0.
 *
 * Coverage:
 *   - Secret regex hits (AWS / Stripe / GitHub / Google / JWT / URL token /
 *     hardcoded password).
 *   - Code patterns: SQLi, XSS, eval, Math.random in security context,
 *     weak hash, exec injection, SSRF, CORS, cookie flags, yaml.load.
 *   - .env hygiene.
 *   - Snippet redaction works (we don't leak secrets back in the report).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  analyzeSecurity,
  _internal as secInternal,
} from '../src/analyzers/securityAnalyzer.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'security-node');

describe('securityAnalyzer — secrets', () => {
  it('flags AWS access key id', () => {
    const code = `const KEY = 'AKIA2X7QV6JKLM8RTUVW';`;
    const findings = secInternal.detectSecrets('config.js', code);
    expect(findings.some((f) => f.title.includes('AWS access key'))).toBe(true);
  });

  it('flags Stripe live secret key', () => {
    const code = `const stripe = 'sk_live_abcdefghijklmnop1234';`;
    const findings = secInternal.detectSecrets('billing.js', code);
    const found = findings.find((f) => f.title.includes('Stripe live secret'));
    expect(found).toBeDefined();
    expect(found!.severity).toBe('critical');
  });

  it('flags GitHub PAT', () => {
    const code = `const t = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';`;
    const findings = secInternal.detectSecrets('gh.js', code);
    expect(findings.some((f) => f.title.includes('GitHub'))).toBe(true);
  });

  it('flags JWT secret literal', () => {
    const code = `const JWT_SECRET = "super-secret-jwt-signing-key-1234567";`;
    const findings = secInternal.detectSecrets('auth.js', code);
    expect(findings.some((f) => f.title.includes('JWT secret'))).toBe(true);
  });

  it('flags API token in URL', () => {
    const code = `fetch('https://api.example.com/data?token=abcdefghijklmnopqrstuvwx');`;
    const findings = secInternal.detectSecrets('client.js', code);
    expect(findings.some((f) => f.title.includes('API token in URL'))).toBe(true);
  });

  it('skips obvious placeholders', () => {
    const code = `const KEY = 'AKIAEXAMPLEKEYXXXXXX';`;
    const findings = secInternal.detectSecrets('docs.js', code);
    expect(findings.some((f) => f.title.includes('AWS access key'))).toBe(false);
  });

  it('redacts long token values in the snippet', () => {
    const code = `const t = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';`;
    const findings = secInternal.detectSecrets('gh.js', code);
    expect(findings[0]!.snippet).toContain('REDACTED');
    expect(findings[0]!.snippet).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('skips files that are docs/lockfiles/sourcemaps', () => {
    const code = `const KEY = 'AKIA2X7QV6JKLM8RTUVW';`;
    expect(secInternal.detectSecrets('README.md', code).length).toBe(0);
    expect(secInternal.detectSecrets('package-lock.json', code).length).toBe(0);
  });
});

describe('securityAnalyzer — code patterns', () => {
  it('flags SQL string concatenation with req param', () => {
    const code = `db.query("SELECT * FROM users WHERE id = " + req.params.id)`;
    const findings = secInternal.detectCodePatterns('routes.ts', code);
    const sql = findings.find((f) => f.subType === 'injection' && f.title.includes('SQL'));
    expect(sql).toBeDefined();
    expect(sql!.severity).toBe('critical');
    expect(sql!.cwe).toBe('CWE-89');
  });

  it('flags innerHTML assignment from variable', () => {
    const code = `el.innerHTML = userInput;`;
    const findings = secInternal.detectCodePatterns('view.ts', code);
    expect(findings.some((f) => f.subType === 'xss')).toBe(true);
  });

  it('flags eval with non-literal', () => {
    const code = `const r = eval(expr);`;
    const findings = secInternal.detectCodePatterns('calc.ts', code);
    expect(findings.some((f) => f.title.includes('eval'))).toBe(true);
  });

  it('flags Math.random in security-sensitive file', () => {
    const code = `function resetToken() { return Math.random().toString(); }`;
    const findings = secInternal.detectCodePatterns('reset.ts', code);
    expect(findings.some((f) => f.subType === 'crypto' && f.title.includes('Math.random'))).toBe(true);
  });

  it('does NOT flag Math.random in non-security file', () => {
    const code = `function jitter() { return Math.random() * 1000; }`;
    const findings = secInternal.detectCodePatterns('animation.ts', code);
    expect(findings.some((f) => f.subType === 'crypto' && f.title.includes('Math.random'))).toBe(false);
  });

  it('flags md5 / sha1 hashing', () => {
    const code = `const h = crypto.createHash('md5').update(pw).digest('hex');`;
    const findings = secInternal.detectCodePatterns('auth.ts', code);
    const md5 = findings.find((f) => f.title.includes('md5'));
    expect(md5).toBeDefined();
    expect(md5!.autoFixable).toBe(true);
  });

  it('flags child_process.exec template literal with req input', () => {
    const code = "exec(`ping ${req.query.host}`)";
    const findings = secInternal.detectCodePatterns('ops.ts', code);
    expect(findings.some((f) => f.title.includes('child_process.exec'))).toBe(true);
  });

  it('flags fetch with req-derived URL (SSRF)', () => {
    const code = `await fetch(req.query.url)`;
    const findings = secInternal.detectCodePatterns('proxy.ts', code);
    expect(findings.some((f) => f.subType === 'ssrf')).toBe(true);
  });

  it('flags CORS wildcard + credentials', () => {
    const code = `
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Credentials', 'true');`;
    const findings = secInternal.detectCodePatterns('cors.ts', code);
    expect(findings.some((f) => f.title.includes('CORS wildcard'))).toBe(true);
  });

  it('flags cookie without httpOnly/secure/sameSite', () => {
    const code = `res.cookie('session', 'abc', {})`;
    const findings = secInternal.detectCodePatterns('login.ts', code);
    expect(findings.some((f) => f.title.includes('Cookie'))).toBe(true);
  });

  it('flags yaml.load without safe schema', () => {
    const code = `const cfg = yaml.load(content);`;
    const findings = secInternal.detectCodePatterns('cfg.ts', code);
    expect(findings.some((f) => f.subType === 'deserialization')).toBe(true);
  });

  it('skips findings for non-JS files', () => {
    const code = `db.query("SELECT * FROM x WHERE id = " + req.params.id)`;
    const findings = secInternal.detectCodePatterns('routes.swift', code);
    expect(findings.length).toBe(0);
  });
});

describe('securityAnalyzer — .env hygiene', () => {
  it('flags .env without matching .gitignore entry', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-env-'));
    fs.writeFileSync(path.join(tmp, '.env'), 'DB_PASSWORD=hunter2\n');
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
    const findings = secInternal.detectEnvHygiene(tmp);
    expect(findings.some((f) => f.title.includes('.env file exists but is not in .gitignore'))).toBe(true);
  });

  it('does NOT flag when .env is gitignored', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-env-'));
    fs.writeFileSync(path.join(tmp, '.env'), 'DB_PASSWORD=hunter2\n');
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n.env\n');
    const findings = secInternal.detectEnvHygiene(tmp);
    expect(findings.length).toBe(0);
  });
});

describe('securityAnalyzer — fixture integration', () => {
  it('detects 8+ security findings in the security-node fixture', () => {
    const r = analyzeSecurity(FIXTURE, 'web');
    expect(r.findings.length).toBeGreaterThanOrEqual(8);
  });

  it('covers secrets, injection, crypto, ssrf, misconfig sub-types', () => {
    const r = analyzeSecurity(FIXTURE, 'web');
    const subs = new Set(r.findings.map((f) => f.subType));
    expect(subs.has('secret')).toBe(true);
    expect(subs.has('injection')).toBe(true);
    expect(subs.has('crypto')).toBe(true);
    expect(subs.has('ssrf')).toBe(true);
    expect(subs.has('misconfig')).toBe(true);
  });

  it('emits at least 3 critical findings in the fixture', () => {
    const r = analyzeSecurity(FIXTURE, 'web');
    expect((r.summary.bySeverity.critical ?? 0)).toBeGreaterThanOrEqual(3);
  });
});
