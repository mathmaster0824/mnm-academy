/* 현재 운영 규칙(기준선) ↔ 1단계 제안 규칙 대조 — 같은 동작을 두 규칙에 똑같이 던져 차이를 확인한다. Emulator 필요, 가짜 데이터만 사용.
 *  (가) 학생 기능: 현재 규칙에서 되던 학생 동작이 1단계 규칙에서도 되는가 (회귀 없음)
 *  (나) 원장 전용: 현재 규칙에서 익명 세션이 되던 동작이 1단계 규칙에서 막히는가 (실제로 막힘)
 *  (다) 무력화 점검: 넓은 허용 규칙이 새 제한을 풀어버리지 않는가 — 규칙에 적지 않은 경로, 하위 경로, 위조 claim 포함 */
const { describe, it, before, after, beforeEach, seed, rulesPath, initializeTestEnvironment, fs, assertFails, assertSucceeds,
  A, B, CLS, DATE, WEEK, MONTH, ctx, op } = require('./helpers');

let cur, p1;
const mk = (id, f) => initializeTestEnvironment({ projectId: id, firestore: { rules: fs.readFileSync(rulesPath(f), 'utf8') } });
before(async () => { cur = await mk('demo-r-cmpcur', 'firestore.rules.current'); p1 = await mk('demo-r-cmpp1', 'firestore.rules.phase1.proposed'); });
after(async () => { await cur?.cleanup(); await p1?.cleanup(); });
beforeEach(async () => { for (const e of [cur, p1]) { await e.clearFirestore(); await seed(e); } });

const run = async (env, fn, expect, who = 'anon') => {
  const db = ctx[who](env);
  await (expect === 'ok' ? assertSucceeds : assertFails)(fn(db));
};

// (가) 학생 기능 — 두 규칙 모두 허용이어야 한다
const studentOk = [
  ['학생 목록·반·과정 읽기(로그인 화면 이전 구독)', op.list('students')],
  ['학생 로그인 코드 비교용 students 읽기', op.get(`students/${A}`)],
  ['숙제 제출(최초, 제출완료)', op.set(`submissions/${A}_2026-10-20`, { studentId: A, date: '2026-10-20', status: '제출완료', photos: [], reviewCount: 0 })],
  ['숙제 재제출(전체 덮어쓰기, 코멘트 유지 없이)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', photos: [] })],
  ['선생님 코멘트 확인 표시', op.update(`submissions/${A}_${DATE}`, { commentSeen: true })],
  ['공부 타이머 저장', op.set(`timerState/${A}_${DATE}`, { baseSeconds: 99 })],
  ['공부 타이머 삭제', op.del(`timerState/${A}_${DATE}`)],
  ['주말학습 사진 제출', op.set(`weekendSubmissions/${A}_${WEEK}`, { studentId: A, weekStart: WEEK, photos: ['x'] })],
  ['STAD 신청', op.set(`stadApplications/${A}_2026-12`, { studentId: A, month: '2026-12', status: 'pending', paymentConfirmed: false })],
  ['STAD 일일 기록', op.set(`stadDaily/${A}_2026-10-20`, { studentId: A, date: '2026-10-20', attended: false, todos: [] })],
  ['질문 올리기', op.set('questions/qNew', { studentId: A, status: '대기', text: '질문', photos: [], answerText: '', answerPhotos: [] })],
  ['질문 읽기', op.get('questions/qA')],
  ['답지 최초 제출', op.set(`answerSubmissions/asg9_${A}`, { assignmentId: 'asg9', studentId: A, originalAnswers: ['1'], wrongReasons: {}, autoResults: [], review: null })],
  ['틀린 이유 선택', op.update(`answerSubmissions/asg1_${A}`, { wrongReasons: { 1: '실수' } })],
  ['문제저장소 연동 쓰기(질문→저장소)', op.set('problemDrafts/dNew', { status: 'review' })],
  ['문제저장소 연동 쓰기(problems)', op.set('problems/pNew', { type: 'mc' })],
  ['반 기록·주간 계획·과제 읽기', op.get(`classRecords/${CLS}_${DATE}`)],
  ['과제 읽기', op.get('assignments/asg1')],
  ['KMM·내신 성적 읽기', op.get(`kmm/${A}_${DATE}`)],
  ['STAD 설정·주말 설정 읽기', op.get('stadSettings/main')],
];
describe('(가) 학생 기능 — 현재 규칙과 1단계 규칙 모두 허용(회귀 없음)', () => {
  for (const [label, fn] of studentOk) {
    it(`현재 규칙 허용 · ${label}`, () => run(cur, fn, 'ok'));
    it(`1단계 규칙 허용 · ${label}`, () => run(p1, fn, 'ok'));
  }
});

// (나) 원장 전용 — 현재 규칙은 열려 있고 1단계 규칙은 막는다
const directorOnly = [
  ['원장 비밀번호 문서 읽기', op.get('meta/settings')],
  ['원장 비밀번호 문서 수정', op.set('meta/settings', { adminPassword: 'x' }, { merge: true })],
  ['meta/directors 에 자기 uid 추가', op.set('meta/directors', { uids: ['anon1'] })],
  ['월말 리포트 읽기', op.get(`monthlyReports/2026-09_${A}`)],
  ['월말 리포트 목록', op.list('monthlyReports')],
  ['월말 리포트 생성', op.set('monthlyReports/2026-10_x', { x: 1 })],
  ['학생 정보(메모·코드) 수정', op.update(`students/${A}`, { code: '9999' })],
  ['학생 삭제', op.del(`students/${B}`)],
  ['반 정보 수정', op.update(`classes/${CLS}`, { name: 'x' })],
  ['반 기록(출결·점수) 수정', op.update(`classRecords/${CLS}_${DATE}`, { [A]: { attendance: '결석' } })],
  ['주간 계획 수정', op.update(`weeklyPlans/${CLS}_${WEEK}`, { [A]: { mon: 'x' } })],
  ['피드백 읽기', op.list('feedbacks')],
  ['해설 사진 읽기', op.get('solutionPhotos/sol1')],
  ['집중 기록 읽기', op.list('focusHistory')],
  ['내신 점수 수정', op.update(`schoolScores/ex1_${A}`, { score: 100 })],
  ['숙제 승인 처리', op.update(`submissions/${B}_${DATE}`, { status: '승인', teacherComment: '잘함' })],
  ['제출에 선생님 코멘트 쓰기', op.update(`submissions/${B}_${DATE}`, { teacherComment: '조작' })],
  ['숙제 제출 삭제', op.del(`submissions/${B}_${DATE}`)],
  ['STAD 신청 승인', op.update(`stadApplications/${A}_${MONTH}`, { status: 'approved', paymentConfirmed: true })],
  ['STAD 출석 처리', op.update(`stadDaily/${A}_${DATE}`, { attended: true })],
  ['질문에 답변 달기', op.update('questions/qA', { answerText: '조작 답변', status: '답변완료' })],
  ['답지 채점 결과 쓰기', op.update(`answerSubmissions/asg1_${A}`, { review: { result: '통과' } })],
  ['주말학습 수동 인정', op.set(`weekendSubmissions/${A}_2026-10-26`, { studentId: A, weekStart: '2026-10-26', manual: true })],
];
describe('(나) 원장 전용 동작 — 현재 규칙은 익명 세션에 열려 있고 1단계 규칙은 막는다', () => {
  for (const [label, fn] of directorOnly) {
    it(`현재 규칙: 열려 있음(문제점 확인) · ${label}`, () => run(cur, fn, 'ok'));
    it(`1단계 규칙: 막힘 · ${label}`, () => run(p1, fn, 'deny'));
  }
});

// (다) 무력화 점검 — 1단계 규칙에서 "넓은 허용"이 제한을 풀지 못하는지
describe('(다) 넓은 허용 규칙의 무력화 점검(1단계 규칙)', () => {
  const sessions = ['anon', 'anonForgedStudent', 'anonForgedDirector', 'passwordNotDirector', 'unauth'];
  const paths = [
    'meta/settings', 'meta/directors', 'monthlyReports/2026-09_stu_aaaaaaaaaa', 'settings/main', 'unlistedCollection/doc1',
    'meta/settings/sub/doc', 'monthlyReports/2026-09_stu_aaaaaaaaaa/versions/v1', 'students/stu_aaaaaaaaaa/private/x', 'feedbacks/f1',
  ];
  for (const who of sessions) for (const p of paths) {
    it(`${who} → ${p} 읽기 거부`, () => run(p1, op.get(p), 'deny', who));
    it(`${who} → ${p} 쓰기 거부`, () => run(p1, op.set(p, { x: 1 }), 'deny', who));
  }
  it('원장 세션은 규칙에 적지 않은 경로(settings/main)도 읽을 수 있다 — 전체 백업이 깨지지 않음', () => run(p1, op.get('settings/main'), 'ok', 'director'));
  it('허용 목록에서 uid 가 빠진 뒤에는 같은 원장 세션도 거부된다', async () => {
    await p1.withSecurityRulesDisabled(async (c) => { await require('firebase/firestore').setDoc(require('firebase/firestore').doc(c.firestore(), 'meta/directors'), { uids: [] }); });
    await run(p1, op.get('meta/settings'), 'deny', 'director');
  });
  it('meta/directors 문서가 없으면 아무도 원장이 아니다(익명·비밀번호 계정 모두)', async () => {
    await p1.withSecurityRulesDisabled(async (c) => { await require('firebase/firestore').deleteDoc(require('firebase/firestore').doc(c.firestore(), 'meta/directors')); });
    await run(p1, op.get('meta/settings'), 'deny', 'director');
    await run(p1, op.get('meta/settings'), 'deny', 'anon');
  });
});
