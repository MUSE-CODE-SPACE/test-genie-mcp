// ============================================
// Web Test Platform Integration
// Playwright, Puppeteer, Cypress
// ============================================

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { TestResult, Platform } from '../../types.js';

const execAsync = promisify(exec);

export interface WebTestConfig {
  projectPath: string;
  testPath?: string;
  browser?: 'chromium' | 'firefox' | 'webkit' | 'all';
  headless?: boolean;
  workers?: number;
  reporter?: 'list' | 'dot' | 'html' | 'json';
  timeout?: number;
  baseUrl?: string;
}

export interface BrowserInstance {
  name: string;
  version: string;
  executablePath: string;
}

// ============================================
// Browser Management
// ============================================
export async function listBrowsers(): Promise<BrowserInstance[]> {
  const browsers: BrowserInstance[] = [];

  try {
    // Check Playwright browsers
    const { stdout } = await execAsync('npx playwright --version');
    if (stdout) {
      browsers.push(
        { name: 'chromium', version: 'latest', executablePath: '' },
        { name: 'firefox', version: 'latest', executablePath: '' },
        { name: 'webkit', version: 'latest', executablePath: '' }
      );
    }
  } catch {
    // Playwright not available
  }

  return browsers;
}

export async function installBrowsers(): Promise<boolean> {
  try {
    await execAsync('npx playwright install', { timeout: 300000 });
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Playwright Tests
// ============================================
export async function runPlaywrightTests(config: WebTestConfig): Promise<{
  success: boolean;
  output: string;
  results: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    duration: number;
    tests: {
      title: string;
      file: string;
      status: 'passed' | 'failed' | 'skipped' | 'timedOut';
      duration: number;
      error?: string;
      retry?: number;
    }[];
  };
  artifacts: {
    screenshots: string[];
    videos: string[];
    traces: string[];
  };
}> {
  const {
    projectPath,
    testPath,
    browser = 'chromium',
    headless = true,
    workers = 1,
    reporter = 'json',
    timeout = 600000,
  } = config;

  const outputDir = path.join(projectPath, '.test-genie', 'playwright', Date.now().toString());
  const jsonReportPath = path.join(outputDir, 'results.json');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [
    `--project=${browser}`,
    `--workers=${workers}`,
    `--reporter=json`,
    `--output=${outputDir}`,
  ];

  if (headless) args.push('--headed=false');
  if (testPath) args.push(testPath);

  const command = `cd "${projectPath}" && PLAYWRIGHT_JSON_OUTPUT_NAME="${jsonReportPath}" npx playwright test ${args.join(' ')} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const results = parsePlaywrightResults(jsonReportPath);
    const artifacts = collectPlaywrightArtifacts(outputDir);

    return {
      success: results.failed === 0,
      output: stdout,
      results,
      artifacts,
    };
  } catch (error: any) {
    const results = parsePlaywrightResults(jsonReportPath);
    const artifacts = collectPlaywrightArtifacts(outputDir);

    return {
      success: false,
      output: error.stdout || error.message,
      results,
      artifacts,
    };
  }
}

function parsePlaywrightResults(jsonPath: string): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  duration: number;
  tests: {
    title: string;
    file: string;
    status: 'passed' | 'failed' | 'skipped' | 'timedOut';
    duration: number;
    error?: string;
    retry?: number;
  }[];
} {
  const defaultResult = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    duration: 0,
    tests: [],
  };

  if (!fs.existsSync(jsonPath)) {
    return defaultResult;
  }

  try {
    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const tests: {
      title: string;
      file: string;
      status: 'passed' | 'failed' | 'skipped' | 'timedOut';
      duration: number;
      error?: string;
      retry?: number;
    }[] = [];

    for (const suite of report.suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const result = test.results?.[0];
          tests.push({
            title: spec.title,
            file: suite.file,
            status: result?.status || 'skipped',
            duration: result?.duration || 0,
            error: result?.error?.message,
            retry: result?.retry,
          });
        }
      }
    }

    return {
      total: tests.length,
      passed: tests.filter(t => t.status === 'passed').length,
      failed: tests.filter(t => t.status === 'failed').length,
      skipped: tests.filter(t => t.status === 'skipped').length,
      flaky: tests.filter(t => (t.retry || 0) > 0 && t.status === 'passed').length,
      duration: report.stats?.duration || 0,
      tests,
    };
  } catch {
    return defaultResult;
  }
}

function collectPlaywrightArtifacts(outputDir: string): {
  screenshots: string[];
  videos: string[];
  traces: string[];
} {
  const artifacts = {
    screenshots: [] as string[],
    videos: [] as string[],
    traces: [] as string[],
  };

  if (!fs.existsSync(outputDir)) {
    return artifacts;
  }

  function walk(dir: string) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          if (item.endsWith('.png') || item.endsWith('.jpg')) {
            artifacts.screenshots.push(fullPath);
          } else if (item.endsWith('.webm') || item.endsWith('.mp4')) {
            artifacts.videos.push(fullPath);
          } else if (item.endsWith('.zip') && item.includes('trace')) {
            artifacts.traces.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  walk(outputDir);
  return artifacts;
}

// ============================================
// Playwright Visual Comparison
// ============================================
export async function runVisualTests(config: WebTestConfig & {
  updateSnapshots?: boolean;
  threshold?: number;
}): Promise<{
  success: boolean;
  output: string;
  comparisons: {
    name: string;
    matched: boolean;
    diffPixels?: number;
    diffPath?: string;
  }[];
}> {
  const {
    projectPath,
    testPath,
    updateSnapshots = false,
    threshold = 0.1,
    timeout = 300000,
  } = config;

  const args: string[] = ['--grep', '@visual'];

  if (testPath) args.push(testPath);
  if (updateSnapshots) args.push('--update-snapshots');

  const command = `cd "${projectPath}" && npx playwright test ${args.join(' ')} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const comparisons = parseVisualTestResults(stdout, projectPath);

    return {
      success: comparisons.every(c => c.matched),
      output: stdout,
      comparisons,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      comparisons: parseVisualTestResults(error.stdout || '', projectPath),
    };
  }
}

function parseVisualTestResults(
  output: string,
  projectPath: string
): {
  name: string;
  matched: boolean;
  diffPixels?: number;
  diffPath?: string;
}[] {
  const comparisons: {
    name: string;
    matched: boolean;
    diffPixels?: number;
    diffPath?: string;
  }[] = [];

  // Parse snapshot comparison results
  const mismatchRegex = /Screenshot\s+"([^"]+)"\s+doesn't match.*?(\d+)\s+pixels/g;
  let match;

  while ((match = mismatchRegex.exec(output)) !== null) {
    comparisons.push({
      name: match[1] || '',
      matched: false,
      diffPixels: parseInt(match[2] || '0'),
    });
  }

  // Parse passed comparisons
  const passedRegex = /Screenshot\s+"([^"]+)"\s+matched/g;
  while ((match = passedRegex.exec(output)) !== null) {
    comparisons.push({
      name: match[1] || '',
      matched: true,
    });
  }

  return comparisons;
}

// ============================================
// Cypress Tests
// ============================================
export async function runCypressTests(config: WebTestConfig): Promise<{
  success: boolean;
  output: string;
  results: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    duration: number;
    tests: {
      title: string;
      state: 'passed' | 'failed' | 'pending';
      duration: number;
      error?: string;
    }[];
  };
  videos: string[];
  screenshots: string[];
}> {
  const {
    projectPath,
    testPath,
    browser = 'chromium',
    headless = true,
    timeout = 600000,
  } = config;

  const browserMap: Record<string, string> = {
    chromium: 'chrome',
    firefox: 'firefox',
    webkit: 'edge', // Cypress doesn't support webkit
  };

  const args: string[] = [
    'run',
    `--browser=${browserMap[browser] || 'chrome'}`,
    '--reporter=json',
  ];

  if (testPath) args.push(`--spec=${testPath}`);
  if (headless) args.push('--headless');

  const command = `cd "${projectPath}" && npx cypress ${args.join(' ')} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const results = parseCypressOutput(stdout);
    const { videos, screenshots } = collectCypressArtifacts(projectPath);

    return {
      success: results.failed === 0,
      output: stdout,
      results,
      videos,
      screenshots,
    };
  } catch (error: any) {
    const results = parseCypressOutput(error.stdout || '');
    const { videos, screenshots } = collectCypressArtifacts(projectPath);

    return {
      success: false,
      output: error.stdout || error.message,
      results,
      videos,
      screenshots,
    };
  }
}

function parseCypressOutput(output: string): {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  duration: number;
  tests: {
    title: string;
    state: 'passed' | 'failed' | 'pending';
    duration: number;
    error?: string;
  }[];
} {
  const tests: {
    title: string;
    state: 'passed' | 'failed' | 'pending';
    duration: number;
    error?: string;
  }[] = [];

  // Parse test results
  const passedRegex = /✓\s+(.+?)\s+\((\d+)ms\)/g;
  const failedRegex = /✖\s+(.+)/g;
  const pendingRegex = /-\s+(.+)/g;

  let match;
  while ((match = passedRegex.exec(output)) !== null) {
    tests.push({
      title: match[1] || '',
      state: 'passed',
      duration: parseInt(match[2] || '0'),
    });
  }

  while ((match = failedRegex.exec(output)) !== null) {
    tests.push({
      title: match[1] || '',
      state: 'failed',
      duration: 0,
    });
  }

  while ((match = pendingRegex.exec(output)) !== null) {
    tests.push({
      title: match[1] || '',
      state: 'pending',
      duration: 0,
    });
  }

  // Parse summary
  const summaryMatch = output.match(/(\d+)\s+passing.*?(\d+)\s+failing.*?(\d+)\s+pending/);

  return {
    total: tests.length,
    passed: tests.filter(t => t.state === 'passed').length,
    failed: tests.filter(t => t.state === 'failed').length,
    pending: tests.filter(t => t.state === 'pending').length,
    duration: 0,
    tests,
  };
}

function collectCypressArtifacts(projectPath: string): {
  videos: string[];
  screenshots: string[];
} {
  const artifacts = {
    videos: [] as string[],
    screenshots: [] as string[],
  };

  const videosDir = path.join(projectPath, 'cypress', 'videos');
  const screenshotsDir = path.join(projectPath, 'cypress', 'screenshots');

  if (fs.existsSync(videosDir)) {
    artifacts.videos = fs.readdirSync(videosDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => path.join(videosDir, f));
  }

  if (fs.existsSync(screenshotsDir)) {
    function walk(dir: string) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (item.endsWith('.png')) {
          artifacts.screenshots.push(fullPath);
        }
      }
    }
    walk(screenshotsDir);
  }

  return artifacts;
}

// ============================================
// Performance Testing (Lighthouse)
// ============================================
export interface LighthouseConfig {
  url: string;
  projectPath: string;
  categories?: ('performance' | 'accessibility' | 'best-practices' | 'seo' | 'pwa')[];
  device?: 'mobile' | 'desktop';
  throttling?: boolean;
}

export async function runLighthouse(config: LighthouseConfig): Promise<{
  success: boolean;
  scores: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
    pwa?: number;
  };
  metrics: {
    firstContentfulPaint: number;
    largestContentfulPaint: number;
    timeToInteractive: number;
    totalBlockingTime: number;
    cumulativeLayoutShift: number;
    speedIndex: number;
  };
  reportPath: string;
}> {
  const {
    url,
    projectPath,
    categories = ['performance', 'accessibility', 'best-practices', 'seo'],
    device = 'mobile',
    throttling = true,
  } = config;

  const outputDir = path.join(projectPath, '.test-genie', 'lighthouse');
  const reportPath = path.join(outputDir, `report_${Date.now()}.json`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [
    url,
    '--output=json',
    `--output-path=${reportPath}`,
    `--only-categories=${categories.join(',')}`,
    `--preset=${device}`,
    '--chrome-flags="--headless"',
  ];

  if (!throttling) {
    args.push('--throttling-method=provided');
  }

  const command = `npx lighthouse ${args.join(' ')} 2>&1`;

  try {
    await execAsync(command, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });

    if (!fs.existsSync(reportPath)) {
      throw new Error('Report not generated');
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

    return {
      success: true,
      scores: {
        performance: Math.round((report.categories?.performance?.score || 0) * 100),
        accessibility: Math.round((report.categories?.accessibility?.score || 0) * 100),
        bestPractices: Math.round((report.categories?.['best-practices']?.score || 0) * 100),
        seo: Math.round((report.categories?.seo?.score || 0) * 100),
        pwa: report.categories?.pwa ? Math.round(report.categories.pwa.score * 100) : undefined,
      },
      metrics: {
        firstContentfulPaint: report.audits?.['first-contentful-paint']?.numericValue || 0,
        largestContentfulPaint: report.audits?.['largest-contentful-paint']?.numericValue || 0,
        timeToInteractive: report.audits?.interactive?.numericValue || 0,
        totalBlockingTime: report.audits?.['total-blocking-time']?.numericValue || 0,
        cumulativeLayoutShift: report.audits?.['cumulative-layout-shift']?.numericValue || 0,
        speedIndex: report.audits?.['speed-index']?.numericValue || 0,
      },
      reportPath,
    };
  } catch (error: any) {
    return {
      success: false,
      scores: {
        performance: 0,
        accessibility: 0,
        bestPractices: 0,
        seo: 0,
      },
      metrics: {
        firstContentfulPaint: 0,
        largestContentfulPaint: 0,
        timeToInteractive: 0,
        totalBlockingTime: 0,
        cumulativeLayoutShift: 0,
        speedIndex: 0,
      },
      reportPath,
    };
  }
}

// ============================================
// Accessibility Testing
// ============================================
export async function runAccessibilityTests(config: {
  projectPath: string;
  url: string;
  rules?: string[];
  tags?: string[];
}): Promise<{
  success: boolean;
  violations: {
    id: string;
    impact: 'minor' | 'moderate' | 'serious' | 'critical';
    description: string;
    nodes: {
      html: string;
      target: string;
    }[];
  }[];
  passes: number;
  inapplicable: number;
}> {
  const { projectPath, url, rules, tags = ['wcag2a', 'wcag2aa'] } = config;

  // Create a simple Playwright script to run axe-core
  const testScript = `
    const { chromium } = require('playwright');
    const AxeBuilder = require('@axe-core/playwright').default;

    (async () => {
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('${url}');

      const results = await new AxeBuilder({ page })
        ${tags.length ? `.withTags(${JSON.stringify(tags)})` : ''}
        .analyze();

      console.log(JSON.stringify(results));
      await browser.close();
    })();
  `;

  const scriptPath = path.join(projectPath, '.test-genie', 'a11y-test.js');
  const scriptDir = path.dirname(scriptPath);

  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }

  fs.writeFileSync(scriptPath, testScript);

  try {
    const { stdout } = await execAsync(`node "${scriptPath}"`, { timeout: 60000 });

    const results = JSON.parse(stdout);

    return {
      success: results.violations?.length === 0,
      violations: results.violations?.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes?.map((n: any) => ({
          html: n.html,
          target: n.target?.join(', ') || '',
        })) || [],
      })) || [],
      passes: results.passes?.length || 0,
      inapplicable: results.inapplicable?.length || 0,
    };
  } catch (error: any) {
    return {
      success: false,
      violations: [],
      passes: 0,
      inapplicable: 0,
    };
  } finally {
    // Cleanup
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
    }
  }
}

// ============================================
// API Testing
// ============================================
export interface APITestConfig {
  projectPath: string;
  baseUrl: string;
  endpoints: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    headers?: Record<string, string>;
    body?: any;
    expectedStatus: number;
    expectedSchema?: any;
  }[];
}

export async function runAPITests(config: APITestConfig): Promise<{
  success: boolean;
  results: {
    endpoint: string;
    method: string;
    status: number;
    duration: number;
    passed: boolean;
    error?: string;
  }[];
  totalDuration: number;
}> {
  const { baseUrl, endpoints } = config;

  const results: {
    endpoint: string;
    method: string;
    status: number;
    duration: number;
    passed: boolean;
    error?: string;
  }[] = [];

  const startTime = Date.now();

  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint.path}`;
    const start = Date.now();

    try {
      const response = await fetch(url, {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          ...endpoint.headers,
        },
        body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
      });

      const duration = Date.now() - start;
      const passed = response.status === endpoint.expectedStatus;

      results.push({
        endpoint: endpoint.path,
        method: endpoint.method,
        status: response.status,
        duration,
        passed,
        error: passed ? undefined : `Expected ${endpoint.expectedStatus}, got ${response.status}`,
      });
    } catch (error: any) {
      results.push({
        endpoint: endpoint.path,
        method: endpoint.method,
        status: 0,
        duration: Date.now() - start,
        passed: false,
        error: error.message,
      });
    }
  }

  return {
    success: results.every(r => r.passed),
    results,
    totalDuration: Date.now() - startTime,
  };
}

// ============================================
// Load Testing (K6 integration)
// ============================================
export interface LoadTestConfig {
  projectPath: string;
  url: string;
  duration: string; // e.g., '30s', '1m'
  vus: number; // virtual users
  thresholds?: {
    http_req_duration?: string;
    http_req_failed?: string;
  };
}

export async function runLoadTest(config: LoadTestConfig): Promise<{
  success: boolean;
  metrics: {
    http_reqs: number;
    http_req_duration_avg: number;
    http_req_duration_p95: number;
    http_req_failed: number;
    vus: number;
  };
  output: string;
}> {
  const { projectPath, url, duration, vus, thresholds } = config;

  // Create k6 script
  const k6Script = `
    import http from 'k6/http';
    import { check, sleep } from 'k6';

    export const options = {
      vus: ${vus},
      duration: '${duration}',
      thresholds: ${JSON.stringify(thresholds || {})},
    };

    export default function() {
      const res = http.get('${url}');
      check(res, {
        'status is 200': (r) => r.status === 200,
        'response time < 500ms': (r) => r.timings.duration < 500,
      });
      sleep(1);
    }
  `;

  const scriptPath = path.join(projectPath, '.test-genie', 'load-test.js');
  const scriptDir = path.dirname(scriptPath);

  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }

  fs.writeFileSync(scriptPath, k6Script);

  try {
    const { stdout } = await execAsync(`k6 run --out json=/tmp/k6-results.json "${scriptPath}"`, {
      timeout: 600000,
    });

    // Parse k6 output
    const metrics = parseK6Output(stdout);

    return {
      success: true,
      metrics,
      output: stdout,
    };
  } catch (error: any) {
    return {
      success: false,
      metrics: {
        http_reqs: 0,
        http_req_duration_avg: 0,
        http_req_duration_p95: 0,
        http_req_failed: 0,
        vus: 0,
      },
      output: error.stdout || error.message,
    };
  } finally {
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
    }
  }
}

function parseK6Output(output: string): {
  http_reqs: number;
  http_req_duration_avg: number;
  http_req_duration_p95: number;
  http_req_failed: number;
  vus: number;
} {
  const metrics = {
    http_reqs: 0,
    http_req_duration_avg: 0,
    http_req_duration_p95: 0,
    http_req_failed: 0,
    vus: 0,
  };

  const reqsMatch = output.match(/http_reqs[.\s]+:\s+(\d+)/);
  if (reqsMatch) metrics.http_reqs = parseInt(reqsMatch[1] || '0');

  const durationMatch = output.match(/http_req_duration[.\s]+avg=([\d.]+)ms/);
  if (durationMatch) metrics.http_req_duration_avg = parseFloat(durationMatch[1] || '0');

  const p95Match = output.match(/p\(95\)=([\d.]+)ms/);
  if (p95Match) metrics.http_req_duration_p95 = parseFloat(p95Match[1] || '0');

  const failedMatch = output.match(/http_req_failed[.\s]+:\s+([\d.]+)%/);
  if (failedMatch) metrics.http_req_failed = parseFloat(failedMatch[1] || '0');

  const vusMatch = output.match(/vus[.\s]+:\s+(\d+)/);
  if (vusMatch) metrics.vus = parseInt(vusMatch[1] || '0');

  return metrics;
}

export default {
  listBrowsers,
  installBrowsers,
  runPlaywrightTests,
  runVisualTests,
  runCypressTests,
  runLighthouse,
  runAccessibilityTests,
  runAPITests,
  runLoadTest,
};
