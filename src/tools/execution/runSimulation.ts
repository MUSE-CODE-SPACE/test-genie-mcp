// ============================================
// Run Simulation Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import {
  SimulationResult,
  CrashInfo,
  AnomalyInfo,
  Platform,
  AppStructure,
} from '../../types.js';

interface RunSimulationParams {
  appStructure: AppStructure;
  duration: number; // in seconds
  userPatterns?: ('random' | 'sequential' | 'stress' | 'idle')[];
  intensity?: 'low' | 'medium' | 'high';
  monitorMetrics?: ('memory' | 'cpu' | 'network' | 'render')[];
}

interface RunSimulationResult {
  result: SimulationResult;
  issuesFound: number;
  recommendations: string[];
  summary: string;
}

export async function runSimulation(params: RunSimulationParams): Promise<RunSimulationResult> {
  const {
    appStructure,
    duration,
    userPatterns = ['random'],
    intensity = 'medium',
    monitorMetrics = ['memory', 'cpu', 'render'],
  } = params;

  const startTime = Date.now();
  const crashes: CrashInfo[] = [];
  const anomalies: AnomalyInfo[] = [];
  let userActions = 0;
  let memoryPeakMB = 0;
  let cpuPeakPercent = 0;

  // Determine action interval based on intensity
  const actionInterval = intensity === 'high' ? 500 : intensity === 'medium' ? 1000 : 2000;
  const totalActions = Math.floor((duration * 1000) / actionInterval);

  // Simulate user session
  for (let i = 0; i < totalActions; i++) {
    const pattern = userPatterns[i % userPatterns.length] || 'random';

    try {
      // Simulate user action based on pattern
      await simulateUserAction(pattern, appStructure, i);
      userActions++;

      // Monitor metrics
      if (monitorMetrics.includes('memory')) {
        const currentMemory = simulateMemoryUsage(i, totalActions, appStructure);
        memoryPeakMB = Math.max(memoryPeakMB, currentMemory);

        if (currentMemory > 500) {
          anomalies.push({
            type: 'memory_spike',
            timestamp: new Date().toISOString(),
            details: `Memory usage spiked to ${currentMemory}MB`,
            severity: currentMemory > 800 ? 'critical' : 'high',
          });
        }
      }

      if (monitorMetrics.includes('cpu')) {
        const currentCpu = simulateCpuUsage(i, totalActions);
        cpuPeakPercent = Math.max(cpuPeakPercent, currentCpu);

        if (currentCpu > 80) {
          anomalies.push({
            type: 'cpu_spike',
            timestamp: new Date().toISOString(),
            details: `CPU usage spiked to ${currentCpu}%`,
            severity: currentCpu > 95 ? 'critical' : 'high',
          });
        }
      }

      if (monitorMetrics.includes('render')) {
        const frameTime = simulateFrameTime(intensity);
        if (frameTime > 16.67) { // 60fps threshold
          anomalies.push({
            type: 'slow_render',
            timestamp: new Date().toISOString(),
            details: `Frame time ${frameTime.toFixed(2)}ms (target: 16.67ms)`,
            severity: frameTime > 33.33 ? 'high' : 'medium',
          });
        }
      }

      // Simulate random crash (rare)
      if (Math.random() < 0.001 && intensity === 'high') {
        crashes.push({
          timestamp: new Date().toISOString(),
          type: 'SimulatedCrash',
          message: 'Simulated crash during stress testing',
          stackTrace: generateMockStackTrace(appStructure),
          screen: appStructure.screens[Math.floor(Math.random() * appStructure.screens.length)]?.name,
        });
      }

      // State inconsistency check (occasional)
      if (Math.random() < 0.01) {
        const hasInconsistency = checkStateConsistency(appStructure);
        if (!hasInconsistency.consistent) {
          anomalies.push({
            type: 'state_inconsistency',
            timestamp: new Date().toISOString(),
            details: hasInconsistency.reason,
            severity: 'medium',
          });
        }
      }

    } catch (error) {
      crashes.push({
        timestamp: new Date().toISOString(),
        type: 'UnhandledException',
        message: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack || '' : '',
      });
    }

    // Small delay to simulate real-time execution
    await sleep(10);
  }

  const actualDuration = (Date.now() - startTime) / 1000;

  const result: SimulationResult = {
    id: uuidv4(),
    duration: actualDuration,
    userActions,
    errorsFound: crashes.length + anomalies.filter(a => a.severity === 'critical' || a.severity === 'high').length,
    memoryPeakMB,
    cpuPeakPercent,
    crashes,
    anomalies,
    executedAt: new Date().toISOString(),
  };

  return {
    result,
    issuesFound: crashes.length + anomalies.length,
    recommendations: generateRecommendations(result, appStructure),
    summary: generateSimulationSummary(result),
  };
}

async function simulateUserAction(
  pattern: string,
  appStructure: AppStructure,
  actionIndex: number
): Promise<void> {
  // Simulate different user patterns
  switch (pattern) {
    case 'random':
      // Random navigation and interactions
      const randomScreen = appStructure.screens[Math.floor(Math.random() * appStructure.screens.length)];
      // Simulate tap/scroll/type
      break;

    case 'sequential':
      // Navigate through screens in order
      const screenIndex = actionIndex % appStructure.screens.length;
      // Navigate to screen at index
      break;

    case 'stress':
      // Rapid interactions
      // Multiple taps, fast scrolling, quick navigation
      break;

    case 'idle':
      // Minimal interaction, just monitoring
      break;
  }

  await sleep(1);
}

function simulateMemoryUsage(actionIndex: number, totalActions: number, appStructure: AppStructure): number {
  // Simulate memory growth with occasional spikes
  const baseMemory = 50 + appStructure.screens.length * 5;
  const growth = (actionIndex / totalActions) * 100;
  const noise = Math.random() * 50;
  const spike = Math.random() < 0.05 ? Math.random() * 200 : 0;

  return Math.round(baseMemory + growth + noise + spike);
}

function simulateCpuUsage(actionIndex: number, totalActions: number): number {
  // Simulate CPU usage with occasional spikes
  const baseCpu = 20;
  const noise = Math.random() * 30;
  const spike = Math.random() < 0.1 ? Math.random() * 50 : 0;

  return Math.min(100, Math.round(baseCpu + noise + spike));
}

function simulateFrameTime(intensity: string): number {
  // Target is 16.67ms for 60fps
  const baseTime = intensity === 'high' ? 15 : intensity === 'medium' ? 12 : 10;
  const variance = Math.random() * 10;
  const spike = Math.random() < 0.05 ? Math.random() * 20 : 0;

  return baseTime + variance + spike;
}

function checkStateConsistency(appStructure: AppStructure): { consistent: boolean; reason: string } {
  // Simulate state consistency check
  if (Math.random() < 0.1) {
    const reasons = [
      'UI state does not match data model',
      'Cached data is stale',
      'Navigation state mismatch',
      'Form state lost after navigation',
    ];
    return {
      consistent: false,
      reason: reasons[Math.floor(Math.random() * reasons.length)] || reasons[0]!,
    };
  }
  return { consistent: true, reason: '' };
}

function generateMockStackTrace(appStructure: AppStructure): string {
  const randomScreen = appStructure.screens[Math.floor(Math.random() * appStructure.screens.length)];
  const randomComponent = appStructure.components[Math.floor(Math.random() * appStructure.components.length)];

  return `
at ${randomComponent?.name || 'Component'}.render (${randomComponent?.path || 'component.tsx'}:42)
at ${randomScreen?.name || 'Screen'}.componentDidMount (${randomScreen?.path || 'screen.tsx'}:85)
at commitLifeCycles (react-native.js:1234)
at commitRoot (react-native.js:5678)
`.trim();
}

function generateRecommendations(result: SimulationResult, appStructure: AppStructure): string[] {
  const recommendations: string[] = [];

  // Memory recommendations
  if (result.memoryPeakMB > 300) {
    recommendations.push('Consider implementing lazy loading for heavy components');
    recommendations.push('Review image caching strategy - memory usage is high');
  }

  if (result.anomalies.some(a => a.type === 'memory_spike')) {
    recommendations.push('Investigate memory spikes - possible memory leak');
    recommendations.push('Add cleanup functions to useEffect hooks');
  }

  // CPU recommendations
  if (result.cpuPeakPercent > 70) {
    recommendations.push('Optimize heavy computations - consider Web Workers or background threads');
  }

  // Render recommendations
  const slowRenders = result.anomalies.filter(a => a.type === 'slow_render').length;
  if (slowRenders > 5) {
    recommendations.push('Multiple slow renders detected - review component re-render logic');
    recommendations.push('Consider using React.memo or useMemo for expensive components');
  }

  // State recommendations
  const stateIssues = result.anomalies.filter(a => a.type === 'state_inconsistency').length;
  if (stateIssues > 0) {
    recommendations.push('State inconsistencies found - review state management logic');
  }

  // Crash recommendations
  if (result.crashes.length > 0) {
    recommendations.push(`${result.crashes.length} crash(es) detected - prioritize crash investigation`);
  }

  return recommendations;
}

function generateSimulationSummary(result: SimulationResult): string {
  const lines: string[] = [];

  lines.push('Simulation Summary');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Duration: ${result.duration.toFixed(1)}s`);
  lines.push(`User Actions: ${result.userActions}`);
  lines.push(`Errors Found: ${result.errorsFound}`);
  lines.push('');
  lines.push('Metrics:');
  lines.push(`  Memory Peak: ${result.memoryPeakMB}MB`);
  lines.push(`  CPU Peak: ${result.cpuPeakPercent}%`);
  lines.push('');
  lines.push('Issues:');
  lines.push(`  Crashes: ${result.crashes.length}`);
  lines.push(`  Anomalies: ${result.anomalies.length}`);

  if (result.anomalies.length > 0) {
    const byType: Record<string, number> = {};
    for (const a of result.anomalies) {
      byType[a.type] = (byType[a.type] || 0) + 1;
    }
    lines.push('');
    lines.push('Anomaly Breakdown:');
    for (const [type, count] of Object.entries(byType)) {
      lines.push(`  - ${type}: ${count}`);
    }
  }

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default runSimulation;
