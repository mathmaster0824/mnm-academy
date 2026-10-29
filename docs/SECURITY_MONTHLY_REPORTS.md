# 월말 리포트 보안 검토 (2026-10-19)

## 결론
**현재 로그인 구조로는 서버가 신뢰할 수 있는 원장 권한을 만들 수 없다.** 따라서 월말 리포트를 Firestore에 저장·조회하는 클라이언트 기능은 이 브랜치에서 **비활성화**(`MONTHLY_REPORT_CLIENT_ENABLED=false`, 메뉴 제거)했다. 학생 데이터 접근을 열어 둔 채 기능을 유지하지 않는다.

## 확인한 사실 (코드 근거)
- 원장 로그인: `index.html` 의 `if(v === db.settings.adminPassword){ session = {mode:'director'} ... }` — **브라우저에서 비교**한다. 서버 검증이 아니다.
- 원장 비밀번호는 Firestore `meta/settings` 문서의 `adminPassword` 필드에 평문 저장되고, 모든 클라이언트가 이 문서를 구독한다. 현재 규칙(`request.auth != null`, 이전 콘솔 확인)에서는 **학생 익명 세션도 이 문서를 읽을 수 있다** → 원장 비밀번호가 학생 세션에 노출될 수 있다. (이번 작업 이전부터 존재하던 위험이며, 월말 리포트와 별개로 가장 먼저 조치가 필요하다.)
- 학생은 익명 인증으로 접속한다(`signInAnonymously`). 원장·학생 모두 `request.auth != null` 이므로 규칙으로 둘을 구분할 수 없다.
- `session.mode`, 비밀번호, `X-MNM-Role` 헤더는 서버가 신뢰할 수 없는 값이라 보안 근거로 쓰지 않았다.

## 이 브랜치의 변경
- `index.html` / `scripts/monthly_ui.js.part`: 월말 리포트 Firestore 읽기·쓰기 경로를 모두 가드로 막고 메뉴를 제거. 화면 진입 시 "보안 인증 준비 중" 안내만 표시(빈 목록·성공 메시지로 오인되지 않음).
- `security/firestore.rules.proposed`: 제안 규칙(배포하지 않음).
  - `monthlyReports` 는 서버가 발급한 custom claim `mnmDirector == true` 이고 익명이 아닌 세션만 허용.
  - 기존 넓은 규칙은 `monthlyReports` 를 제외하도록 catch-all 을 `colName != 'monthlyReports'` 로 바꿔, OR 결합으로 보호 규칙이 무력화되지 않게 함. 그 외 컬렉션은 현재와 동일(`request.auth != null`).
- `tests/firestore-rules.test.js`: 필수 시나리오 테스트(익명/일반/claim 위조/비로그인 거부, claim 원장 허용, 기존 숙제·수업·주간계획·질문 회귀). **이 환경에서는 Firestore Emulator 설치 파일을 내려받을 수 없어 실행하지 못했다 → 검증 완료가 아니다.**
- `functions/` 의 예약 함수는 Admin SDK로 규칙을 우회해 쓰므로 규칙으로는 막히지 않는다. 배포하지 말 것(원장이 안전하게 읽을 경로가 아직 없다).

## 안전한 원장 인증을 구현하려면 (이 범위 밖)
1. 원장 전용 Firebase Auth 계정(이메일/비밀번호 또는 Google)을 만들고, Admin SDK 스크립트로 `mnmDirector` custom claim을 **관리자(개발자)가 직접** 부여한다. 앱의 원장 로그인을 이 계정 로그인으로 교체해야 한다(현재 0000/비밀번호 방식 폐지).
2. 그 뒤 `meta/settings.adminPassword` 를 삭제하고, 원장 전용 데이터(월말 리포트 등)부터 규칙을 claim 기반으로 이전한다. 학생이 접속하는 기존 기능은 단계적으로 `studentId` 와 연결된 규칙으로 좁혀야 한다(익명 학생 UID ↔ 학생 문서 매핑이 필요하며 별도 설계 필요).
3. 규칙 배포 전 Emulator 테스트 통과, 그리고 운영 영향(기존 학생 앱 동작) 점검.

## 운영 전 필요한 절차
- 위 규칙/인증은 **적용하지 않았다.** `monthlyReports` 문서가 아직 생성되지 않았는지(콘솔에서 컬렉션 존재 여부) 확인할 것. 이미 만든 문서가 있다면 학생 세션이 읽을 수 있으므로 삭제 여부를 원장이 판단해야 한다.
- `meta/settings.adminPassword` 노출 위험은 별도로 즉시 조치 필요: 최소한 비밀번호를 바꾸고, 원장 인증을 서버 검증 방식으로 교체하는 계획을 세울 것.
