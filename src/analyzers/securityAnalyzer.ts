/**
 * Security analyzer for the v3.1.0 vibe-check feature.
 *
 * Two layers:
 *
 *   1. Secret scanning — high-precision regex matches for AWS / Stripe /
 *      GitHub tokens + JWT-secret-looking strings + tokens in URLs.
 *   2. Code-pattern scanning — common SQLi / XSS / SSRF / weak-crypto /
 *      eval / yaml.load / `Math.random in security context` shapes.
 *
 * This is deliberately not a replacement for Snyk / Semgrep — it's a
 * "catch the obvious stuff before review" filter that runs in <100ms and
 * produces a small, prioritized list. Confidence scores tell the user how
 * much of a fix-it-now feeling each finding warrants.
 */
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Platform } from '../types.js';
import { getAllFiles } from '../utils/codeParser.js';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';
export type SecuritySubType = 'secret' | 'injection' | 'xss' | 'crypto' | 'auth' | 'misconfig' | 'ssrf' | 'deserialization';

export interface SecurityFinding {
  id: string;
  category: 'security';
  subType: SecuritySubType;
  severity: SecuritySeverity;
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

export interface SecurityResult {
  findings: SecurityFinding[];
  summary: {
    totalFindings: number;
    bySeverity: Record<string, number>;
    bySubType: Record<string, number>;
    filesScanned: number;
  };
}

function lineOf(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

function snippet(content: string, index: number, maxLen = 140): string {
  const start = Math.max(0, content.lastIndexOf('\n', index) + 1);
  const end = content.indexOf('\n', index);
  const raw = content.substring(start, end === -1 ? content.length : end).trim();
  // Mask any obvious secret values so the report itself isn't a secret leak.
  return raw.replace(/(['"`])([A-Za-z0-9_\-+/=]{20,})\1/g, '$1<REDACTED>$1').substring(0, maxLen);
}

// ---------------------------------------------------------------------------
// Secret patterns
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  re: RegExp;
  severity: SecuritySeverity;
  confidence: number;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/g, severity: 'critical', confidence: 95 },
  { name: 'AWS secret access key', re: /aws_secret_access_key\s*[=:]\s*['"]([A-Za-z0-9/+=]{40})['"]/gi, severity: 'critical', confidence: 90 },
  { name: 'Stripe live secret key', re: /sk_live_[0-9A-Za-z]{16,}/g, severity: 'critical', confidence: 95 },
  { name: 'Stripe live publishable key', re: /pk_live_[0-9A-Za-z]{16,}/g, severity: 'high', confidence: 90 },
  { name: 'GitHub personal access token', re: /ghp_[A-Za-z0-9]{30,}/g, severity: 'critical', confidence: 95 },
  { name: 'GitHub fine-grained token', re: /github_pat_[A-Za-z0-9_]{60,}/g, severity: 'critical', confidence: 95 },
  { name: 'GitHub OAuth token', re: /gho_[A-Za-z0-9]{30,}/g, severity: 'critical', confidence: 90 },
  { name: 'Google API key', re: /AIza[0-9A-Za-z\-_]{35}/g, severity: 'high', confidence: 85 },
  { name: 'Slack bot/user token', re: /xox[baprs]-[0-9]{10,}-[0-9A-Za-z]{20,}/g, severity: 'high', confidence: 90 },
  // High-entropy JWT secret-looking var assignment.
  { name: 'Possible JWT secret literal', re: /(JWT_SECRET|jwt_secret|jwtSecret)\s*[=:]\s*['"]([^'"]{16,})['"]/g, severity: 'high', confidence: 70 },
  // URL with embedded token query param.
  { name: 'API token in URL', re: /https?:\/\/[^\s'"`]+[?&](?:token|api_key|apikey|access_token)=([A-Za-z0-9_\-]{16,})/gi, severity: 'high', confidence: 80 },
  // Hardcoded password literal.
  { name: 'Hardcoded password literal', re: /\b(password|passwd|pwd)\s*[=:]\s*['"]([^'"]{6,})['"]/gi, severity: 'medium', confidence: 55 },
];

function detectSecrets(file: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  // Skip files that are likely templates / docs / locale / lockfiles.
  if (/\.(md|lock|map|min\.js)$/.test(file)) return findings;
  if (/(?:package-lock|npm-shrinkwrap)\.json$|yarn\.lock$|pnpm-lock\.yaml$/.test(file)) return findings;

  for (const pat of SECRET_PATTERNS) {
    let m: RegExpExecArray | null;
    // Reset regex state for each file.
    pat.re.lastIndex = 0;
    while ((m = pat.re.exec(content)) !== null) {
      // Heuristic: skip obvious placeholders in the captured secret value
      // (not the surrounding text — `example.com` host is fine).
      const captured = (m[1] ?? m[0]).toString();
      if (/^(YOUR|EXAMPLE|PLACEHOLDER|FAKE|XXX|REPLACE|<.*?>)/i.test(captured)) continue;
      if (/EXAMPLE|PLACEHOLDER|XXXXXX/i.test(captured)) continue;
      // Don't flag short placeholders like password = "password".
      if (pat.name.includes('password') && /['"](password|123456|changeme|admin)['"]/i.test(m[0])) continue;

      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'secret',
        severity: pat.severity,
        confidence: pat.confidence,
        file,
        line: lineOf(content, m.index),
        title: `Hardcoded ${pat.name} found in source`,
        description:
          'Long-lived credentials in source code are committed to git history forever. They should be loaded from environment variables, a secret manager, or a sealed config — not hard-coded.',
        snippet: snippet(content, m.index),
        recommendation:
          'Move the value to an env var (`process.env.X`), add the secret to `.gitignore`d config, and rotate the leaked key in the issuing provider\'s console.',
        autoFixable: false,
        cwe: 'CWE-798',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Code pattern checks (JS/TS focus; Swift/Kotlin lite-touch)
// ---------------------------------------------------------------------------

function detectCodePatterns(file: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const isJs = /\.(ts|tsx|js|jsx)$/.test(file);

  if (isJs) {
    // SQL string concat with user input.
    const sqliRe = /(?:query|execute|raw)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP)\s[^'"`]*['"`]\s*\+\s*(?:req\.|request\.|params\.|body\.|query\.|input)/gi;
    let m: RegExpExecArray | null;
    while ((m = sqliRe.exec(content)) !== null) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'injection',
        severity: 'critical',
        confidence: 88,
        file,
        line: lineOf(content, m.index),
        title: 'SQL string built by concatenating user input',
        description:
          'Building SQL by string-concatenating request fields lets an attacker inject arbitrary SQL — read other rows, dump tables, or drop the database.',
        snippet: snippet(content, m.index),
        recommendation:
          'Use parameterized queries (`db.query("... WHERE id = ?", [id])`) or a query builder that escapes bound parameters.',
        autoFixable: false,
        cwe: 'CWE-89',
      });
    }

    // innerHTML / dangerouslySetInnerHTML with non-static content.
    const innerHTMLRe = /\.innerHTML\s*=\s*(?!['"`])(\w+)|dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(\w+)/g;
    while ((m = innerHTMLRe.exec(content)) !== null) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'xss',
        severity: 'high',
        confidence: 75,
        file,
        line: lineOf(content, m.index),
        title: 'innerHTML / dangerouslySetInnerHTML with non-literal value',
        description: 'Setting HTML from a dynamic string lets an attacker inject `<script>` tags or event handlers — classic stored/reflected XSS.',
        snippet: snippet(content, m.index),
        recommendation:
          'Prefer `textContent` (or React\'s JSX, which escapes by default). If you must render HTML, sanitize it through DOMPurify first.',
        autoFixable: false,
        cwe: 'CWE-79',
      });
    }

    // eval() / new Function() with non-literal.
    const evalRe = /\b(eval|new\s+Function)\s*\(\s*(?!['"`])(\w+)/g;
    while ((m = evalRe.exec(content)) !== null) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'injection',
        severity: 'critical',
        confidence: 90,
        file,
        line: lineOf(content, m.index),
        title: `${m[1]} called with non-literal expression`,
        description: 'Executing arbitrary strings as code is the most direct form of RCE in JS — almost always avoidable.',
        snippet: snippet(content, m.index),
        recommendation: 'Refactor to data-driven dispatch (lookup table, switch), or — if user input must be evaluated — use a sandbox like `vm2`.',
        autoFixable: false,
        cwe: 'CWE-95',
      });
    }

    // Math.random used in security-looking context.
    const insecureRandomRe = /Math\.random\s*\(\s*\)/g;
    if (insecureRandomRe.test(content)) {
      // Heuristic: flag if the same file mentions token / password / secret / nonce / session / reset / verify
      // — bare keyword match (no word boundary) so we also catch `resetToken`, `sessionId`, etc.
      if (/(token|password|secret|nonce|session|reset|verify|otp)/i.test(content)) {
        insecureRandomRe.lastIndex = 0;
        const mm = insecureRandomRe.exec(content);
        if (mm) {
          findings.push({
            id: uuidv4(),
            category: 'security',
            subType: 'crypto',
            severity: 'high',
            confidence: 65,
            file,
            line: lineOf(content, mm.index),
            title: 'Math.random() used in a security-sensitive file',
            description:
              '`Math.random()` is a fast PRNG, not a cryptographic one. The output is predictable enough that an attacker who sees a few values can guess the next ones — fatal for password-reset tokens or session IDs.',
            snippet: snippet(content, mm.index),
            recommendation: 'Use `crypto.randomBytes(n).toString("hex")` (Node) or `crypto.getRandomValues(buf)` (browser/Web Crypto).',
            autoFixable: true,
            cwe: 'CWE-338',
          });
        }
      }
    }

    // Weak crypto for hashing passwords/tokens.
    const weakHashRe = /createHash\s*\(\s*['"](md5|sha1)['"]/g;
    while ((m = weakHashRe.exec(content)) !== null) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'crypto',
        severity: 'medium',
        confidence: 80,
        file,
        line: lineOf(content, m.index),
        title: `Weak hash algorithm \`${m[1]}\` used`,
        description:
          'MD5 and SHA-1 are broken for collision resistance and inappropriate for password storage. Even for fingerprinting, SHA-256 is the modern minimum.',
        snippet: snippet(content, m.index),
        recommendation:
          'For passwords: `bcrypt`, `scrypt`, or `argon2`. For general hashing: `createHash("sha256")`. For HMAC: `createHmac("sha256", key)`.',
        autoFixable: true,
        cwe: 'CWE-327',
      });
    }

    // child_process.exec with template literal containing user input.
    const execInjectRe = /(exec|execSync)\s*\(\s*`[^`]*\$\{(?:req\.|request\.|params\.|body\.|query\.|input)/g;
    while ((m = execInjectRe.exec(content)) !== null) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'injection',
        severity: 'critical',
        confidence: 92,
        file,
        line: lineOf(content, m.index),
        title: 'child_process.exec with user input in template literal',
        description: 'Interpolating user input into a shell command lets an attacker chain commands with `;`, `&&`, or backticks — full shell injection.',
        snippet: snippet(content, m.index),
        recommendation: 'Switch to `spawn(cmd, [arg1, arg2, ...])` with argv arrays so the shell never parses the args.',
        autoFixable: false,
        cwe: 'CWE-78',
      });
    }

    // fetch with user-controlled URL (SSRF).
    const ssrfRe = /fetch\s*\(\s*(req\.|request\.|params\.|body\.|query\.)/g;
    while ((m = ssrfRe.exec(content)) !== null) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'ssrf',
        severity: 'high',
        confidence: 70,
        file,
        line: lineOf(content, m.index),
        title: 'Fetch URL taken directly from request — possible SSRF',
        description:
          'If the URL is attacker-controlled, they can target internal services (e.g. `http://169.254.169.254/` on AWS for IMDS) or scan the internal network.',
        snippet: snippet(content, m.index),
        recommendation: 'Validate against a host allowlist before fetching; resolve DNS and block private IP ranges (10/8, 172.16/12, 192.168/16, 169.254/16).',
        autoFixable: false,
        cwe: 'CWE-918',
      });
    }

    // CORS Access-Control-Allow-Origin: * combined with credentials.
    if (content.includes('Access-Control-Allow-Origin') && content.includes('*') && /Access-Control-Allow-Credentials.*true/i.test(content)) {
      const idx = content.indexOf('Access-Control-Allow-Origin');
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'misconfig',
        severity: 'high',
        confidence: 85,
        file,
        line: lineOf(content, idx),
        title: 'CORS wildcard origin combined with credentials',
        description:
          'Setting `Access-Control-Allow-Origin: *` together with `Allow-Credentials: true` is explicitly forbidden by the spec and most browsers will reject it — but if your server still does it, the request succeeds and cookies leak across origins.',
        snippet: snippet(content, idx),
        recommendation: 'Echo a specific allowlisted origin from the `Origin` header instead of `*`, or drop the credentials flag.',
        autoFixable: false,
        cwe: 'CWE-942',
      });
    }

    // Cookies set without httpOnly / secure / sameSite.
    const cookieRe = /(?:res|response)\.cookie\s*\(\s*[^,)]+,\s*[^,)]+(?:,\s*(\{[^}]*\}))?\s*\)/g;
    while ((m = cookieRe.exec(content)) !== null) {
      const opts = m[1] ?? '';
      if (!/httpOnly/i.test(opts) || !/secure/i.test(opts) || !/sameSite/i.test(opts)) {
        findings.push({
          id: uuidv4(),
          category: 'security',
          subType: 'misconfig',
          severity: 'low',
          confidence: 70,
          file,
          line: lineOf(content, m.index),
          title: 'Cookie set without httpOnly/secure/sameSite',
          description: 'Cookies that carry session or CSRF tokens should be `httpOnly` (JS cannot read them), `secure` (HTTPS-only) and `sameSite` (no cross-site send).',
          snippet: snippet(content, m.index),
          recommendation: 'Pass `{ httpOnly: true, secure: true, sameSite: "lax" }` (or `"strict"`) explicitly.',
          autoFixable: false,
          cwe: 'CWE-1004',
        });
      }
    }

    // yaml.load (insecure) — JS yaml library.
    const yamlLoadRe = /\byaml\.load\s*\(/g;
    while ((m = yamlLoadRe.exec(content)) !== null) {
      // skip yaml.safeLoad / load with explicit schema.
      const surrounding = content.substring(Math.max(0, m.index - 10), m.index + 40);
      if (surrounding.includes('safeLoad') || surrounding.includes('FAILSAFE_SCHEMA')) continue;
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'deserialization',
        severity: 'medium',
        confidence: 70,
        file,
        line: lineOf(content, m.index),
        title: 'yaml.load called without safe schema',
        description: 'The default schema in older `js-yaml` versions allowed arbitrary object instantiation, which has been used for RCE.',
        snippet: snippet(content, m.index),
        recommendation: 'Switch to `yaml.load(content, { schema: yaml.SAFE_SCHEMA })` or use a modern parser that\'s safe by default.',
        autoFixable: true,
        cwe: 'CWE-502',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// .env hygiene
// ---------------------------------------------------------------------------

function detectEnvHygiene(projectPath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const envPath = path.join(projectPath, '.env');
  const gitignorePath = path.join(projectPath, '.gitignore');

  if (fs.existsSync(envPath)) {
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      try {
        gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      } catch {
        /* ignore */
      }
    }
    if (!/^\.env\b|\n\.env\b|^\*\.env|\n\*\.env/.test(gitignoreContent)) {
      findings.push({
        id: uuidv4(),
        category: 'security',
        subType: 'secret',
        severity: 'high',
        confidence: 90,
        file: envPath,
        line: 1,
        title: '.env file exists but is not in .gitignore',
        description: '`.env` typically holds credentials. If it\'s not gitignored, the next commit will leak the secrets — irreversibly, into git history.',
        snippet: '(file: .env present, .gitignore missing entry)',
        recommendation: 'Add `.env` (and `.env.*` except `.env.example`) to `.gitignore`, then rotate any credentials that may already have been committed.',
        autoFixable: true,
        cwe: 'CWE-538',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
      return ['.tsx', '.ts', '.jsx', '.js', '.env', '.yml', '.yaml'];
    default:
      return ['.ts', '.tsx', '.js', '.jsx', '.swift', '.kt', '.java', '.env'];
  }
}

export function analyzeSecurity(projectPath: string, platform: Platform): SecurityResult {
  const findings: SecurityFinding[] = [];
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
    findings.push(...detectSecrets(file, content));
    findings.push(...detectCodePatterns(file, content));
  }

  findings.push(...detectEnvHygiene(projectPath));

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

// Test-only export
export const _internal = {
  detectSecrets,
  detectCodePatterns,
  detectEnvHygiene,
  SECRET_PATTERNS,
};
