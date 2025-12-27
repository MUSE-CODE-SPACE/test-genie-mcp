# Test Genie MCP

**AI-powered App Test Automation MCP Server**

> Multi-platform test automation for iOS, Android, Flutter, React Native, and Web applications.

[![npm version](https://img.shields.io/npm/v/test-genie-mcp.svg)](https://www.npmjs.com/package/test-genie-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](#english) | [한국어](#korean)

---

<a name="english"></a>
## English

### Overview

Test Genie MCP is an AI-powered MCP server for automated app testing. It provides a complete test pipeline from scenario generation to test execution, issue detection, fix suggestions, and automated fixes.

### Features

#### Multi-Platform Support

| Platform | Languages | Test Frameworks |
|----------|-----------|-----------------|
| iOS | Swift, Objective-C | XCTest, XCUITest, Instruments |
| Android | Kotlin, Java | Espresso, UI Automator, Android Profiler |
| Flutter | Dart | flutter_test, integration_test, Golden Tests |
| React Native | TypeScript, JavaScript | Jest, Detox, RNTL |
| Web | TypeScript, JavaScript | Playwright, Cypress, Lighthouse |

#### 18 MCP Tools

**Analysis & Scenario Generation**
- `analyze_app_structure` - Analyze codebase structure (screens, components, APIs, state)
- `generate_scenarios` - AI-powered test scenario generation
- `create_test_plan` - Create test plans and schedules

**Test Execution**
- `run_scenario_test` - Execute individual scenario tests
- `run_simulation` - User behavior simulation (random/pattern-based)
- `run_stress_test` - Stress and load testing

**Issue Detection**
- `detect_memory_leaks` - Memory leak detection (heap analysis, circular references)
- `detect_logic_errors` - Logic error detection (race conditions, state inconsistencies)

**Fix Suggestions & Application**
- `suggest_fixes` - AI-powered fix suggestions
- `confirm_fix` - User confirmation for fixes
- `apply_fix` - Apply confirmed fixes
- `rollback_fix` - Rollback applied fixes

**Full Automation**
- `run_full_automation` - Run complete pipeline automatically
- `generate_report` - Generate detailed reports (Markdown, HTML, JSON)

**Advanced Analysis (v2.0)**
- `analyze_performance` - Deep performance analysis (rendering, computation, network, bundle)
- `analyze_code_deep` - AST-based code analysis (complexity, hooks, dependencies)
- `generate_cicd_config` - Generate CI/CD configs (GitHub Actions, Jenkins, GitLab CI)

### Installation

```bash
npm install -g test-genie-mcp
```

Or install from source:

```bash
git clone https://github.com/MUSE-CODE-SPACE/test-genie-mcp.git
cd test-genie-mcp
npm install
npm run build
```

### Usage with Claude Desktop

Add to Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "test-genie": {
      "command": "npx",
      "args": ["test-genie-mcp"]
    }
  }
}
```

Or use Claude CLI:

```bash
claude mcp add test-genie-mcp npx test-genie-mcp
```

### Example Usage

#### Full Automation
```
User: "Run automated tests"

Claude will:
1. Analyze your app structure
2. Generate test scenarios
3. Execute tests
4. Detect issues (memory leaks, logic errors)
5. Suggest fixes
6. Wait for your confirmation
7. Apply approved fixes
8. Generate report
```

#### Step-by-Step

```bash
# Analyze app
analyze_app_structure(projectPath: "/path/to/app")

# Generate scenarios
generate_scenarios(projectPath: "/path/to/app", testTypes: ["e2e", "unit"])

# Detect memory leaks
detect_memory_leaks(projectPath: "/path/to/app")

# Get fix suggestions
suggest_fixes(projectPath: "/path/to/app")

# Confirm and apply fix
confirm_fix(fixId: "xxx", action: "approve")
apply_fix(fixId: "xxx")
```

### Fix Confirmation Workflow

When issues are detected, Test Genie will:

1. **Suggest Fixes**: Generate AI-powered fix suggestions with confidence scores
2. **Show Diff**: Display exactly what will change
3. **Await Confirmation**: Wait for user approval
4. **Apply Fix**: Only apply after explicit approval
5. **Backup**: Automatically create backups before applying

---

<a name="korean"></a>
## 한국어

### 개요

Test Genie MCP는 AI 기반 앱 테스트 자동화 MCP 서버입니다. 시나리오 생성부터 테스트 실행, 문제 검출, 수정 제안 및 적용까지 전체 테스트 파이프라인을 자동화합니다.

### 기능

#### 멀티 플랫폼 지원

| 플랫폼 | 언어 | 테스트 프레임워크 |
|--------|------|-------------------|
| iOS | Swift, Objective-C | XCTest, XCUITest, Instruments |
| Android | Kotlin, Java | Espresso, UI Automator, Android Profiler |
| Flutter | Dart | flutter_test, integration_test, Golden Tests |
| React Native | TypeScript, JavaScript | Jest, Detox, RNTL |
| Web | TypeScript, JavaScript | Playwright, Cypress, Lighthouse |

#### 18개 MCP 도구

**분석 & 시나리오 생성**
- `analyze_app_structure` - 앱 코드베이스 분석 (화면, 컴포넌트, API, 상태관리)
- `generate_scenarios` - AI 기반 테스트 시나리오 자동 생성
- `create_test_plan` - 테스트 계획 수립 및 스케줄링

**테스트 실행**
- `run_scenario_test` - 개별 시나리오 테스트 실행
- `run_simulation` - 사용자 행동 시뮬레이션 (랜덤/패턴 기반)
- `run_stress_test` - 스트레스/부하 테스트

**이슈 검출**
- `detect_memory_leaks` - 메모리 릭 감지 (힙 분석, 순환 참조)
- `detect_logic_errors` - 논리적 오류 검출 (레이스 컨디션, 상태 불일치)

**수정 제안 & 적용**
- `suggest_fixes` - AI 기반 수정 방안 제안
- `confirm_fix` - 수정 사항 사용자 확인
- `apply_fix` - 확인된 수정 사항 적용
- `rollback_fix` - 적용된 수정 롤백

**전체 자동화**
- `run_full_automation` - 전체 파이프라인 자동 실행
- `generate_report` - 상세 보고서 생성 (Markdown, HTML, JSON)

**고급 분석 (v2.0)**
- `analyze_performance` - 성능 심층 분석 (렌더링, 연산, 네트워크, 번들)
- `analyze_code_deep` - AST 기반 코드 분석 (복잡도, 훅, 의존성)
- `generate_cicd_config` - CI/CD 설정 자동 생성 (GitHub Actions, Jenkins, GitLab CI)

### 설치

```bash
npm install -g test-genie-mcp
```

또는 소스에서 설치:

```bash
git clone https://github.com/MUSE-CODE-SPACE/test-genie-mcp.git
cd test-genie-mcp
npm install
npm run build
```

### Claude Desktop에서 사용

Claude Desktop 설정 파일 (`~/.config/claude/claude_desktop_config.json`)에 추가:

```json
{
  "mcpServers": {
    "test-genie": {
      "command": "npx",
      "args": ["test-genie-mcp"]
    }
  }
}
```

또는 Claude CLI 사용:

```bash
claude mcp add test-genie-mcp npx test-genie-mcp
```

### 사용 예시

#### 전체 자동화
```
User: "자동화 테스트해줘"

Claude가 수행:
1. 앱 구조 분석
2. 테스트 시나리오 생성
3. 테스트 실행
4. 문제 검출 (메모리 릭, 로직 오류)
5. 수정 제안
6. 사용자 확인 대기
7. 승인된 수정 적용
8. 보고서 생성
```

### 수정 확인 워크플로우

문제가 검출되면 Test Genie가:

1. **수정 제안**: 신뢰도 점수와 함께 AI 기반 수정 제안 생성
2. **Diff 표시**: 변경될 내용 정확히 표시
3. **확인 대기**: 사용자 승인 대기
4. **수정 적용**: 명시적 승인 후에만 적용
5. **백업**: 적용 전 자동 백업 생성

---

## Links

- [npm Package](https://www.npmjs.com/package/test-genie-mcp)
- [GitHub Repository](https://github.com/MUSE-CODE-SPACE/test-genie-mcp)
- [MCP Registry](https://registry.modelcontextprotocol.io)

## License

MIT

## Author

Yoonkyoung Gong
