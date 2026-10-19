# 2026-10 개선 설계 · 데이터 호환성 위험 정리

기준: `main` f7d1243 (index.html 앱 버전 v96.3). 작업 브랜치: `feature/multi-class-step-report-monthly`.
문제저장소(`problemRepo`, `assignments`, 답지·PDF·분석 코드)는 이번 작업에서 변경하지 않는다.

## 0. 코드에서 확인한 현재 상태
- 저장소에는 `index.html`(앱), `batch.html`, `import.html`, `upload.html`만 있다. **Cloud Functions / firebase.json / .firebaserc 없음** → 월말 자동 생성은 백엔드 파일을 새로 준비해야 한다.
- 반-학생 연결: `classes.studentIds`(배열)와 `students.classId`(단일)가 공존. `classForStudent()`는 membership으로 **첫 번째 반 하나만** 반환한다. `assignStudent()`는 다른 반에서 제거하지 않으므로 데이터상 복수 반 소속은 이미 가능하지만, 로그인 로딩(classRecords/weeklyPlans/fridaySupp)·학생 화면·숙제 계획 조회가 모두 반 1개만 본다.
- 수업기록 `classRecords/{반ID}_{날짜}` → `{[학생ID]: {...}}`. 반별로 이미 분리돼 있어 복수 반에도 안전.
- 주간계획 `weeklyPlans/{반ID}_{주시작일}` → 학생별·요일별 숙제 내용. 반별로 이미 분리.
- 제출 `submissions/{학생ID}_{날짜}` → **반 정보 없음**. 같은 날 두 반에 숙제가 있으면 충돌한다. 키 끝 10자가 날짜(`slice(-10)`), 접두 `학생ID_`가 범위 조회·`startsWith`에 쓰인다.
- STEP: `stepId` + `stepLabelSnapshot`, `extraSteps` + `extraStepLabelSnapshots`, `stepType`. 수업 상세 입력란은 없다. `다음 시간 메모`는 `students.conceptMemo`(학생 단위, 내부용).
- 숙제 완성도: `classRecords[...].homeworkCompletionLevel`(상/중/하)가 이미 있으나, 화면과 일일리포트가 **미입력이면 제출 비율로 자동 추정**(`suggestedHomeworkLevel`)한다 → 이번 요구(자동 추정 금지)와 충돌.
- 숙제 제출: `submitHomework()`가 `status:'대기'`로 저장 → 원장 승인(`확인`)이 있어야 인정. 판정 함수(`submissionReviewState` 등)가 경고·신호등·연속 미제출 계산의 기반이다. 알 수 없는 status는 안전하게 '검토대기'로 처리한다.
- 사진은 Firestore 인라인/외부 업로드(`PHOTO_API_BASE`, `photoRefForFirestore`)를 함께 사용한다(수정 대상 아님).

## 1. 변경 설계
### A. STEP + 수업 상세 (기존 필드 유지, 신규 필드만 추가)
- `classRecords[반_날짜][학생]`에 `lessonDetail`(학부모 공유 가능한 짧은 텍스트) 추가. `stepId`는 표준값 그대로.
- STEP 드롭다운에 `기타·직접입력` 옵션: `stepId='__etc__'`, `stepLabelSnapshot='기타·직접입력'`. 통계는 이 값으로 묶인다. 기존 stepId/스냅샷은 건드리지 않는다.
- `students.conceptMemo`(내부 메모) 유지, 라벨을 "내부 메모"로 명확화. 리포트에는 절대 포함하지 않는다.
### B. 일일리포트
- `오늘의 진도`(STEP) 아래 `수업 상세: …` 줄 추가(비어 있으면 생략). 복사 본문은 같은 `buildDailyReportText` 결과를 쓰므로 동일 반영.
- 숙제 줄을 `숙제 제출 이행`과 `숙제 완성도`로 분리. 완성도는 **기록된 값만** 표시, 없으면 `미평가`.
### C. 숙제 제출 / 완성도 분리
- 신규 제출은 `status:'제출완료'`로 저장하고 `submissionReviewState`가 이를 'approved'(제출 인정)로 해석. 판정 흐름(불합격/재제출/3회)은 원장이 필요할 때 그대로 사용 가능. 과거 문서의 status는 일괄 변경하지 않는다.
- 구버전(캐시된) 앱은 '제출완료'를 알 수 없는 상태로 보고 '검토대기'로 안전하게 처리 → 장애 없음.
- 완성도 필드는 `homeworkCompletionLevel` 재사용(기존 기록 호환) + 반 연결을 위해 이미 반별 문서(classRecords)에 저장되므로 별도 스키마 불필요. 자동 추정 제거, 기준 안내문 추가.
### D. 복수 반 수강
- `classesForStudent(stuId)` 추가(membership 전체 + 레거시 `classId` 보완). `classForStudent`는 그대로(대표 반) 유지.
- 로그인 로딩과 학생 화면의 숙제 계획·수업 기록을 모든 소속 반에 대해 읽고 반 이름별로 구분 표시.
- 제출 키: 한 반 학생과 대표 반은 기존 `학생ID_날짜` 그대로. 같은 날 다른 반 숙제가 있는 복수 반 학생의 **신규** 제출만 `학생ID_반ID_날짜`(접두·끝 10자 규칙 유지)로 저장하고 문서에 `classId` 기록. 과거 문서는 변환하지 않는다.
### E. 월말 리포트 초안
- 컬렉션 `monthlyReports/{YYYY-MM}_{학생ID}` : `{ month, studentId, version, draft(생성본), edited(원장 수정본), generatedAt, editedAt, status, sourceSignature }`. 재생성 시 `edited`가 있으면 덮어쓰지 않고 `drafts[]`에 새 버전을 추가, `hasNewerDraft:true` 표시.
- 생성 로직은 앱(수동 "초안 만들기" 버튼, 즉시 사용 가능)과 `functions/`(예약 실행 파일 준비, 배포하지 않음)가 같은 순수 함수 규칙을 쓴다. 멱등: 문서 ID 고정 + `create`(존재 시 건너뜀).

## 2. 데이터 호환성 위험과 대응
| 위험 | 대응 |
| --- | --- |
| status 의미 변경으로 경고·신호등 변화 | '제출완료'→approved. 과거 데이터 불변. 경고는 원래 자동 부과 금지 규칙 유지 |
| 복수 반 키 충돌 | 신규 제출만 반ID 포함 키, 기존 키 유지 |
| 자동 추정 제거로 리포트 표시 변화 | 미평가로 표시(의도된 변경) |
| 예약 함수 비용/요금제 | Blaze 필요, 배포 전 확인 항목으로 분리 |
