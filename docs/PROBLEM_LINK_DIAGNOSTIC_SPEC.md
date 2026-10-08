# 문제 연동 무변경 진단 규격 (v1)

목적: 기존 학생 질문 및 학습보관함 자료를 변경하지 않고 문제저장소 연결 무결성을 검사한다.

## 입력
- `questions`: `id`, `sourceType`, `sourceKey`, `sourceCourseId`, `sourceBook`, `sourcePage`, `sourceProblemNo`, `printId`, `problemId`, `problemDraftId`, `date`
- `solutionPhotos`: `id`, `sourceKey`, `courseId`, `book`, `page`, `problemNo`, `problemId`, `problemDraftId`
- 링크 ID가 있는 항목의 대상 문서 `problems/{problemId}`, `problemDrafts/{problemDraftId}` 읽기 결과

## 분류 우선순위
1. `problemId`와 정식 문서 존재 → `linked`
2. `problemId`가 있으나 정식 문서 없음 → `broken-canonical` (후보도 있으면 별도 참고)
3. `problemDraftId`와 후보 문서 존재 → `candidate`
4. `problemDraftId`가 있으나 후보 문서 없음 → `broken-draft`
5. 둘 다 없음 → `unverified`

네트워크 오류, 권한 거부, 조회 제한, 시간초과는 `unknown-read-error`로 별도 분류한다. 절대 '문서 없음'으로 간주하지 않는다.

## 결과 지표
- 전체 자료 수, 원본 유형별 수, 정식 연결 수, 후보 연결 수, 링크 깨짐 수, 미확인 수, 조회 오류 수
- 원본별 `id`와 연결 ID만 보고. 학생 이름·질문 본문·사진·정답은 진단 로그에 포함하지 않는다.
- 구형 자료와 신규 자료를 구분할 수 있도록 생성일/날짜별 집계(원본 내용 제외).

## 금지 작업
- `set`, `update`, `delete`, `add`, 재분석, AI 호출, 일괄 재연결
- 문서 존재 확인 없이 링크 깨짐 판정
- 출처키만 같다는 이유로 정식 문항을 자동 병합
- 실데이터 미확인 상태에서 '정상', '누락 0건' 선언

## 수동 검증 시나리오
1. 교재 문제 질문 등록 → `questions/{id}`의 `problemDraftId` 또는 `problemId` 확인
2. 동일 교재/페이지/번호 해설 등록 → 기존 후보/문항으로 출처 연결 확인
3. 원장 답변 → 후보 해설 또는 정식 문항의 `problemKeys`에 반영 확인
4. 프린트 문제 질문 → `printId` + 문제번호로 연결 확인
5. M&m 문제 ID 질문 → 정식 문항 ID 직접 연결 확인
6. 기존 반별기록, 숙제, 출결, 학부모 안내 회귀검증

이 문서는 구현 전 검증 규격이다. 실제 Firebase 연결 점검이나 테스트 실행을 완료했다는 뜻이 아니다.
