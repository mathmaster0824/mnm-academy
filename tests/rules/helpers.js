/* Firestore 규칙 테스트 공통 도구 — 가짜 데이터만 사용한다(실제 학생·운영 데이터 없음).
 * 실행은 Firestore Emulator 안에서만 한다: tests/README.md 참고. 운영 프로젝트에는 접속하지 않는다
 * (projectId 가 'demo-' 로 시작하면 Emulator 가 실제 Firebase 프로젝트를 쓰지 않는다). */
const fs = require('fs');
const path = require('path');
const { describe, it, before, beforeEach, after } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const F = require('firebase/firestore');

const A = 'stu_aaaaaaaaaa';   // 가짜 학생 A (실제 ID 형식: 'stu_' + 10자)
const B = 'stu_bbbbbbbbbb';   // 가짜 학생 B
const A2 = 'stu_aaaaaaaaaab'; // A 의 ID 로 시작하는 다른 ID (접두어 충돌 시도용)
const CLS = 'cls_fakeclass1', CLS2 = 'cls_fakeclass2';
const DATE = '2026-10-19', WEEK = '2026-10-19', MONTH = '2026-11';
const DIR_UID = 'dir1';

const rulesPath = (name) => path.join(__dirname, '..', '..', 'security', name);

async function makeEnv(rulesFile) {
  return initializeTestEnvironment({
    projectId: 'demo-mnm-rules',
    firestore: { rules: fs.readFileSync(rulesPath(rulesFile), 'utf8') },
  });
}

// 가짜 시드 데이터(규칙 우회로 넣는다)
async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const S = (p, data) => F.setDoc(F.doc(d, p), data);
    await S('meta/settings', { adminPassword: 'FAKE-PASSWORD-NOT-REAL', isDefaultPassword: false });
    await S('meta/directors', { uids: [DIR_UID] });
    await S(`students/${A}`, { name: '가짜A', code: '1111', classId: CLS, status: 'active', memo: 'FAKE-MEMO', warnings: [] });
    await S(`students/${B}`, { name: '가짜B', code: '2222', classId: CLS, status: 'active', memo: 'FAKE-MEMO', warnings: [] });
    await S(`classes/${CLS}`, { name: '가짜반1', dayGroup: '월목', studentIds: [A, B] });
    await S(`classes/${CLS2}`, { name: '가짜반2', dayGroup: '화금', studentIds: [B] });
    await S('courses/course1', { name: '가짜과정', steps: [] });
    await S(`classRecords/${CLS}_${DATE}`, { [A]: { attendance: '출석', dailyTestScore: 90, note: 'FAKE' }, [B]: { attendance: '출석', dailyTestScore: 70, note: 'FAKE' } });
    await S(`weeklyPlans/${CLS}_${WEEK}`, { [A]: { mon: 'p.1' }, [B]: { mon: 'p.2' } });
    await S(`fridaySupp/${CLS}_${DATE}`, { [A]: { needed: true } });
    await S(`studentRecords/${A}_${CLS}_${DATE}`, { attendance: '출석' });
    await S(`studentRecords/${B}_${CLS}_${DATE}`, { attendance: '출석' });
    await S(`studentPlans/${A}_${CLS}_${WEEK}`, { mon: 'p.1' });
    await S(`studentPlans/${B}_${CLS}_${WEEK}`, { mon: 'p.2' });
    await S(`studentFridaySupp/${A}_${CLS}_${DATE}`, { needed: true });
    await S(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', teacherComment: 'FAKE', commentSeen: false });
    await S(`submissions/${B}_${DATE}`, { studentId: B, date: DATE, status: '제출완료' });
    await S(`submissions/${A}_2026-10-10`, { studentId: A, date: '2026-10-10', status: '최종불합격' });
    await S(`timerState/${A}_${DATE}`, { baseSeconds: 10 });
    await S(`timerState/${B}_${DATE}`, { baseSeconds: 20 });
    await S(`weekendSubmissions/${A}_${WEEK}`, { studentId: A, weekStart: WEEK, photos: [] });
    await S(`weekendSubmissions/${B}_${WEEK}`, { studentId: B, weekStart: WEEK, photos: [] });
    await S(`stadApplications/${A}_${MONTH}`, { studentId: A, month: MONTH, status: 'pending', paymentConfirmed: false });
    await S(`stadApplications/${B}_${MONTH}`, { studentId: B, month: MONTH, status: 'approved', paymentConfirmed: true });
    await S(`stadDaily/${A}_${DATE}`, { studentId: A, date: DATE, attended: false });
    await S(`stadDaily/${B}_${DATE}`, { studentId: B, date: DATE, attended: false });
    await S('questions/qA', { studentId: A, status: '대기', text: 'FAKE', photos: [], answerText: '', answerPhotos: [] });
    await S('questions/qB', { studentId: B, status: '대기', text: 'FAKE', photos: [], answerText: '', answerPhotos: [] });
    await S(`answerSubmissions/asg1_${A}`, { assignmentId: 'asg1', studentId: A, originalAnswers: ['1'], wrongReasons: {}, autoResults: [], review: null });
    await S(`answerSubmissions/asg1_${B}`, { assignmentId: 'asg1', studentId: B, originalAnswers: ['2'], wrongReasons: {}, autoResults: [], review: null });
    await S('assignments/asg1', { studentIds: [A, B], classId: CLS, problems: [] });
    await S('assignments/asg2', { studentIds: [B], classId: CLS2, problems: [] });
    await S(`practiceProgress/${A}`, { tracks: [] });
    await S(`practiceProgress/${B}`, { tracks: [] });
    await S(`kmm/${A}_${DATE}`, { studentId: A, date: DATE, score: 80 });
    await S(`kmm/${B}_${DATE}`, { studentId: B, date: DATE, score: 70 });
    await S(`schoolScores/ex1_${A}`, { examId: 'ex1', studentId: A, score: 90 });
    await S(`schoolScores/ex1_${B}`, { examId: 'ex1', studentId: B, score: 80 });
    await S(`monthlyReports/2026-09_${A}`, { month: '2026-09', studentId: A, generated: { text: 'FAKE-REPORT' } });
    await S('problems/p1', { type: 'mc' });
    await S('problemKeys/p1', { problemId: 'p1', answer: 'FAKE-ANSWER' });
    await S('problemDrafts/d1', { status: 'review' });
    await S('problemSources/s1', { fileName: 'fake.pdf' });
    await S('feedbacks/f1', { studentId: A, comment: 'FAKE' });
    await S('solutionPhotos/sol1', { title: 'FAKE' });
    await S(`focusHistory/${CLS}_${A}_${DATE}`, { classId: CLS, studentId: A, date: DATE });
    await S('videos/v1', { title: 'FAKE', url: 'https://example.invalid' });
    await S('schoolExams/ex1', { school: '가짜중', examName: 'FAKE' });
    await S('weekendClasses/wc1', { studentIds: [A] });
    await S('weekendSettings/main', { enabled: true });
    await S('stadSettings/main', { enabled: true, zoomLink: 'https://example.invalid/zoom' });
    await S('settings/main', { legacy: true });   // 전체 백업이 읽는, 규칙에 따로 적지 않은 경로
  });
}

// 컨텍스트(가짜 세션)
const ctx = {
  unauth: (env) => env.unauthenticatedContext().firestore(),
  anon: (env, uid = 'anon1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore(),
  // 익명 세션이 학생 claim 을 가진 것처럼 위조한 경우(클라이언트는 claim 을 만들 수 없지만 규칙이 공급자까지 확인하는지 본다)
  anonForgedStudent: (env) => env.authenticatedContext(A, { role: 'student', studentId: A, firebase: { sign_in_provider: 'anonymous' } }).firestore(),
  anonForgedDirector: (env) => env.authenticatedContext(DIR_UID, { mnmDirector: true, role: 'director', firebase: { sign_in_provider: 'anonymous' } }).firestore(),
  passwordNotDirector: (env) => env.authenticatedContext('pw_other', { firebase: { sign_in_provider: 'password' } }).firestore(),
  director: (env) => env.authenticatedContext(DIR_UID, { firebase: { sign_in_provider: 'password' } }).firestore(),
  student: (env, id) => env.authenticatedContext(id, { role: 'student', studentId: id, firebase: { sign_in_provider: 'custom' } }).firestore(),
};

// 연산(op) 도구 — 모두 (db)=>Promise
const op = {
  get: (p) => (db) => F.getDoc(F.doc(db, p)),
  set: (p, data, opts) => (db) => (opts ? F.setDoc(F.doc(db, p), data, opts) : F.setDoc(F.doc(db, p), data)),
  update: (p, data) => (db) => F.updateDoc(F.doc(db, p), data),
  del: (p) => (db) => F.deleteDoc(F.doc(db, p)),
  list: (c, ...cons) => (db) => F.getDocs(cons.length ? F.query(F.collection(db, c), ...cons) : F.collection(db, c)),
  where: F.where, documentId: F.documentId,
};

// 한 컨텍스트에 대한 사례 표를 테스트로 등록한다. cases: [라벨, op, 'ok' | 'deny']
function table(title, getEnv, makeDb, cases) {
  describe(title, () => {
    for (const [label, fn, expect] of cases) {
      it(`${expect === 'ok' ? '허용' : '거부'} · ${label}`, async () => {
        const db = makeDb(getEnv());
        await (expect === 'ok' ? assertSucceeds : assertFails)(fn(db));
      });
    }
  });
}

// 파일 하나 = 규칙 파일 하나. 테스트마다 데이터를 비우고 다시 시드한다.
function suite(rulesFile, body) {
  let env;
  before(async () => { env = await makeEnv(rulesFile); });
  after(async () => { if (env) await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); await seed(env); });
  body(() => env);
}

module.exports = { A, B, A2, CLS, CLS2, DATE, WEEK, MONTH, DIR_UID, ctx, op, table, suite, describe, it };
