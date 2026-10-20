# 테스트 안내

## 규칙 테스트 (Firestore Emulator)
가짜 프로젝트(`demo-mnm-rules`)의 로컬 에뮬레이터에서, 가짜 학생 데이터로만 실행한다. **운영 Firebase 에는 접속하지 않는다.**

| 파일 | 대상 규칙 | 내용 |
|---|---|---|
| `rules/current.test.js` | `security/firestore.rules.current` | 현재 운영 규칙이 무엇을 열어 두는지(보안 문제의 증거)를 고정 |
| `rules/phase1.test.js` | `security/firestore.rules.phase1.proposed` | 원장 서버 인증 + 학생 세션 기존 기능 유지 + 원장 전용 상태값 보호 + 알려진 한계 |
| `rules/phase2.test.js` | `security/firestore.rules.phase2.proposed` | 학생별 권한(서버 발급 custom token) — 학생 간 격리, 원장 설정·월말 리포트 차단 |
| `firestore-rules.test.js` | `security/firestore.rules.proposed` | PR #11(월말 리포트만 잠금) 제안안 |

실행(컴퓨터에 Node 20+, Java 21 필요):
```
cd tests
npm ci
npm run test:rules          # 기준선·1단계·2단계
npm run test:rules:monthly  # PR #11 제안안
```
PR 에서는 `.github/workflows/rules-tests.yml` 이 자동으로 같은 명령을 실행한다(변경 파일이 security/, tests/rules/ 일 때).

## 상태 (2026-10-20)
- **에뮬레이터 실행 결과 없음.** 이 개발 환경은 에뮬레이터 실행 파일(storage.googleapis.com)을 받을 수 없어(정책상 403) 한 번도 실행하지 못했다.
- 확인한 것: 테스트 파일 구문, 의존성 설치, 모듈 불러오기, 규칙 파일의 괄호 균형·함수 정의(정적 점검).
- 확인하지 못한 것: 규칙 문법의 실제 컴파일 여부, 모든 테스트의 통과 여부. **첫 CI 실행 결과로 테스트·규칙을 함께 고쳐야 한다.**

## 그 밖의 테스트
- `monthly-report.test.js` — 월말 리포트 순수 함수 단위 테스트
- `smoke-browser.js` — 가짜 Firebase 로 앱 화면을 돌려 보는 브라우저 스모크 테스트
