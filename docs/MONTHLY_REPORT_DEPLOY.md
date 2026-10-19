# 월말 리포트 — 예약 생성 배포 준비 (아직 배포되지 않음)

## 현재 상태
- **앱 화면(수동 생성)**: `index.html` 의 `월말 리포트` 메뉴. 배포(=main 병합) 즉시 사용 가능하며 Cloud Functions·추가 요금제 없이 동작한다. 원장이 `이 달 초안 만들기`를 누르면 그 달 기록을 읽어 학생별 초안을 만든다.
- **예약 자동 생성**: `functions/index.js` (`generateMonthlyReports`, 매월 1일 00:10 Asia/Seoul). 저장소에 Cloud Functions가 원래 없었으므로 `functions/`, `firebase.json`, `.firebaserc` 를 새로 추가했다. **배포·실행하지 않았다.**
- 앱과 함수는 같은 생성 로직(`functions/monthlyReportCore.js`)을 쓴다. `node scripts/check-monthly-core-sync.js` 가 index.html 안의 사본과 일치하는지 확인한다.

## 저장 구조
`monthlyReports/{YYYY-MM}_{학생ID}`
- `generated` : 최신 자동 초안 `{version, generatedAt, sig, text, data}`
- `edited` : 원장 수정본 `{text, editedAt, basedOnVersion}` (없으면 null)
- `versions[]` : 자동 초안 이력(최대 8개) + 교체된 수정본 보관
- `hasNewerDraft` : 수정본이 있는데 새 자료로 만든 초안이 생겼다는 알림
- `status` : draft / edited / reviewed

## 멱등성·재생성 규칙
1. 문서 ID가 월+학생으로 고정이고 트랜잭션으로 쓴다 → 예약이 두 번 돌아도 문서는 1개.
2. 자료가 같으면(`sig` 동일) 아무것도 쓰지 않는다.
3. 자료가 달라졌고 수정본이 **없으면** 자동 초안을 새 버전으로 갱신한다.
4. 수정본이 있거나 `reviewed` 이면 `edited`는 건드리지 않고, 새 초안을 `generated/versions`에만 저장한 뒤 `hasNewerDraft=true` 로 알린다. 원장은 앱에서 ‘새 초안 보기 / 새 초안으로 바꾸기(수정본은 versions에 보관) / 내 수정본 유지’ 중 선택한다.
5. **지연 기록 재생성**: 앱의 `이 달 초안 만들기 · 새 자료 반영`(전체) 또는 학생별 `이 학생만 새 자료 반영`. 배포 없이 언제든 가능.

## 배포 전 확인할 것 (비용·요금제)
출처: [Firebase 예약 함수 문서](https://firebase.google.com/docs/functions/schedule-functions), [Cloud Scheduler 요금](https://cloud.google.com/scheduler/pricing), [Firebase 요금](https://firebase.google.com/pricing)
- 이 프로젝트는 이미 Blaze(종량제)로 전환되어 있다고 들었다(실제 청구 계정 연결·예산 알림은 콘솔에서 재확인).
- Cloud Functions는 Spark 플랜에서 사용할 수 없고(Firebase 요금표 Spark 열 ‘해당 없음’) Blaze가 필요하다. Blaze 월 무료 구간: 호출 200만 회, GB-초 40만, CPU-초 20만, 외부 전송 5GB.
- Cloud Scheduler 작업은 **결제 계정당 3개까지 무료**, 초과 시 작업당 $0.10/31일(실행당 과금 없음). 같은 결제 계정의 다른 프로젝트 작업도 합산된다. 이 함수는 작업 1개.
- 2세대 함수는 배포 시 Cloud Build·Artifact Registry·Cloud Run·Eventarc API를 사용하며 Artifact Registry 이미지 저장 용량에 소액 요금이 날 수 있다(무료 구간 초과분만). **요금이 0원이라고 단정하지 말고** 배포 후 첫 청구서/예산 알림으로 확인.
- 읽기 비용: 월 1회 실행에서 학생 수 × 약 20문서 + 반별 수업기록·주간계획 + 해당 월 제출 문서 전체(날짜 범위 조회)를 읽는다. 사진이 문서에 들어 있어도 읽기 횟수는 문서 수로 계산된다. 학생 100명 기준 대략 수천 건 수준이며 Blaze 일일 무료 읽기(5만) 안쪽이지만, 제출 문서가 많은 달에는 앱 수동 생성도 같은 양을 읽는다.
- 활성화/확인할 API: Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler, Cloud Run Admin, Eventarc, Firebase Extensions 불필요. 대부분 `firebase deploy` 시 자동 활성화를 안내한다.
- `onSchedule` 의 `timeZone: 'Asia/Seoul'`, `region: 'asia-northeast3'` 옵션은 배포 시 CLI가 검증한다(문서 예시에는 timeZone이 없어 **배포 전 `firebase deploy --only functions --dry-run` 또는 에뮬레이터로 확인 필요**).
- 보안 규칙은 변경하지 않았다. 현재 규칙(`request.auth != null`)에서는 `monthlyReports` 도 로그인한 모든 세션(학생 익명 로그인 포함)이 읽을 수 있다. 앱의 학생 화면은 이 컬렉션을 읽지 않지만, 규칙 강화는 별도 검토 과제다.

## 배포 절차 (원장 승인 후, 개발자가 수행)
1. PR 검토 후 main 병합(→ GitHub Pages 반영). 앱 변경만으로 수동 생성 기능 사용 가능.
2. 로컬에서 `cd functions && npm install && npm test` (코어 단위 테스트).
3. `firebase use math-master-6a888` → `firebase deploy --only functions --dry-run`(가능한 경우) → 비용 확인 → `firebase deploy --only functions`.
4. 콘솔 > Cloud Scheduler 에서 작업 1개 생성 확인, `지금 실행`으로 직전 달 시험 생성 → 앱 ‘월말 리포트’에서 확인.
5. 문제가 있으면 `firebase functions:delete generateMonthlyReports` 로 제거(생성된 monthlyReports 문서는 남지만 다른 데이터에는 영향 없음).
