# M&m 공통 문항 분류 v2 — 개발 초안
상태: 설계 승인 방향 반영, 세부 교육과정 사전 미검증. 운영 반영 금지.
기준 커밋: 0bf8c49ea272265131d306a07d02ca72608e448b.

## 범위
초4-1~초6-2, 중1-1~중3-2, 공통수학1/2, 대수, 미적분Ⅰ, 확률과 통계. 교육과정 개정판별 구분. 중등 우선. 교과서 목차와 공식 성취기준을 확인하기 전 유형을 확정하지 않는다.

## 호환성
기존 problems, problemDrafts, problemSources, solutionPhotos, questions 및 문서 ID 보존. 기존 curriculumId는 과정 코드이므로 개정판은 별도 curriculumEditionId로 추가. primaryUnitId, primaryTypeId, problemTypeName, difficultyConfirmed, problemRole, conditionTags, representationTags, conceptTags, solutionSkills, searchTokens 보존. 기존 중3-1 U03 T01~T18은 삭제하거나 재사용하지 않고 교육과정 적합성 검토 후 매핑. 기존 데이터 덮어쓰기 금지. 미분류는 미분류 상태로 유지.

## 사전
과정/단원/개념/TYPE/SKILL에 불변 ID, 표시명, 별칭, 개정판 적용 범위, 상태(후보/승인/폐기), 버전, 근거 및 검수 기록. TYPE은 대표 개념 및 관련 개념 연결, SKILL은 단원 간 다대다 연결. AI는 승인된 ID만 선택, 새 분류는 후보로 제안. 교재 목차는 표준 단원에 별도 매핑. 명칭 변경 시 ID 유지.
난이도 1~5(기초/기본/보통/어려움/최상), 역할 concept_example/basic/representative/application/advanced/challenge 유지.

## 문항 및 검색
문항 형식, 조건, 표현, 출처(복수 가능), 주요문항(원장 지정), 검증 상태. 기출은 실제 출처와 연결; 빈출은 확인된 출제 이력에서 계산. 학생 질문과 오답은 별도 이벤트로 기록하고 개인별 접근 통제. 풀이 파일 중복 복제 없이 연결. 동일/유사/변형 구분, 동일 문항도 교사 확인 전 병합 금지.
문제저장소는 조회/관리, 문제공작소는 수집/추출/시험지 제작. 공통 검색 기준과 저장된 필터 프리셋 사용. 페이지 일부만 검색한 결과를 전체 결과로 표시하지 않는다.
질문 답변은 후보만 자동 추천, 원장 답변 등록 후 공개.

## 배포 게이트
운영 Firebase 및 파일 저장소 백업/복구 검증, 권한 점검, 개발 환경 회귀 시험, 기존 문항 수/ID/연결 비교, 실제 PDF 및 태블릿 시험, 원장 승인 후 배포. 이 문서는 운영 데이터나 코드 변경을 수행하지 않는다.
