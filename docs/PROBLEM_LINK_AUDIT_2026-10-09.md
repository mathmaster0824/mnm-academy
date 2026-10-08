# 문제저장소 연동 무변경 실사 — 2026-10-09

대상: `main/index.html` V96.3. 이 문서는 코드 정적 점검 결과이며 Firebase 실데이터 검증 결과가 아니다.

## 운영 안전 기준
- `main` 수정, DB 수정/삭제, 기존 학생 기록 일괄 갱신 금지.
- 운영 중인 반별기록 오류는 현재 재현되지 않음. 별도 과거 수정 브랜치의 병합 금지.
- 이 문서 및 후속 진단은 `audit/problem-link-integrity-20261009`에서 진행.

## 코드상 연결 경로
| 원본 이벤트 | 저장 완료 후 호출 | 원본 저장 컬렉션 |
| --- | --- | --- |
| `addSolutionPhoto` | `syncSolutionPhotoToProblemRepo(solId,solData)` | `solutionPhotos` |
| `submitQuestion` | `syncQuestionToProblemRepo(ok,payload)` | `questions` |
| `answerQuestion` | `syncAnsweredQuestionToProblemRepo(qId,...)` | `questions` |

연동은 fire-and-forget 방식이며 호출자가 성공 여부를 기다리지 않는다. 각 동기화 함수는 예외를 포착하여 콘솔에 기록하고 `{status:'error'}` 등을 반환한다. 따라서 원본 저장 성공과 연동 성공은 별개다.

## 연결키
- TEXTBOOK: `textbookSourceKey(courseId,book,page,problemNo)`
- PRINT: `print::<normalized printId>::q<normalized problemNo>`
- MNM: `mnm::<problemId>`
- 기존 정식 문항: `problems.sourceKeys array-contains`
- 기존 후보: `problemDrafts.sourceKey ==`
- 원본에 남는 링크: `problemId`, `problemDraftId`, `problemLinkedAt`, `problemCandidateAt`

## 진단에서 구분할 상태
1. 정식 연결: 원본 `problemId`가 있고 `problems/{id}` 존재.
2. 후보 연결: 정식 연결이 없고 원본 `problemDraftId`가 있으며 `problemDrafts/{id}` 존재.
3. 링크 깨짐: 링크 ID가 있으나 대상 문서가 없음.
4. 링크 미확인: 링크 ID가 없음. 비동기 진행 중/과거자료/실패 여부는 별도 판단.
5. 검토 대기: 후보 문서가 존재하지만 `ready` 요건 미충족. 오류로 간주하지 않음.

## 확인된 설계상 위험
- 저장 후 연동을 기다리지 않으므로 화면상 원본 저장 성공만으로 링크 성공을 보장하지 않음.
- 연동 함수 내부에서 오류를 잡으므로 호출자의 `.catch`가 실패를 알리지 못할 수 있음.
- `findCanonicalProblemBySourceKey`의 조회 실패는 경고 후 null 반환; `findOpenProblemDraftBySourceKey`도 조회 실패 시 null 반환. 네트워크/권한 실패를 '없음'으로 취급할 가능성이 있으므로, 재연결 자동화 전에 반드시 구분해야 함.
- 출처키가 빈 자료는 출처 기반 중복검색을 건너뜀. 질문 원본의 `sourceType`별 처리 확인 필요.

## 후속 실행 순서
1. 읽기 전용 점검: `questions`, `solutionPhotos`의 링크 필드 존재 여부 집계.
2. 링크 ID가 있는 항목만 대상으로 대상 문서 존재 여부 확인.
3. 링크 없는 항목은 출처키·생성시점·질문 유형별로 분류; 자동 재연결 금지.
4. 검증 가능한 재현 사례와 테스트를 먼저 확보한 후 최소 수정.
5. 실제 사용 경로 테스트 및 기존 기능 회귀검증 뒤에만 운영 반영 검토.

이 단계에서는 Firebase 접근권한 및 실데이터 조회가 없으므로 실제 누락 건수는 알 수 없다.
