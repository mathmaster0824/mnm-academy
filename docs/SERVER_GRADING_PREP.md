# 서버 자동 채점 — 준비 작업 (앱에 연결되지 않음 · 꺼짐 · 배포 안 됨)

> 문제저장소 복구(PR #14)와 **별개**. 이 브랜치는 PR #14 위에 쌓은 별도 draft 이며, 병합·배포·활성화하지 않았다. `index.html` 은 바꾸지 않았다.

## 무엇이 들어 있나
- `functions/gradeCore.js` — 채점 규칙(순수 함수). 앱의 `normalizeAnswerValue`/`localGradeProblem` 과 같은 규칙.
- `functions/gradeAnswerSheet.js` — 저장된 제출 문서를 채점하는 함수 본체. `functions/index.js` 에서 **내보내지 않아** 월말 리포트 배포(`firebase deploy --only functions`)에 섞이지 않는다.
- `tests/grade-function.test.js`(6개, 가짜 Firestore) + `tests/problem-repo.test.js` 의 규칙 일치 시험(앱 `localGradeProblem` 과 코어를 12개 사례에 같이 돌려 비교).

## 설계 요점
- 요청에는 `assignmentId`·`studentId` 만 싣는다. 학생 답과 정답키는 요청·응답·로그에 없다.
- 함수는 **이미 저장된 제출의 답**을 채점하고, 이미 채점된 제출은 다시 채점하지 않는다(멱등) → 답을 바꿔 가며 정답을 알아내는 용도로 쓸 수 없다.
- 서술형·정답키 없는 문항은 '확인중'. 원장이 먼저 바꾼 문항은 덮어쓰지 않는다.
- 한계: 호출자가 로그인한 사용자인지만 본다(학생 로그인이 코드 방식이라 본인 확인 불가). 현재 Firestore 규칙에서는 학생 세션이 제출 문서를 직접 쓸 수 있어 조작을 막지 못한다(보안 단계 범위).

## 켜려면 (모두 승인 후 · 지금은 하지 않음)
1. `functions/index.js` 에 호출형 함수 연결(`gradeAnswerSheet.js` 파일 아래쪽 주석 예시).
2. 배포 — 월말 리포트와 같은 Blaze 요금제 확인(`docs/MONTHLY_REPORT_DEPLOY.md`), **시험용 Firebase 프로젝트에서 먼저**.
3. 앱 연결: `requestServerGrade`(index.html) 가 현재는 `null` 을 돌려주는 빈 연결 지점이다. 아래 형태로 바꾸되 기본은 꺼짐(`enabled:false`)으로 둔다.
```js
const SERVER_GRADING={enabled:false,url:'',timeoutMs:15000};
async function requestServerGrade(assignmentId,studentId,answers){
  if(!SERVER_GRADING.enabled||!SERVER_GRADING.url) return null;
  // POST {data:{assignmentId,studentId}} + 로그인 토큰 → result.autoResults 를 검증(길이=문항 수)해 반환, 실패는 null(원장 채점 대기로 유지)
}
```
(이전에 이 연결 코드를 작성해 가짜 서버로 시험했으나, "연결하지 않는다"는 방침에 따라 이 브랜치에서는 적용하지 않고 형태만 남긴다.)

## 확인 상태
- 가짜 Firestore·앱 규칙 일치 시험 통과.
- **실제 Firebase(호출형 함수 프로토콜, 인증, 리전, 비용) 미확인.**
