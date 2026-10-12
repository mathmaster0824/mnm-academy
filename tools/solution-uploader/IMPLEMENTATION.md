# M&m 풀이 업로드 보조 프로그램 — 구현 기준 (2026-10-12)

## 목적
기존 학습보관함·문제저장소 설계 변경 금지. 선생님 손풀이 PDF/사진을 일괄 입력받아 문제별 이미지 분리, 출처 자동입력, 미리보기·정정 후 **기존 학습보관함**에 등록하는 독립 도구.

## 실제 코드에서 확인한 기존 계약
- UI: `renderSolutionLib()`, 저장 함수 `addSolutionPhoto()` (index.html).
- Firestore 컬렉션: `solutionPhotos`.
- 필수 출처: `courseId`, `book`, `page`, `problemNo`.
- 저장 필드: `photo`, `courseId`, `book`, `bookKey`, `unit`, `page`, `pageKey`, `problemNo`, `problemNoKey`, `sourceKey`, `uploadedAt`.
- 정규화: `sourceBookKey(courseId,book)`, `sourcePageNorm(page)`, `sourceProblemNorm(problemNo)`, `textbookSourceKey(courseId,book,page,problemNo)`.
- 기존 등록 후 연결: `syncSolutionPhotoToProblemRepo(solId,solData)`.
- 현재 등록 UI는 1건마다 교재·페이지·번호를 입력하므로 입력 반복이 발생함.

## 독립 업로더 MVP
1. PDF/이미지 다중 입력. 원본 비파괴 보존.
2. 페이지 렌더링 및 풀이 영역 자동 분리. 영역 수정/추가/병합 가능. AI 결과를 원본으로 오인하지 않음.
3. 학년학기·교재는 묶음 단위 한 번 선택; 페이지·문제번호는 추출 제안 후 확인. 불확실 값은 자동 등록 금지.
4. 분리된 이미지 목록을 미리보기, 출처 정정, 중복 경고, 일괄 등록.
5. 학원 앱과 **동일한 기존 저장 계약** 사용; 등록 성공 건만 완료 처리, 실패 건은 재시도. 기존 자료 삭제/덮어쓰기 금지.
6. 등록 성공 시 기존 문제저장소 연계 흐름 유지. 원본-분할 이미지-등록 ID 대응 로그 보존.

## 안전 게이트
- 현재 운영 Firestore 규칙과 Worker 인증 미검증. 독립 업로더가 기존 익명 인증으로 직접 운영 Firestore에 기록하도록 배포 금지.
- 1차 구현은 로컬 브라우저 미리보기·분할·메타데이터 검증만 제공. 실제 쓰기 연결은 서버 측 인증·인가, staging 데이터, 회귀 테스트 후 승인받아 별도 적용.
- 정상 작동 중인 `index.html` 기존 기능은 수정하지 않음.
- 범위 외: 학습보관함 UI 재설계, 학생 공개 규칙 변경, 기존 문항 스키마 재설계.
