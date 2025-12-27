// ============================================
// Flutter Test Platform Integration
// flutter_test, flutter drive, integration_test
// ============================================

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { TestResult, StepResult, Platform } from '../../types.js';

const execAsync = promisify(exec);

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
    const { stdout } = await execAsync('flutter devices --machine');
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
      await execAsync('flutter emulators --launch flutter_emulator');
    } else {
      await execAsync('open -a Simulator');
    }
    // Wait for emulator to boot
    await new Promise(resolve => setTimeout(resolve, 10000));
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
  const {
    projectPath,
    testPath = 'test',
    coverage = false,
    reporter = 'json',
    timeout = 300000,
  } = config;

  const coverageArg = coverage ? '--coverage' : '';
  const reporterArg = `--reporter=${reporter}`;

  const command = `cd "${projectPath}" && flutter test ${testPath} ${coverageArg} ${reporterArg} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const tests = parseFlutterTestOutput(stdout, reporter);
    const allPassed = tests.every(t => t.passed);

    let coveragePercent: number | undefined;
    if (coverage) {
      coveragePercent = await getFlutterCoverage(projectPath);
    }

    return {
      success: allPassed,
      output: stdout,
      tests,
      coverage: coveragePercent,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      tests: parseFlutterTestOutput(error.stdout || '', reporter),
    };
  }
}

function parseFlutterTestOutput(
  output: string,
  reporter: string
): { name: string; passed: boolean; duration: number; error?: string }[] {
  const tests: { name: string; passed: boolean; duration: number; error?: string }[] = [];

  if (reporter === 'json') {
    // Parse JSON lines
    const lines = output.split('\n').filter(l => l.trim().startsWith('{'));

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
        // Skip invalid JSON lines
      }
    }
  } else {
    // Parse expanded/compact format
    const testRegex = /(\d+:\d+)\s+(\+\d+(?:\s+-\d+)?)?:\s+(.*?)(?:\s+\((\d+)ms\))?$/gm;
    let match;

    while ((match = testRegex.exec(output)) !== null) {
      const statusPart = match[2] || '';
      const passed = !statusPart.includes('-');

      tests.push({
        name: match[3]?.trim() || 'Unknown',
        passed,
        duration: parseInt(match[4] || '0'),
      });
    }
  }

  return tests;
}

async function getFlutterCoverage(projectPath: string): Promise<number | undefined> {
  try {
    const lcovPath = path.join(projectPath, 'coverage', 'lcov.info');

    if (!fs.existsSync(lcovPath)) {
      return undefined;
    }

    const content = fs.readFileSync(lcovPath, 'utf-8');
    let totalLines = 0;
    let coveredLines = 0;

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('LF:')) {
        totalLines += parseInt(line.substring(3)) || 0;
      } else if (line.startsWith('LH:')) {
        coveredLines += parseInt(line.substring(3)) || 0;
      }
    }

    return totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : undefined;
  } catch {
    return undefined;
  }
}

// ============================================
// Integration Tests (flutter drive / integration_test)
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
  const {
    projectPath,
    device,
    driver = 'test_driver/integration_test.dart',
    target = 'integration_test/app_test.dart',
    timeout = 600000,
  } = config;

  const deviceArg = device ? `-d ${device}` : '';
  const screenshotDir = path.join(projectPath, '.test-genie', 'screenshots', `integration_${Date.now()}`);

  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // Check if using new integration_test package or old flutter_driver
  const useNewIntegration = fs.existsSync(path.join(projectPath, 'integration_test'));

  let command: string;
  if (useNewIntegration) {
    command = `cd "${projectPath}" && flutter test integration_test ${deviceArg} 2>&1`;
  } else {
    command = `cd "${projectPath}" && flutter drive --driver=${driver} --target=${target} ${deviceArg} 2>&1`;
  }

  const startTime = Date.now();

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    // Extract performance metrics if available
    const performanceMetrics = extractPerformanceMetrics(stdout);

    // Get screenshots from the directory
    const screenshots = fs.existsSync(screenshotDir)
      ? fs.readdirSync(screenshotDir).map(f => path.join(screenshotDir, f))
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
      output: error.stdout || error.message,
      screenshots: [],
      duration: Date.now() - startTime,
    };
  }
}

function extractPerformanceMetrics(output: string): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Parse timeline summary if available
  const avgFrameMatch = output.match(/Average frame build time:\s*([\d.]+)ms/);
  if (avgFrameMatch) {
    metrics['avgFrameBuildTime'] = parseFloat(avgFrameMatch[1] || '0');
  }

  const worstFrameMatch = output.match(/Worst frame build time:\s*([\d.]+)ms/);
  if (worstFrameMatch) {
    metrics['worstFrameBuildTime'] = parseFloat(worstFrameMatch[1] || '0');
  }

  const missedFramesMatch = output.match(/Missed frames:\s*(\d+)/);
  if (missedFramesMatch) {
    metrics['missedFrames'] = parseInt(missedFramesMatch[1] || '0');
  }

  return metrics;
}

// ============================================
// Golden Tests (Snapshot Testing)
// ============================================
export async function runGoldenTests(config: FlutterTestConfig & {
  updateGoldens?: boolean;
}): Promise<{
  success: boolean;
  output: string;
  mismatches: { name: string; diffPath: string }[];
}> {
  const {
    projectPath,
    testPath = 'test',
    updateGoldens = false,
    timeout = 300000,
  } = config;

  const updateArg = updateGoldens ? '--update-goldens' : '';
  const command = `cd "${projectPath}" && flutter test ${testPath} ${updateArg} --tags=golden 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const mismatches = parseGoldenMismatches(stdout, projectPath);

    return {
      success: mismatches.length === 0,
      output: stdout,
      mismatches,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      mismatches: parseGoldenMismatches(error.stdout || '', projectPath),
    };
  }
}

function parseGoldenMismatches(
  output: string,
  projectPath: string
): { name: string; diffPath: string }[] {
  const mismatches: { name: string; diffPath: string }[] = [];

  const mismatchRegex = /Golden file\s+([^\s]+)\s+does not match/g;
  let match;

  while ((match = mismatchRegex.exec(output)) !== null) {
    const goldenName = match[1] || '';
    const diffPath = path.join(projectPath, 'test', 'failures', `${goldenName}_diff.png`);

    mismatches.push({
      name: goldenName,
      diffPath: fs.existsSync(diffPath) ? diffPath : '',
    });
  }

  return mismatches;
}

// ============================================
// Performance Profiling
// ============================================
export interface FlutterProfileConfig {
  projectPath: string;
  device?: string;
  duration: number; // seconds
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
  const {
    projectPath,
    device,
    duration,
    target = 'lib/main.dart',
  } = config;

  const deviceArg = device ? `-d ${device}` : '';
  const tracePath = path.join(projectPath, '.test-genie', 'traces', `profile_${Date.now()}.json`);

  const traceDir = path.dirname(tracePath);
  if (!fs.existsSync(traceDir)) {
    fs.mkdirSync(traceDir, { recursive: true });
  }

  // Run with profiling
  const command = `cd "${projectPath}" && flutter run --profile ${deviceArg} --trace-startup --endless-trace-buffer 2>&1`;

  try {
    // Start the app
    const process = exec(command);
    let output = '';

    process.stdout?.on('data', (data) => {
      output += data;
    });

    // Wait for specified duration
    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    // Send 'q' to quit and get trace
    process.stdin?.write('P'); // Capture performance overlay
    await new Promise(resolve => setTimeout(resolve, 2000));
    process.stdin?.write('q');

    await new Promise<void>((resolve) => {
      process.on('exit', () => resolve());
      setTimeout(() => {
        process.kill();
        resolve();
      }, 5000);
    });

    // Parse metrics from output
    const metrics = parsePerformanceOutput(output);

    return {
      success: true,
      tracePath,
      metrics,
    };
  } catch (error) {
    return {
      success: false,
      tracePath,
      metrics: {
        avgFPS: 0,
        worstFPS: 0,
        avgFrameBuildTime: 0,
        avgFrameRasterTime: 0,
        jankFrames: 0,
        memoryMB: 0,
      },
    };
  }
}

function parsePerformanceOutput(output: string): {
  avgFPS: number;
  worstFPS: number;
  avgFrameBuildTime: number;
  avgFrameRasterTime: number;
  jankFrames: number;
  memoryMB: number;
} {
  const metrics = {
    avgFPS: 60,
    worstFPS: 60,
    avgFrameBuildTime: 0,
    avgFrameRasterTime: 0,
    jankFrames: 0,
    memoryMB: 0,
  };

  // Parse DevTools-style metrics
  const fpsMatch = output.match(/(\d+)\s*fps/i);
  if (fpsMatch) {
    metrics.avgFPS = parseInt(fpsMatch[1] || '60');
  }

  const memoryMatch = output.match(/Memory:\s*([\d.]+)\s*MB/i);
  if (memoryMatch) {
    metrics.memoryMB = parseFloat(memoryMatch[1] || '0');
  }

  const buildTimeMatch = output.match(/Build:\s*([\d.]+)ms/);
  if (buildTimeMatch) {
    metrics.avgFrameBuildTime = parseFloat(buildTimeMatch[1] || '0');
  }

  const rasterTimeMatch = output.match(/Raster:\s*([\d.]+)ms/);
  if (rasterTimeMatch) {
    metrics.avgFrameRasterTime = parseFloat(rasterTimeMatch[1] || '0');
  }

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

  const deviceArg = device ? `-d ${device}` : '';
  const command = `cd "${projectPath}" && flutter run --profile ${deviceArg} 2>&1`;

  const heapUsage: { time: number; usedMB: number; capacityMB: number }[] = [];
  const startTime = Date.now();

  try {
    const process = exec(command);
    let output = '';

    process.stdout?.on('data', (data) => {
      output += data;

      // Parse memory info from output
      const memMatch = data.toString().match(/Memory usage:\s*([\d.]+)\s*MB\s*\/\s*([\d.]+)\s*MB/);
      if (memMatch) {
        heapUsage.push({
          time: Date.now() - startTime,
          usedMB: parseFloat(memMatch[1] || '0'),
          capacityMB: parseFloat(memMatch[2] || '0'),
        });
      }
    });

    // Monitor for specified duration
    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    process.stdin?.write('q');
    await new Promise<void>((resolve) => {
      process.on('exit', () => resolve());
      setTimeout(() => {
        process.kill();
        resolve();
      }, 5000);
    });

    // Analyze for potential leaks
    const { leaks, recommendations } = analyzeHeapPattern(heapUsage);

    return {
      success: true,
      heapUsage,
      leaks,
      recommendations,
    };
  } catch (error) {
    return {
      success: false,
      heapUsage,
      leaks: [],
      recommendations: [],
    };
  }
}

function analyzeHeapPattern(
  heapUsage: { time: number; usedMB: number; capacityMB: number }[]
): { leaks: string[]; recommendations: string[] } {
  const leaks: string[] = [];
  const recommendations: string[] = [];

  if (heapUsage.length < 2) {
    return { leaks, recommendations };
  }

  // Check for continuous memory growth
  let growthCount = 0;
  for (let i = 1; i < heapUsage.length; i++) {
    const prev = heapUsage[i - 1];
    const curr = heapUsage[i];
    if (prev && curr && curr.usedMB > prev.usedMB) {
      growthCount++;
    }
  }

  const growthRatio = growthCount / (heapUsage.length - 1);

  if (growthRatio > 0.8) {
    leaks.push('Continuous memory growth detected - potential memory leak');
    recommendations.push('Review dispose() implementations in StatefulWidgets');
    recommendations.push('Check for proper StreamSubscription cancellation');
    recommendations.push('Verify AnimationController disposal');
  }

  // Check for high memory usage
  const maxUsage = Math.max(...heapUsage.map(h => h.usedMB));
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
  options?: {
    release?: boolean;
    flavor?: string;
    target?: string;
  }
): Promise<{ success: boolean; outputPath: string; output: string }> {
  const { release = true, flavor, target } = options || {};

  const modeArg = release ? '--release' : '--debug';
  const flavorArg = flavor ? `--flavor ${flavor}` : '';
  const targetArg = target ? `-t ${target}` : '';

  const buildCommand = platform === 'web' ? 'web' : platform;
  const command = `cd "${projectPath}" && flutter build ${buildCommand} ${modeArg} ${flavorArg} ${targetArg} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

    let outputPath = '';
    switch (platform) {
      case 'apk':
        outputPath = path.join(projectPath, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');
        break;
      case 'appbundle':
        outputPath = path.join(projectPath, 'build', 'app', 'outputs', 'bundle', 'release', 'app-release.aab');
        break;
      case 'ios':
      case 'ipa':
        outputPath = path.join(projectPath, 'build', 'ios', 'iphoneos', 'Runner.app');
        break;
      case 'web':
        outputPath = path.join(projectPath, 'build', 'web');
        break;
    }

    return {
      success: stdout.includes('Built') || stdout.includes('build succeeded'),
      outputPath,
      output: stdout,
    };
  } catch (error: any) {
    return {
      success: false,
      outputPath: '',
      output: error.stdout || error.message,
    };
  }
}

export async function installApp(device: string, appPath: string): Promise<boolean> {
  try {
    await execAsync(`flutter install --device-id=${device} 2>&1`);
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
    // Use platform-specific screenshot command
    const { stdout } = await execAsync('flutter devices --machine');
    const devices = JSON.parse(stdout);
    const targetDevice = devices.find((d: any) => d.id === device);

    if (!targetDevice) {
      return false;
    }

    if (targetDevice.targetPlatform?.includes('android')) {
      await execAsync(`adb -s ${device} exec-out screencap -p > "${outputPath}"`);
    } else if (targetDevice.targetPlatform?.includes('ios')) {
      await execAsync(`xcrun simctl io ${device} screenshot "${outputPath}"`);
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
