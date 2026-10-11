# M&m 운영 안전성 1차 코드 감사 (2026-10-12)

범위: GitHub main/feature 정적 코드 조사. **실제 Firebase 규칙·운영 DB·브라우저 동작은 검증하지 않음.**

## 확인된 경로
- 인증: initFirebase → Firebase Anonymous Auth → attachCoreListeners. 로그인 화면의 원장 비밀번호/학생 코드는 브라우저 메모리의 Firestore 데이터와 비교하며 session/localStorage에 역할을 저장.
- 초기 공통 구독: meta/settings, students, classes 등. 설정 문서가 없으면 클라이언트가 기본값으로 새 문서를 쓰려고 시도하는 경로 존재. 운영 데이터 변경을 실행하지 않았음.
- 역할별 구독: attachRoleListeners. classRecords/weeklyPlans/fridaySupp은 최근 기록을 제한적으로 읽고 과거 날짜는 개별 문서 조회하도록 설계.
- 숙제: submitHomework는 기존 제출 기록을 확인하고 사진 중복 제거, 재제출 및 최종 불합격 상태를 처리하는 코드 존재. **실제 사진 업로드·R2 연계·실패 복구 검증 필요.**
- STAD: stadSettings/stadApplications/stadDaily 데이터 구조 존재. 인증·정산 저장과 원장 조회 경로는 함수 단위 추가 추적 필요.
- 주말학습: weekendSettings/weekendClasses/weekendSubmissions 구조 존재. 인증칸별 제출과 재조회 경로는 함수 단위 추가 추적 필요.
- 질문: questions 데이터 및 원장 검토·재학습 분석 추가. 학생 질문 생성/사진/답변 동선의 회귀 검증 필요.

## 주요 위험 및 조치 우선순위
P0 보안: 익명 Firebase Auth 자체로 원장/학생 권한을 구별할 수 없음. Firestore 실제 보안 규칙 확인 전까지 안전하다고 판정 금지. 학생 코드·원장 비밀번호가 초기 구독으로 클라이언트에 제공되는 구조를 확인함. 인증 개선은 기존 로그인 단절 위험 때문에 별도 테스트/승인 없이 운영 적용 금지.
P0 보존: Firestore 자동 백업·R2 파일 복구 및 실제 복원 성공 여부 미확인. 백업이 존재한다고 가정 금지.
P1 학생 UX: STAD·주말학습·숙제·질문 각각 입력→저장 성공 확인→재접속→원장 확인→실패 복구를 독립 테스트.
P1 변경관리: main과 feature 분기. 운영 숙제 제출 변경 보존 후 전체 차이 재검토.
P2 품질: 자동 CI/E2E 없음. 정적 JS 파싱 통과만으로 실제 동작 완료 판정 금지.

## 다음 조사
1. STAD 일일 저장 함수·실패 경로와 화면 이동 시 초안 보존.
2. 주말학습 인증 저장 함수·중복/수정 처리.
3. 질문 등록·사진 업로드 및 학생별 조회.
4. 공통 fsSet/fsUpdate 및 사진 업로드 실패의 UI 처리.

변경 이력: 이 감사는 문서만 추가함. 운영 배포/DB 변경/PR 병합 없음.
