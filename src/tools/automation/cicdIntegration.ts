// ============================================
// CI/CD Integration Tool
// GitHub Actions, Jenkins, GitLab CI
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { Platform } from '../../types.js';

// ============================================
// Types
// ============================================
export interface CICDConfig {
  projectPath: string;
  platform: Platform;
  provider: 'github-actions' | 'jenkins' | 'gitlab-ci' | 'circleci';
  options?: {
    testCommand?: string;
    buildCommand?: string;
    deployCommand?: string;
    notifyOnFailure?: boolean;
    cacheEnabled?: boolean;
    parallelTests?: boolean;
    branches?: string[];
  };
}

export interface CICDGeneratedConfig {
  provider: string;
  filePath: string;
  content: string;
  additionalFiles?: { path: string; content: string }[];
}

// ============================================
// GitHub Actions
// ============================================
export function generateGitHubActions(config: CICDConfig): CICDGeneratedConfig {
  const { platform, options = {} } = config;
  const {
    testCommand = 'npm test',
    buildCommand = 'npm run build',
    cacheEnabled = true,
    parallelTests = false,
    branches = ['main', 'develop'],
  } = options;

  let workflow = '';

  switch (platform) {
    case 'ios':
      workflow = generateIOSGitHubActions(testCommand, buildCommand, branches, cacheEnabled);
      break;
    case 'android':
      workflow = generateAndroidGitHubActions(testCommand, buildCommand, branches, cacheEnabled);
      break;
    case 'flutter':
      workflow = generateFlutterGitHubActions(testCommand, buildCommand, branches, cacheEnabled);
      break;
    case 'react-native':
      workflow = generateReactNativeGitHubActions(testCommand, buildCommand, branches, cacheEnabled);
      break;
    case 'web':
    default:
      workflow = generateWebGitHubActions(testCommand, buildCommand, branches, cacheEnabled, parallelTests);
      break;
  }

  return {
    provider: 'github-actions',
    filePath: '.github/workflows/test-genie.yml',
    content: workflow,
  };
}

function generateIOSGitHubActions(
  testCommand: string,
  buildCommand: string,
  branches: string[],
  cacheEnabled: boolean
): string {
  return `name: iOS Test Genie

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: macos-14

    steps:
      - uses: actions/checkout@v4

      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_15.2.app

      ${cacheEnabled ? `- name: Cache CocoaPods
        uses: actions/cache@v4
        with:
          path: Pods
          key: \${{ runner.os }}-pods-\${{ hashFiles('**/Podfile.lock') }}
          restore-keys: |
            \${{ runner.os }}-pods-` : ''}

      - name: Install CocoaPods
        run: |
          gem install cocoapods
          pod install --repo-update

      - name: Run Tests
        run: |
          set -o pipefail
          xcodebuild test \\
            -workspace *.xcworkspace \\
            -scheme "YourScheme" \\
            -destination 'platform=iOS Simulator,name=iPhone 15' \\
            -resultBundlePath TestResults.xcresult | xcpretty

      - name: Upload Test Results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: TestResults.xcresult

      - name: Run Test Genie Analysis
        if: always()
        run: npx test-genie-mcp analyze --project . --platform ios

  build:
    runs-on: macos-14
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: ${buildCommand}
`;
}

function generateAndroidGitHubActions(
  testCommand: string,
  buildCommand: string,
  branches: string[],
  cacheEnabled: boolean
): string {
  return `name: Android Test Genie

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      ${cacheEnabled ? `- name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: \${{ runner.os }}-gradle-\${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
          restore-keys: |
            \${{ runner.os }}-gradle-` : ''}

      - name: Run Unit Tests
        run: ./gradlew testDebugUnitTest --stacktrace

      - name: Run Instrumented Tests
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 29
          script: ./gradlew connectedDebugAndroidTest

      - name: Upload Test Results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: |
            **/build/reports/tests/
            **/build/reports/androidTests/

      - name: Run Test Genie Analysis
        if: always()
        run: npx test-genie-mcp analyze --project . --platform android

  build:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Build APK
        run: ./gradlew assembleRelease

      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: app-release
          path: app/build/outputs/apk/release/*.apk
`;
}

function generateFlutterGitHubActions(
  testCommand: string,
  buildCommand: string,
  branches: string[],
  cacheEnabled: boolean
): string {
  return `name: Flutter Test Genie

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.16.x'
          channel: 'stable'
          cache: ${cacheEnabled}

      - name: Install dependencies
        run: flutter pub get

      - name: Analyze code
        run: flutter analyze

      - name: Run tests with coverage
        run: flutter test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: coverage/lcov.info

      - name: Run Test Genie Analysis
        if: always()
        run: npx test-genie-mcp analyze --project . --platform flutter

  build-android:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.16.x'
          channel: 'stable'
          cache: true

      - name: Build APK
        run: flutter build apk --release

      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: app-release
          path: build/app/outputs/flutter-apk/app-release.apk

  build-ios:
    runs-on: macos-14
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.16.x'
          channel: 'stable'
          cache: true

      - name: Build iOS
        run: flutter build ios --release --no-codesign
`;
}

function generateReactNativeGitHubActions(
  testCommand: string,
  buildCommand: string,
  branches: string[],
  cacheEnabled: boolean
): string {
  return `name: React Native Test Genie

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          ${cacheEnabled ? `cache: 'npm'` : ''}

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run tests
        run: ${testCommand}

      - name: Upload coverage
        uses: codecov/codecov-action@v3

      - name: Run Test Genie Analysis
        if: always()
        run: npx test-genie-mcp analyze --project . --platform react-native

  build-android:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup JDK
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Install dependencies
        run: npm ci

      - name: Build Android
        run: cd android && ./gradlew assembleRelease

      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: app-release
          path: android/app/build/outputs/apk/release/*.apk

  build-ios:
    runs-on: macos-14
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install CocoaPods
        run: cd ios && pod install

      - name: Build iOS
        run: npx react-native run-ios --configuration Release

  e2e-test:
    runs-on: macos-14
    needs: [build-android, build-ios]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Detox build
        run: npx detox build -c ios.sim.release

      - name: Detox test
        run: npx detox test -c ios.sim.release --cleanup
`;
}

function generateWebGitHubActions(
  testCommand: string,
  buildCommand: string,
  branches: string[],
  cacheEnabled: boolean,
  parallelTests: boolean
): string {
  return `name: Web Test Genie

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    ${parallelTests ? `
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    ` : ''}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          ${cacheEnabled ? `cache: 'npm'` : ''}

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run type-check

      - name: Run tests
        run: ${testCommand}${parallelTests ? ' -- --shard=${{ matrix.shard }}/4' : ''}

      - name: Upload coverage
        uses: codecov/codecov-action@v3

      - name: Run Test Genie Analysis
        if: always()
        run: npx test-genie-mcp analyze --project . --platform web

  e2e:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run Playwright tests
        run: npx playwright test

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/

  build:
    runs-on: ubuntu-latest
    needs: [test, e2e]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: ${buildCommand}

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build
          path: dist/
`;
}

// ============================================
// Jenkins
// ============================================
export function generateJenkinsfile(config: CICDConfig): CICDGeneratedConfig {
  const { platform, options = {} } = config;
  const {
    testCommand = 'npm test',
    buildCommand = 'npm run build',
    notifyOnFailure = true,
  } = options;

  const content = `pipeline {
    agent any

    environment {
        NODE_VERSION = '20'
        ${platform === 'android' ? "ANDROID_SDK_ROOT = '/opt/android-sdk'" : ''}
        ${platform === 'ios' ? "DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'" : ''}
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                ${platform === 'flutter' ? `
                sh 'flutter pub get'
                ` : platform === 'ios' ? `
                sh 'pod install'
                ` : `
                sh 'npm ci'
                `}
            }
        }

        stage('Lint') {
            steps {
                ${platform === 'flutter' ? `
                sh 'flutter analyze'
                ` : `
                sh 'npm run lint'
                `}
            }
        }

        stage('Test') {
            steps {
                ${platform === 'flutter' ? `
                sh 'flutter test --coverage'
                ` : platform === 'ios' ? `
                sh '''
                    xcodebuild test \\
                        -workspace *.xcworkspace \\
                        -scheme "YourScheme" \\
                        -destination 'platform=iOS Simulator,name=iPhone 15' \\
                        | xcpretty
                '''
                ` : platform === 'android' ? `
                sh './gradlew testDebugUnitTest'
                ` : `
                sh '${testCommand}'
                `}
            }
            post {
                always {
                    ${platform === 'flutter' || platform === 'web' || platform === 'react-native' ? `
                    publishHTML([
                        allowMissing: true,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'coverage',
                        reportFiles: 'index.html',
                        reportName: 'Coverage Report'
                    ])
                    ` : `
                    junit '**/test-results/**/*.xml'
                    `}
                }
            }
        }

        stage('Test Genie Analysis') {
            steps {
                sh 'npx test-genie-mcp analyze --project . --platform ${platform}'
            }
        }

        stage('Build') {
            steps {
                ${platform === 'flutter' ? `
                sh 'flutter build apk --release'
                ` : platform === 'ios' ? `
                sh '''
                    xcodebuild archive \\
                        -workspace *.xcworkspace \\
                        -scheme "YourScheme" \\
                        -archivePath build/App.xcarchive
                '''
                ` : platform === 'android' ? `
                sh './gradlew assembleRelease'
                ` : `
                sh '${buildCommand}'
                `}
            }
        }
    }

    post {
        ${notifyOnFailure ? `
        failure {
            emailext(
                subject: "Build Failed: \${env.JOB_NAME} [\${env.BUILD_NUMBER}]",
                body: "Check console output at \${env.BUILD_URL}",
                recipientProviders: [developers(), requestor()]
            )
        }
        ` : ''}
        always {
            cleanWs()
        }
    }
}
`;

  return {
    provider: 'jenkins',
    filePath: 'Jenkinsfile',
    content,
  };
}

// ============================================
// GitLab CI
// ============================================
export function generateGitLabCI(config: CICDConfig): CICDGeneratedConfig {
  const { platform, options = {} } = config;
  const {
    testCommand = 'npm test',
    buildCommand = 'npm run build',
    cacheEnabled = true,
  } = options;

  const content = `stages:
  - test
  - analyze
  - build
  - deploy

variables:
  ${platform === 'android' ? 'ANDROID_SDK_ROOT: "/opt/android-sdk"' : ''}
  ${platform === 'flutter' ? 'FLUTTER_VERSION: "3.16.0"' : ''}

${cacheEnabled ? `
cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    ${platform === 'flutter' ? '- .pub-cache/' : platform === 'ios' ? '- Pods/' : '- node_modules/'}
` : ''}

# Test Stage
test:
  stage: test
  ${platform === 'ios' ? 'tags: [macos]' : 'image: node:20'}
  before_script:
    ${platform === 'flutter' ? `
    - git clone https://github.com/flutter/flutter.git -b stable
    - export PATH="$PATH:$(pwd)/flutter/bin"
    - flutter pub get
    ` : platform === 'ios' ? `
    - pod install
    ` : `
    - npm ci
    `}
  script:
    ${platform === 'flutter' ? `
    - flutter analyze
    - flutter test --coverage
    ` : platform === 'ios' ? `
    - xcodebuild test -workspace *.xcworkspace -scheme "YourScheme" -destination 'platform=iOS Simulator,name=iPhone 15'
    ` : platform === 'android' ? `
    - ./gradlew testDebugUnitTest
    ` : `
    - npm run lint
    - ${testCommand}
    `}
  artifacts:
    reports:
      ${platform === 'flutter' || platform === 'web' || platform === 'react-native' ? 'coverage_report:' : 'junit:'}
        ${platform === 'flutter' ? 'coverage/lcov.info' : platform === 'web' || platform === 'react-native' ? 'coverage/lcov.info' : '**/test-results.xml'}
    expire_in: 1 week

# Test Genie Analysis
analyze:
  stage: analyze
  image: node:20
  script:
    - npm ci
    - npx test-genie-mcp analyze --project . --platform ${platform}
  artifacts:
    paths:
      - .test-genie/reports/
    expire_in: 1 week
  allow_failure: true

# Build Stage
build:
  stage: build
  ${platform === 'ios' ? 'tags: [macos]' : 'image: node:20'}
  before_script:
    ${platform === 'flutter' ? `
    - git clone https://github.com/flutter/flutter.git -b stable
    - export PATH="$PATH:$(pwd)/flutter/bin"
    - flutter pub get
    ` : platform === 'ios' ? `
    - pod install
    ` : `
    - npm ci
    `}
  script:
    ${platform === 'flutter' ? `
    - flutter build apk --release
    ` : platform === 'ios' ? `
    - xcodebuild archive -workspace *.xcworkspace -scheme "YourScheme" -archivePath build/App.xcarchive
    ` : platform === 'android' ? `
    - ./gradlew assembleRelease
    ` : `
    - ${buildCommand}
    `}
  artifacts:
    paths:
      ${platform === 'flutter' ? '- build/app/outputs/flutter-apk/' : platform === 'android' ? '- app/build/outputs/apk/' : '- dist/'}
    expire_in: 1 week
  only:
    - main
    - develop
`;

  return {
    provider: 'gitlab-ci',
    filePath: '.gitlab-ci.yml',
    content,
  };
}

// ============================================
// Main Function
// ============================================
export function generateCICDConfig(config: CICDConfig): CICDGeneratedConfig {
  switch (config.provider) {
    case 'github-actions':
      return generateGitHubActions(config);
    case 'jenkins':
      return generateJenkinsfile(config);
    case 'gitlab-ci':
      return generateGitLabCI(config);
    default:
      return generateGitHubActions(config);
  }
}

export function writeCICDConfig(config: CICDConfig): { success: boolean; files: string[] } {
  const generated = generateCICDConfig(config);
  const files: string[] = [];

  try {
    const fullPath = path.join(config.projectPath, generated.filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, generated.content);
    files.push(fullPath);

    // Write additional files if any
    if (generated.additionalFiles) {
      for (const file of generated.additionalFiles) {
        const additionalPath = path.join(config.projectPath, file.path);
        const additionalDir = path.dirname(additionalPath);

        if (!fs.existsSync(additionalDir)) {
          fs.mkdirSync(additionalDir, { recursive: true });
        }

        fs.writeFileSync(additionalPath, file.content);
        files.push(additionalPath);
      }
    }

    return { success: true, files };
  } catch (error) {
    return { success: false, files };
  }
}

export default {
  generateCICDConfig,
  writeCICDConfig,
  generateGitHubActions,
  generateJenkinsfile,
  generateGitLabCI,
};
