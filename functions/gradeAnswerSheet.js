/* 학생 답지 서버 채점 (Cloud Functions 2세대, 호출형).
 *
 * 상태: 준비된 코드일 뿐 **index.js 에서 내보내지 않았고 배포되지 않았으며, 앱(index.html)에도 연결하지 않았다.**
 *       켜는 절차와 한계는 docs/PROBLEM_REPO_STATUS.md 참고. 월말 리포트 배포(firebase deploy --only functions)에 섞여 나가지 않는다.
 * 원칙: 정답키는 이 함수 안에서만 읽고 응답·로그에 싣지 않는다. 학생 브라우저가 보낸 답이 아니라
 *       **이미 저장된 제출 문서의 originalAnswers** 를 채점하므로, 같은 제출을 바꿔 가며 정답을 알아내는 용도로 쓸 수 없다.
 *       이미 채점된 제출은 다시 채점하지 않고 저장된 결과를 돌려준다(멱등).
 * 한계: 호출자가 로그인한 사용자인지만 본다(학생 본인인지는 확인 못함 — 현재 학생 로그인이 코드 방식이라 불가능).
 */
'use strict';
const core = require('./gradeCore.js');

async function gradeStoredSubmission(db, assignmentId, studentId) {
  if (!assignmentId || !studentId || /[\/]/.test(assignmentId + studentId)) return { error: 'invalid-argument' };
  const subRef = db.collection('answerSubmissions').doc(`${assignmentId}_${studentId}`);
  const [subSnap, asnSnap] = await Promise.all([subRef.get(), db.collection('assignments').doc(assignmentId).get()]);
  if (!subSnap.exists || !asnSnap.exists) return { error: 'not-found' };
  const sub = subSnap.data(), asn = asnSnap.data();
  if (!(asn.studentIds || []).includes(studentId)) return { error: 'permission-denied' };
  const current = sub.autoResults || [];
  if (!current.some((r) => r && r.state === 'grading')) return { autoResults: current, alreadyGraded: true };

  const problems = asn.problems || [];
  const keyed = await Promise.all(problems.map(async (p) => {
    if (p.type === 'constructed' || p.answer !== undefined || (p.acceptedAnswers && p.acceptedAnswers.length) || !p.problemId) return p;
    const k = await db.collection('problemKeys').doc(p.problemId).get();
    return k.exists ? { ...p, answer: k.data().answer, acceptedAnswers: k.data().acceptedAnswers } : p;
  }));
  // 'grading' 이던 문항만 채점한다(그 사이 원장이 바꾼 결과는 덮어쓰지 않는다).
  const results = keyed.map((p, i) => {
    if (current[i] && current[i].state !== 'grading') return current[i];
    const r = core.gradeProblem(p, (sub.originalAnswers || [])[i]);
    return { state: r.state, earnedPoints: r.earnedPoints };   // keyMissing 같은 내부 표시는 저장·응답하지 않는다
  });
  await subRef.update({ autoResults: results });
  return { autoResults: results };
}

// onCall 래퍼는 배포 시점에 index.js 에서 한 줄로 연결한다(아래 예). 여기서는 firebase-functions 를 불러오지 않아 단독 시험이 가능하다.
//   const { onCall, HttpsError } = require('firebase-functions/v2/https');
//   exports.gradeAnswerSheet = onCall({ region: 'asia-northeast3' }, async (req) => {
//     if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
//     const out = await gradeStoredSubmission(admin.firestore(), String(req.data?.assignmentId || ''), String(req.data?.studentId || ''));
//     if (out.error) throw new HttpsError(out.error, out.error);
//     return { autoResults: out.autoResults };
//   });
module.exports = { gradeStoredSubmission };
