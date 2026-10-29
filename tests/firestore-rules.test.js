/* Firestore 규칙 테스트 — Firestore Emulator 필요 (실데이터 없음, 가짜 학생 ID만 사용)
 * 실행: cd tests && npm i && npx firebase emulators:exec --only firestore --project demo-mnm "node firestore-rules.test.js"
 * (저장소 루트에서: firebase.rules.test.json 을 쓰는 대신 아래 initializeTestEnvironment 가 security/firestore.rules.proposed 를 직접 읽는다)
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, collection, getDocs, updateDoc } = require('firebase/firestore');

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-mnm', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'security', 'firestore.rules.proposed'), 'utf8') } });
  // 시드(규칙 우회): 가짜 데이터
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'monthlyReports/2026-09_stu_fake1'), { month: '2026-09', studentId: 'stu_fake1', generated: { text: 'FAKE' } });
    await setDoc(doc(d, 'submissions/stu_fake1_2026-10-19'), { studentId: 'stu_fake1', status: '제출완료' });
    await setDoc(doc(d, 'classRecords/cls_fake_2026-10-19'), { stu_fake1: { attendance: '출석' } });
    await setDoc(doc(d, 'weeklyPlans/cls_fake_2026-10-19'), { stu_fake1: { mon: 'p.1' } });
    await setDoc(doc(d, 'questions/q1'), { studentId: 'stu_fake1', status: '대기' });
  });
  const anon = env.authenticatedContext('anonStudent', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const plain = env.authenticatedContext('plainUser', { firebase: { sign_in_provider: 'password' } }).firestore();
  const director = env.authenticatedContext('serverDirector', { mnmDirector: true, firebase: { sign_in_provider: 'password' } }).firestore();
  const anonDirectorClaim = env.authenticatedContext('anonWithClaim', { mnmDirector: true, firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const none = env.unauthenticatedContext().firestore();
  const R = 'monthlyReports/2026-09_stu_fake1';
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  for (const [label, db] of [['익명 학생', anon], ['일반 인증 사용자(권한 없음)', plain], ['익명+claim 위조 시도', anonDirectorClaim], ['비로그인', none]]) {
    t(label + ': 월말 리포트 문서 조회 거부', () => assertFails(getDoc(doc(db, R))));
    t(label + ': 월말 리포트 목록 조회 거부', () => assertFails(getDocs(collection(db, 'monthlyReports'))));
    t(label + ': 월말 리포트 생성 거부', () => assertFails(setDoc(doc(db, 'monthlyReports/2026-09_stu_fake2'), { month: '2026-09', studentId: 'stu_fake2' })));
    t(label + ': 월말 리포트 수정 거부', () => assertFails(updateDoc(doc(db, R), { hasNewerDraft: true })));
    t(label + ': 월말 리포트 삭제 거부', () => assertFails(deleteDoc(doc(db, R))));
    t(label + ': 월말 리포트 하위 컬렉션 조회 거부', () => assertFails(getDocs(collection(db, R + '/versions'))));
  }
  t('서버 검증 원장 claim: 조회 허용', () => assertSucceeds(getDoc(doc(director, R))));
  t('서버 검증 원장 claim: 목록 허용', () => assertSucceeds(getDocs(collection(director, 'monthlyReports'))));
  t('서버 검증 원장 claim: 생성·수정·삭제 허용', async () => {
    await assertSucceeds(setDoc(doc(director, 'monthlyReports/2026-09_stu_fake3'), { month: '2026-09', studentId: 'stu_fake3' }));
    await assertSucceeds(updateDoc(doc(director, 'monthlyReports/2026-09_stu_fake3'), { status: 'edited' }));
    await assertSucceeds(deleteDoc(doc(director, 'monthlyReports/2026-09_stu_fake3')));
  });
  // 기존 기능 회귀: 기존 정책(request.auth != null) 유지
  for (const [label, db] of [['익명 학생', anon], ['일반 인증 사용자', plain]]) {
    t(label + ': 숙제 제출 읽기/쓰기 유지', async () => {
      await assertSucceeds(getDoc(doc(db, 'submissions/stu_fake1_2026-10-19')));
      await assertSucceeds(setDoc(doc(db, 'submissions/stu_fake1_cls_fake_2026-10-20'), { studentId: 'stu_fake1', classId: 'cls_fake', status: '제출완료' }));
    });
    t(label + ': 수업 기록·주간계획 읽기/쓰기 유지', async () => {
      await assertSucceeds(getDoc(doc(db, 'classRecords/cls_fake_2026-10-19')));
      await assertSucceeds(setDoc(doc(db, 'classRecords/cls_fake_2026-10-19'), { stu_fake1: { dailyTestScore: 90 } }, { merge: true }));
      await assertSucceeds(getDoc(doc(db, 'weeklyPlans/cls_fake_2026-10-19')));
      await assertSucceeds(setDoc(doc(db, 'weeklyPlans/cls_fake_2026-10-26'), { stu_fake1: { tue: 'p.2' } }, { merge: true }));
    });
    t(label + ': 질문·답변 읽기/쓰기 유지', async () => {
      await assertSucceeds(getDoc(doc(db, 'questions/q1')));
      await assertSucceeds(updateDoc(doc(db, 'questions/q1'), { status: '답변완료' }));
    });
  }
  t('비로그인: 기존 컬렉션도 거부(기존 정책)', () => assertFails(getDoc(doc(none, 'submissions/stu_fake1_2026-10-19'))));

  let fail = 0;
  for (const [name, fn] of cases) { try { await fn(); console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } }
  await env.cleanup();
  console.log(`${cases.length - fail}/${cases.length} passed`);
  process.exit(fail ? 1 : 0);
})();
