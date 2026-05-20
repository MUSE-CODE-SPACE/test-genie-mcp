// ============================================
// Flutter Test Platform Integration
// flutter_test, flutter drive, integration_test
//
// v3.0.0: spawn + argv arrays. See SECURITY.md.
// ============================================

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  runProcess,
  ensureMatches,
  ID_ALLOWLIST,
} from '../../core/subprocess.js';

export interface FlutterDevice {
  id: string;
  name: string;
  platform: 'android' | 'ios' | 'web' | 'macos' | 'windows' | 'linux';
  emulator: boolean;
}

export interface FlutterTestConfig {
  projectPath: string;
  testPath?: string;
  device?: string;
  flavor?: string;
  coverage?: boolean;
  reporter?: 'compact' | 'expanded' | 'json';
  timeout?: number;
}

// ============================================
// Device Management
// ============================================
export async function listDevices(): Promise<FlutterDevice[]> {
  try {
    const { stdout } = await runProcess('flutter', ['devices', '--machine']);
    const devices = JSON.parse(stdout);
    return devices.map((d: any) => ({
      id: d.id,
      name: d.name,
      platform: d.targetPlatform?.split('.')[1] || 'unknown',
      emulator: d.emulator || false,
    }));
  } catch (error) {
    console.error('Failed to list Flutter devices:', error);
    return [];
  }
}

export async function runEmulator(platform: 'android' | 'ios'): Promise<boolean> {
  try {
    if (platform === 'android') {
      await runProcess('flutter', ['emulators', '--launch', 'flutter_emulator'], { ignoreExitCode: true });
    } else {
      await runProcess('open', ['-a', 'Simulator']);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Unit & Widget Tests (flutter test)
// ============================================
export async function runFlutterTest(config: FlutterTestConfig): Promise<{
  success: boolean;
  output: string;
  tests: { name: string; passed: boolean; duration: number; error?: string }[];
  coverage?: number;
}> {
  const { projectPath, testPath = 'test', coverage = false, reporter = 'json', timeout = 300000 } = config;
  ensureMatches(testPath, /^[A-Za-z0-9._/-]+$/, 'testPath');

  const args = ['test', testPath];
  if (coverage) args.push('--coverage');
  args.push(`--reporter=${reporter}`);

  try {
    const { stdout } = await runProcess('flutter', args, { cwd: projectPath, timeout, ignoreExitCode: true });
    const tests = parseFlutterTestOutput(stdout, reporter);
    const allPassed = tests.length > 0 && tests.every((t) => t.passed);
    const coveragePercent = coverage ? await getFlutterCoverage(projectPath) : undefined;
    return { success: allPassed, output: stdout, tests, coverage: coveragePercent };
  } catch (error: any) {
    return { success: false, output: error.message || String(error), tests: [] };
  }
}

function parseFlutterTestOutput(
  output: string,
  reporter: string,
): { name: string; passed: boolean; duration: number; error?: string }[] {
  const tests: { name: string; passed: boolean; duration: number; error?: string }[] = [];
  if (reporter === 'json') {
    const lines = output.split('\n').filter((l) => l.trim().startsWith('{'));
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'testDone') {
          tests.push({
            name: event.name || `Test ${event.testID}`,
            passed: event.result === 'success',
            duration: event.time || 0,
            error: event.result !== 'success' ? event.error : undefined,
          });
        }
      } catch {
        // Skip invalid lines
      }
    }
  } else {
    const testRegex = /(\d+:\d+)\s+(\+\d+(?:\s+-\d+)?)?:\s+(.*?)(?:\s+\((\d+)ms\))?$/gm;
    let match;
    while ((match = testRegex.exec(output)) !== null) {
      const statusPart = match[2] || '';
      const passed = !statusPart.includes('-');
      tests.push({ name: match[3]?.trim() || 'Unknown', passed, duration: parseInt(match[4] || '0') });
    }
  }
  return tests;
}

async function getFlutterCoverage(projectPath: string): Promise<number | undefined> {
  try {
    const lcovPath = path.join(projectPath, 'coverage', 'lcov.info');
    if (!fs.existsSync(lcovPath)) return undefined;
    const content = fs.readFileSync(lcovPath, 'utf-8');
    let totalLines = 0;
    let coveredLines = 0;
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('LF:')) totalLines += parseInt(line.substring(3)) || 0;
      else if (line.startsWith('LH:')) coveredLines += parseInt(line.substring(3)) || 0;
    }
    return totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : undefined;
  } catch {
    return undefined;
  }
}

// ============================================
// Integration Tests
// ============================================
export async function runIntegrationTest(config: FlutterTestConfig & {
  driver?: string;
  target?: string;
}): Promise<{
  success: boolean;
  output: string;
  screenshots: string[];
  duration: number;
  performanceMetrics?: Record<string, number>;
}> {
  const { projectPath, device, driver = 'test_driver/integration_test.dart', target = 'integration_test/app_test.dart', timeout = 600000 } = config;
  if (device) ensureMatches(device, /^[A-Za-z0-9._-]+$/, 'device');
  ensureMatches(driver, /^[A-Za-z0-9._/-]+$/, 'driver');
  ensureMatches(target, /^[A-Za-z0-9._/-]+$/, 'target');

  const screenshotDir = path.join(projectPath, '.test-genie', 'screenshots', `integration_${Date.now()}`);
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  const useNewIntegration = fs.existsSync(path.join(projectPath, 'integration_test'));
  const args = useNewIntegration
    ? ['test', 'integration_test', ...(device ? ['-d', device] : [])]
    : ['drive', `--driver=${driver}`, `--target=${target}`, ...(device ? ['-d', device] : [])];

  const startTime = Date.now();
  try {
    const { stdout } = await runProcess('flutter', args, { cwd: projectPath, timeout, ignoreExitCode: true });
    const performanceMetrics = extractPerformanceMetrics(stdout);
    const screenshots = fs.existsSync(screenshotDir)
      ? fs.readdirSync(screenshotDir).map((f) => path.join(screenshotDir, f))
      : [];
    return {
      success: !stdout.includes('FAILED') && !stdout.includes('Some tests failed'),
      output: stdout,
      screenshots,
      duration: Date.now() - startTime,
      performanceMetrics,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.message || String(error),
      screenshots: [],
      duration: Date.now() - startTime,
    };
  }
}

function extractPerformanceMetrics(output: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  const avgFrameMatch = output.match(/Average frame build time:\s*([\d.]+)ms/);
  if (avgFrameMatch) metrics['avgFrameBuildTime'] = parseFloat(avgFrameMatch[1] || '0');
  const worstFrameMatch = output.match(/Worst frame build time:\s*([\d.]+)ms/);
  if (worstFrameMatch) metrics['worstFrameBuildTime'] = parseFloat(worstFrameMatch[1] || '0');
  const missedFramesMatch = output.match(/Missed frames:\s*(\d+)/);
  if (missedFramesMatch) metrics['missedFrames'] = parseInt(missedFramesMatch[1] || '0');
  return metrics;
}

// ============================================
// Golden Tests
// ============================================
export async function runGoldenTests(config: FlutterTestConfig & { updateGoldens?: boolean }): Promise<{
  success: boolean;
  output: string;
  mismatches: { name: string; diffPath: string }[];
}> {
  const { projectPath, testPath = 'test', updateGoldens = false, timeout = 300000 } = config;
  ensureMatches(testPath, /^[A-Za-z0-9._/-]+$/, 'testPath');

  const args = ['test', testPath];
  if (updateGoldens) args.push('--update-goldens');
  args.push('--tags=golden');

  try {
    const { stdout } = await runProcess('flutter', args, { cwd: projectPath, timeout, ignoreExitCode: true });
    const mismatches = parseGoldenMismatches(stdout, projectPath);
    return { success: mismatches.length === 0, output: stdout, mismatches };
  } catch (error: any) {
    return {
      success: false,
      output: error.message || String(error),
      mismatches: parseGoldenMismatches('', projectPath),
    };
  }
}

function parseGoldenMismatches(output: string, projectPath: string): { name: string; diffPath: string }[] {
  const mismatches: { name: string; diffPath: string }[] = [];
  const mismatchRegex = /Golden file\s+([^\s]+)\s+does not match/g;
  let match;
  while ((match = mismatchRegex.exec(output)) !== null) {
    const goldenName = match[1] || '';
    const diffPath = path.join(projectPath, 'test', 'failures', `${goldenName}_diff.png`);
    mismatches.push({ name: goldenName, diffPath: fs.existsSync(diffPath) ? diffPath : '' });
  }
  return mismatches;
}

// ============================================
// Performance Profiling
// ============================================
export interface FlutterProfileConfig {
  projectPath: string;
  device?: string;
  duration: number;
  target?: string;
}

export async function runPerformanceProfile(config: FlutterProfileConfig): Promise<{
  success: boolean;
  tracePath: string;
  metrics: {
    avgFPS: number;
    worstFPS: number;
    avgFrameBuildTime: number;
    avgFrameRasterTime: number;
    jankFrames: number;
    memoryMB: number;
  };
}> {
  const { projectPath, device, duration, target = 'lib/main.dart' } = config;
  if (device) ensureMatches(device, ID_ALLOWLIST, 'device');
  ensureMatches(target, /^[A-Za-z0-9._/-]+$/, 'target');

  const tracePath = path.join(projectPath, '.test-genie', 'traces', `profile_${Date.now()}.json`);
  if (!fs.existsSync(path.dirname(tracePath))) fs.mkdirSync(path.dirname(tracePath), { recursive: true });

  const args = ['run', '--profile'];
  if (device) args.push('-d', device);
  args.push('--trace-startup', '--endless-trace-buffer');

  try {
    let output = '';
    const child: ChildProcess = spawn('flutter', args, {
      cwd: projectPath,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => (output += d.toString()));
    child.stderr?.on('data', (d) => (output += d.toString()));

    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    child.stdin?.write('P');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    child.stdin?.write('q');

    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      setTimeout(() => { child.kill(); resolve(); }, 5000);
    });

    return { success: true, tracePath, metrics: parsePerformanceOutput(output) };
  } catch {
    return {
      success: false,
      tracePath,
      metrics: { avgFPS: 0, worstFPS: 0, avgFrameBuildTime: 0, avgFrameRasterTime: 0, jankFrames: 0, memoryMB: 0 },
    };
  }
}

function parsePerformanceOutput(output: string) {
  const metrics = {
    avgFPS: 60, worstFPS: 60, avgFrameBuildTime: 0, avgFrameRasterTime: 0, jankFrames: 0, memoryMB: 0,
  };
  const fpsMatch = output.match(/(\d+)\s*fps/i);
  if (fpsMatch) metrics.avgFPS = parseInt(fpsMatch[1] || '60');
  const memoryMatch = output.match(/Memory:\s*([\d.]+)\s*MB/i);
  if (memoryMatch) metrics.memoryMB = parseFloat(memoryMatch[1] || '0');
  const buildTimeMatch = output.match(/Build:\s*([\d.]+)ms/);
  if (buildTimeMatch) metrics.avgFrameBuildTime = parseFloat(buildTimeMatch[1] || '0');
  const rasterTimeMatch = output.match(/Raster:\s*([\d.]+)ms/);
  if (rasterTimeMatch) metrics.avgFrameRasterTime = parseFloat(rasterTimeMatch[1] || '0');
  return metrics;
}

// ============================================
// Memory Analysis
// ============================================
export async function analyzeMemory(config: {
  projectPath: string;
  device?: string;
  duration: number;
}): Promise<{
  success: boolean;
  heapUsage: { time: number; usedMB: number; capacityMB: number }[];
  leaks: string[];
  recommendations: string[];
}> {
  const { projectPath, device, duration } = config;
  if (device) ensureMatches(device, ID_ALLOWLIST, 'device');

  const args = ['run', '--profile'];
  if (device) args.push('-d', device);

  const heapUsage: { time: number; usedMB: number; capacityMB: number }[] = [];
  const startTime = Date.now();

  try {
    const child = spawn('flutter', args, {
      cwd: projectPath,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      const memMatch = text.match(/Memory usage:\s*([\d.]+)\s*MB\s*\/\s*([\d.]+)\s*MB/);
      if (memMatch) {
        heapUsage.push({
          time: Date.now() - startTime,
          usedMB: parseFloat(memMatch[1] || '0'),
          capacityMB: parseFloat(memMatch[2] || '0'),
        });
      }
    });

    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    child.stdin?.write('q');
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      setTimeout(() => { child.kill(); resolve(); }, 5000);
    });

    const { leaks, recommendations } = analyzeHeapPattern(heapUsage);
    return { success: true, heapUsage, leaks, recommendations };
  } catch {
    return { success: false, heapUsage, leaks: [], recommendations: [] };
  }
}

function analyzeHeapPattern(heapUsage: { time: number; usedMB: number; capacityMB: number }[]) {
  const leaks: string[] = [];
  const recommendations: string[] = [];
  if (heapUsage.length < 2) return { leaks, recommendations };
  let growthCount = 0;
  for (let i = 1; i < heapUsage.length; i++) {
    const prev = heapUsage[i - 1];
    const curr = heapUsage[i];
    if (prev && curr && curr.usedMB > prev.usedMB) growthCount++;
  }
  const growthRatio = growthCount / (heapUsage.length - 1);
  if (growthRatio > 0.8) {
    leaks.push('Continuous memory growth detected - potential memory leak');
    recommendations.push('Review dispose() implementations in StatefulWidgets');
    recommendations.push('Check for proper StreamSubscription cancellation');
    recommendations.push('Verify AnimationController disposal');
  }
  const maxUsage = Math.max(...heapUsage.map((h) => h.usedMB));
  if (maxUsage > 500) {
    recommendations.push('High memory usage detected - consider lazy loading');
    recommendations.push('Review image caching strategy');
  }
  return { leaks, recommendations };
}

// ============================================
// App Build & Installation
// ============================================
export async function buildApp(
  projectPath: string,
  platform: 'apk' | 'appbundle' | 'ios' | 'ipa' | 'web',
  options?: { release?: boolean; flavor?: string; target?: string },
): Promise<{ success: boolean; outputPath: string; output: string }> {
  const { release = true, flavor, target } = options || {};
  if (flavor) ensureMatches(flavor, ID_ALLOWLIST, 'flavor');
  if (target) ensureMatches(target, /^[A-Za-z0-9._/-]+$/, 'target');

  const buildCommand = platform === 'web' ? 'web' : platform;
  const args = ['build', buildCommand];
  if (release) args.push('--release');
  else args.push('--debug');
  if (flavor) args.push('--flavor', flavor);
  if (target) args.push('-t', target);

  try {
    const { stdout } = await runProcess('flutter', args, {
      cwd: projectPath, timeout: 600000, ignoreExitCode: true,
    });
    let outputPath = '';
    switch (platform) {
      case 'apk': outputPath = path.join(projectPath, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk'); break;
      case 'appbundle': outputPath = path.join(projectPath, 'build', 'app', 'outputs', 'bundle', 'release', 'app-release.aab'); break;
      case 'ios':
      case 'ipa': outputPath = path.join(projectPath, 'build', 'ios', 'iphoneos', 'Runner.app'); break;
      case 'web': outputPath = path.join(projectPath, 'build', 'web'); break;
    }
    return {
      success: stdout.includes('Built') || stdout.includes('build succeeded'),
      outputPath,
      output: stdout,
    };
  } catch (error: any) {
    return { success: false, outputPath: '', output: error.message || String(error) };
  }
}

export async function installApp(device: string, _appPath: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    await runProcess('flutter', ['install', `--device-id=${device}`]);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Screenshot & Recording
// ============================================
export async function takeScreenshot(device: string, outputPath: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    const { stdout } = await runProcess('flutter', ['devices', '--machine']);
    const devices = JSON.parse(stdout);
    const targetDevice = devices.find((d: any) => d.id === device);
    if (!targetDevice) return false;

    if (targetDevice.targetPlatform?.includes('android')) {
      const safePath = outputPath.replace(/'/g, "'\\''");
      await runProcess('sh', ['-c', `adb -s ${device} exec-out screencap -p > '${safePath}'`], {
        skipAllowlist: true,
      });
    } else if (targetDevice.targetPlatform?.includes('ios')) {
      await runProcess('xcrun', ['simctl', 'io', device, 'screenshot', outputPath]);
    }
    return true;
  } catch {
    return false;
  }
}

export default {
  listDevices,
  runEmulator,
  runFlutterTest,
  runIntegrationTest,
  runGoldenTests,
  runPerformanceProfile,
  analyzeMemory,
  buildApp,
  installApp,
  takeScreenshot,
};
