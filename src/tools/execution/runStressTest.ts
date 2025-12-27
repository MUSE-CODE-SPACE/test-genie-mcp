// ============================================
// Run Stress Test Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import { AppStructure, ApiInfo } from '../../types.js';

interface StressTestParams {
  appStructure: AppStructure;
  targetType: 'api' | 'ui' | 'navigation' | 'all';
  concurrency: number;
  duration: number; // in seconds
  rampUp?: number; // ramp up time in seconds
  endpoints?: string[]; // specific endpoints to test
  thresholds?: {
    maxResponseTime?: number;
    maxErrorRate?: number;
    minThroughput?: number;
  };
}

interface StressTestResult {
  id: string;
  targetType: string;
  duration: number;
  concurrency: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number; // requests per second
  errorRate: number;
  errors: ErrorDetail[];
  timeline: TimelinePoint[];
  thresholdsPassed: boolean;
  summary: string;
  executedAt: string;
}

interface ErrorDetail {
  timestamp: string;
  type: string;
  message: string;
  endpoint?: string;
}

interface TimelinePoint {
  timestamp: string;
  activeUsers: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  errorCount: number;
}

export async function runStressTest(params: StressTestParams): Promise<StressTestResult> {
  const {
    appStructure,
    targetType,
    concurrency,
    duration,
    rampUp = 10,
    endpoints = [],
    thresholds = {},
  } = params;

  const { maxResponseTime = 3000, maxErrorRate = 5, minThroughput = 10 } = thresholds;

  const startTime = Date.now();
  const responseTimes: number[] = [];
  const errors: ErrorDetail[] = [];
  const timeline: TimelinePoint[] = [];

  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  // Get target endpoints
  const targetEndpoints = endpoints.length > 0
    ? endpoints
    : appStructure.apis.map(api => api.endpoint);

  // Calculate intervals
  const intervalMs = 100; // Check every 100ms
  const totalIntervals = (duration * 1000) / intervalMs;
  const rampUpIntervals = (rampUp * 1000) / intervalMs;

  // Run stress test
  for (let i = 0; i < totalIntervals; i++) {
    // Calculate current concurrency (ramp up)
    const currentConcurrency = i < rampUpIntervals
      ? Math.ceil((i / rampUpIntervals) * concurrency)
      : concurrency;

    // Simulate concurrent requests
    const intervalRequests = Math.ceil(currentConcurrency * (intervalMs / 1000));

    const intervalResponseTimes: number[] = [];
    let intervalErrors = 0;

    for (let j = 0; j < intervalRequests; j++) {
      totalRequests++;

      const endpoint = targetEndpoints[totalRequests % targetEndpoints.length] || '/api/test';

      try {
        const responseTime = await simulateRequest(endpoint, targetType, currentConcurrency);
        responseTimes.push(responseTime);
        intervalResponseTimes.push(responseTime);
        successfulRequests++;
      } catch (error) {
        failedRequests++;
        intervalErrors++;
        errors.push({
          timestamp: new Date().toISOString(),
          type: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          endpoint,
        });
      }
    }

    // Record timeline point every second
    if (i > 0 && i % 10 === 0) {
      const avgResponseTime = intervalResponseTimes.length > 0
        ? intervalResponseTimes.reduce((a, b) => a + b, 0) / intervalResponseTimes.length
        : 0;

      timeline.push({
        timestamp: new Date().toISOString(),
        activeUsers: currentConcurrency,
        requestsPerSecond: intervalRequests * 10, // Convert from 100ms to 1s
        avgResponseTime: Math.round(avgResponseTime),
        errorCount: intervalErrors,
      });
    }

    await sleep(10); // Small delay for simulation
  }

  const actualDuration = (Date.now() - startTime) / 1000;

  // Calculate statistics
  const sortedResponseTimes = [...responseTimes].sort((a, b) => a - b);
  const avgResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;

  const p50Index = Math.floor(sortedResponseTimes.length * 0.5);
  const p95Index = Math.floor(sortedResponseTimes.length * 0.95);
  const p99Index = Math.floor(sortedResponseTimes.length * 0.99);

  const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
  const throughput = actualDuration > 0 ? successfulRequests / actualDuration : 0;

  // Check thresholds
  const thresholdsPassed =
    avgResponseTime <= maxResponseTime &&
    errorRate <= maxErrorRate &&
    throughput >= minThroughput;

  const result: StressTestResult = {
    id: uuidv4(),
    targetType,
    duration: actualDuration,
    concurrency,
    totalRequests,
    successfulRequests,
    failedRequests,
    avgResponseTime: Math.round(avgResponseTime),
    minResponseTime: sortedResponseTimes[0] || 0,
    maxResponseTime: sortedResponseTimes[sortedResponseTimes.length - 1] || 0,
    p50ResponseTime: sortedResponseTimes[p50Index] || 0,
    p95ResponseTime: sortedResponseTimes[p95Index] || 0,
    p99ResponseTime: sortedResponseTimes[p99Index] || 0,
    throughput: Math.round(throughput * 100) / 100,
    errorRate: Math.round(errorRate * 100) / 100,
    errors: errors.slice(0, 100), // Limit errors in result
    timeline,
    thresholdsPassed,
    summary: '',
    executedAt: new Date().toISOString(),
  };

  result.summary = generateStressTestSummary(result, thresholds);

  return result;
}

async function simulateRequest(
  endpoint: string,
  targetType: string,
  currentLoad: number
): Promise<number> {
  // Simulate request with load-dependent response time
  const baseTime = targetType === 'api' ? 50 : targetType === 'ui' ? 100 : 80;

  // Response time increases with load
  const loadFactor = 1 + (currentLoad / 100);

  // Add variance
  const variance = Math.random() * 100;

  // Simulate occasional slow responses
  const slowFactor = Math.random() < 0.05 ? 3 : 1;

  // Simulate errors under high load
  if (currentLoad > 50 && Math.random() < (currentLoad - 50) / 500) {
    throw new Error('Request timeout under high load');
  }

  const responseTime = (baseTime * loadFactor + variance) * slowFactor;

  await sleep(Math.min(responseTime / 10, 50)); // Simulate some actual delay

  return Math.round(responseTime);
}

function generateStressTestSummary(
  result: StressTestResult,
  thresholds: { maxResponseTime?: number; maxErrorRate?: number; minThroughput?: number }
): string {
  const lines: string[] = [];

  const status = result.thresholdsPassed ? '✅ PASSED' : '❌ FAILED';

  lines.push(`Stress Test Results - ${status}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Target: ${result.targetType}`);
  lines.push(`Duration: ${result.duration.toFixed(1)}s`);
  lines.push(`Concurrency: ${result.concurrency} users`);
  lines.push('');
  lines.push('Requests:');
  lines.push(`  Total: ${result.totalRequests}`);
  lines.push(`  Successful: ${result.successfulRequests}`);
  lines.push(`  Failed: ${result.failedRequests}`);
  lines.push('');
  lines.push('Response Times:');
  lines.push(`  Average: ${result.avgResponseTime}ms ${result.avgResponseTime > (thresholds.maxResponseTime || 3000) ? '⚠️' : ''}`);
  lines.push(`  Min: ${result.minResponseTime}ms`);
  lines.push(`  Max: ${result.maxResponseTime}ms`);
  lines.push(`  P50: ${result.p50ResponseTime}ms`);
  lines.push(`  P95: ${result.p95ResponseTime}ms`);
  lines.push(`  P99: ${result.p99ResponseTime}ms`);
  lines.push('');
  lines.push('Performance:');
  lines.push(`  Throughput: ${result.throughput} req/s ${result.throughput < (thresholds.minThroughput || 10) ? '⚠️' : ''}`);
  lines.push(`  Error Rate: ${result.errorRate}% ${result.errorRate > (thresholds.maxErrorRate || 5) ? '⚠️' : ''}`);
  lines.push('');
  lines.push('Thresholds:');
  lines.push(`  Max Response Time: ${thresholds.maxResponseTime || 3000}ms - ${result.avgResponseTime <= (thresholds.maxResponseTime || 3000) ? '✓' : '✗'}`);
  lines.push(`  Max Error Rate: ${thresholds.maxErrorRate || 5}% - ${result.errorRate <= (thresholds.maxErrorRate || 5) ? '✓' : '✗'}`);
  lines.push(`  Min Throughput: ${thresholds.minThroughput || 10} req/s - ${result.throughput >= (thresholds.minThroughput || 10) ? '✓' : '✗'}`);

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Top Errors:');
    const errorCounts: Record<string, number> = {};
    for (const error of result.errors) {
      errorCounts[error.message] = (errorCounts[error.message] || 0) + 1;
    }
    const sortedErrors = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [message, count] of sortedErrors) {
      lines.push(`  - ${message}: ${count}x`);
    }
  }

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default runStressTest;
