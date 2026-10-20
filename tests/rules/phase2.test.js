/* 2단계 목표 규칙(security/firestore.rules.phase2.proposed) 테스트 — Emulator 필요.
 * 전제: 학생 세션은 서버가 발급한 custom token(claim: role='student', studentId)이고, 원장은 1단계와 같다.
 * 요구 시나리오:
 *   ① 학생이 다른 학생의 자료·원장 설정을 읽거나 수정할 수 없다
 *   ② 학생이 자기 숙제 제출 등 기존 기능은 계속 쓸 수 있다
 *   ③ 원장은 필요한 자료를 조회·수정할 수 있다
 *   ④ 월말 리포트는 권한 없는 세션에서 차단된다 */
const { A, B, A2, CLS, CLS2, DATE, WEEK, MONTH, ctx, op, table, suite } = require('./helpers');

suite('firestore.rules.phase2.proposed', (env) => {
  const W = op.where, ID = op.documentId;
  const stuA = (e) => ctx.student(e, A);

  // ── ② 학생 A 본인 기능 ───────────────────────────────────────────────────
  table('② 학생 A — 기존 기능이 계속 된다', env, stuA, [
    ['내 학생 문서 읽기', op.get(`students/${A}`), 'ok'],
    ['내가 속한 반 읽기', op.get(`classes/${CLS}`), 'ok'],
    ['내 반 목록(array-contains 쿼리)', op.list('classes', W('studentIds', 'array-contains', A)), 'ok'],
    ['내 주말반 목록', op.list('weekendClasses', W('studentIds', 'array-contains', A)), 'ok'],
    ['과정·주말·STAD 설정·내신시험·영상 읽기', op.list('courses'), 'ok'],
    ['STAD 설정 읽기', op.get('stadSettings/main'), 'ok'],
    ['주말학습 설정 읽기', op.get('weekendSettings/main'), 'ok'],
    ['내 수업기록 사본 읽기', op.get(`studentRecords/${A}_${CLS}_${DATE}`), 'ok'],
    ['내 주간계획 사본 읽기', op.get(`studentPlans/${A}_${CLS}_${WEEK}`), 'ok'],
    ['내 금요보강 사본 읽기', op.get(`studentFridaySupp/${A}_${CLS}_${DATE}`), 'ok'],
    ['내 숙제 읽기(정확한 문서)', op.get(`submissions/${A}_${DATE}`), 'ok'],
    ['숙제 신규 제출', op.set(`submissions/${A}_2026-10-20`, { studentId: A, date: '2026-10-20', status: '제출완료', hwPhotos: [] }), 'ok'],
    ['다른 반 슬롯 숙제 제출(학생ID_반ID_날짜)', op.set(`submissions/${A}_${CLS2}_2026-10-20`, { studentId: A, classId: CLS2, date: '2026-10-20', status: '제출완료' }), 'ok'],
    ['숙제 재제출(전체 덮어쓰기)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', hwPhotos: [] }), 'ok'],
    ['선생님 코멘트 확인 표시', op.update(`submissions/${A}_${DATE}`, { commentSeen: true }), 'ok'],
    ['재제출 시 기존 코멘트를 그대로 유지한 문서(숙제 초안 복사본)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', teacherComment: 'FAKE', commentSeen: false }), 'ok'],
    ['타이머 읽기·저장·삭제', op.set(`timerState/${A}_2026-10-20`, { baseSeconds: 5 }), 'ok'],
    ['타이머 삭제', op.del(`timerState/${A}_${DATE}`), 'ok'],
    ['주말학습 사진 제출', op.set(`weekendSubmissions/${A}_2026-10-26`, { studentId: A, weekStart: '2026-10-26', photos: [] }), 'ok'],
    ['주말학습 사진 삭제', op.del(`weekendSubmissions/${A}_${WEEK}`), 'ok'],
    ['STAD 신청(대기)', op.set(`stadApplications/${A}_2026-12`, { studentId: A, month: '2026-12', status: 'pending', paymentConfirmed: false }), 'ok'],
    ['내 STAD 신청 읽기', op.get(`stadApplications/${A}_${MONTH}`), 'ok'],
    ['STAD 할 일 제출', op.set(`stadDaily/${A}_${DATE}`, { studentId: A, date: DATE, todoItems: [], attended: false }, { merge: true }), 'ok'],
    ['내 질문 목록(studentId 쿼리)', op.list('questions', W('studentId', '==', A)), 'ok'],
    ['질문 등록', op.set('questions/qNew', { studentId: A, status: '대기', text: 'FAKE', photos: [], answerText: '', answerPhotos: [] }), 'ok'],
    ['질문 수정(글·사진)', op.update('questions/qA', { text: '수정', photos: [] }), 'ok'],
    ['내 답지 읽기', op.get(`answerSubmissions/asg1_${A}`), 'ok'],
    ['답지 최초 제출', op.set(`answerSubmissions/asg2_${A}`, { assignmentId: 'asg2', studentId: A, originalAnswers: ['1'], autoResults: [], wrongReasons: {}, review: null }), 'ok'],
    ['틀린 이유 선택', op.update(`answerSubmissions/asg1_${A}`, { wrongReasons: { 0: '실수' } }), 'ok'],
    ['내 배정 답지 목록(array-contains)', op.list('assignments', W('studentIds', 'array-contains', A)), 'ok'],
    ['내 연습진도 읽기', op.get(`practiceProgress/${A}`), 'ok'],
    ['내 내신 성적(studentId 쿼리)', op.list('schoolScores', W('studentId', '==', A)), 'ok'],
    ['내 KMM(studentId 쿼리)', op.list('kmm', W('studentId', '==', A)), 'ok'],
  ]);

  // ── ① 학생 A 가 다른 학생(B)의 자료를 건드리는 시도 ─────────────────────────
  table('① 학생 A → 다른 학생(B)의 자료는 막힌다', env, stuA, [
    ['B 학생 문서 읽기', op.get(`students/${B}`), 'deny'],
    ['전체 학생 목록 읽기(학생 코드 노출 경로)', op.list('students'), 'deny'],
    ['B 만 속한 반 읽기', op.get(`classes/${CLS2}`), 'deny'],
    ['반 목록 전체(필터 없음)', op.list('classes'), 'deny'],
    ['B 로 필터한 반 목록', op.list('classes', W('studentIds', 'array-contains', B)), 'deny'],
    ['B 숙제 읽기', op.get(`submissions/${B}_${DATE}`), 'deny'],
    ['B 이름으로 숙제 제출(문서 ID)', op.set(`submissions/${B}_2026-10-20`, { studentId: B, status: '제출완료' }), 'deny'],
    ['내 문서 ID 에 B 의 studentId 를 넣어 제출', op.set(`submissions/${A}_2026-10-20`, { studentId: B, status: '제출완료' }), 'deny'],
    ['A 로 시작하는 다른 ID(A2)의 숙제 읽기(접두어 충돌)', op.get(`submissions/${A2}_${DATE}`), 'deny'],
    ['숙제 목록 범위 쿼리(앱은 정확 조회로 바꿔야 함)', op.list('submissions', W(ID(), '>=', `${A}_2026-10-12`), W(ID(), '<', `${A}_`)), 'deny'],
    ['B 타이머 읽기·쓰기', op.set(`timerState/${B}_${DATE}`, { baseSeconds: 999 }), 'deny'],
    ['B 주말학습 읽기', op.get(`weekendSubmissions/${B}_${WEEK}`), 'deny'],
    ['B 주말학습 삭제', op.del(`weekendSubmissions/${B}_${WEEK}`), 'deny'],
    ['B STAD 신청 읽기', op.get(`stadApplications/${B}_${MONTH}`), 'deny'],
    ['B STAD 일일 기록 쓰기', op.set(`stadDaily/${B}_${DATE}`, { todoItems: [] }, { merge: true }), 'deny'],
    ['B 질문 읽기', op.get('questions/qB'), 'deny'],
    ['B 질문 목록(studentId 쿼리)', op.list('questions', W('studentId', '==', B)), 'deny'],
    ['질문 전체 목록(필터 없음)', op.list('questions'), 'deny'],
    ['B 질문 수정', op.update('questions/qB', { text: '해킹' }), 'deny'],
    ['B 로 질문 등록', op.set('questions/qFake', { studentId: B, status: '대기', answerText: '', answerPhotos: [] }), 'deny'],
    ['B 답지 읽기', op.get(`answerSubmissions/asg1_${B}`), 'deny'],
    ['B 이름으로 답지 제출', op.set(`answerSubmissions/asg2_${B}`, { assignmentId: 'asg2', studentId: B }), 'deny'],
    ['B 답지 수정', op.update(`answerSubmissions/asg1_${B}`, { wrongReasons: { 0: 'x' } }), 'deny'],
    ['B 만 배정된 답지 읽기', op.get('assignments/asg2'), 'deny'],
    ['B 연습진도 읽기', op.get(`practiceProgress/${B}`), 'deny'],
    ['B 수업기록 사본 읽기', op.get(`studentRecords/${B}_${CLS}_${DATE}`), 'deny'],
    ['B 주간계획 사본 읽기', op.get(`studentPlans/${B}_${CLS}_${WEEK}`), 'deny'],
    ['B KMM 읽기', op.list('kmm', W('studentId', '==', B)), 'deny'],
    ['B 내신 성적 읽기', op.list('schoolScores', W('studentId', '==', B)), 'deny'],
    ['반 단위 원본(같은 반 전체 점수·메모) 읽기', op.get(`classRecords/${CLS}_${DATE}`), 'deny'],
    ['반 단위 주간계획 원본 읽기', op.get(`weeklyPlans/${CLS}_${WEEK}`), 'deny'],
    ['금요보강 원본 읽기', op.get(`fridaySupp/${CLS}_${DATE}`), 'deny'],
  ]);

  // ── ① 학생 A 가 원장 설정·원장 전용 자료·원장 전용 상태값을 건드리는 시도 ──────
  table('① 학생 A → 원장 설정·원장 전용 자료·상태값은 막힌다', env, stuA, [
    ['meta/settings 읽기', op.get('meta/settings'), 'deny'],
    ['meta/settings 덮어쓰기', op.set('meta/settings', { adminPassword: 'x' }, { merge: true }), 'deny'],
    ['meta/directors 에 자기 uid 추가(권한 상승)', op.set('meta/directors', { uids: [A, 'dir1'] }), 'deny'],
    ['월말 리포트 읽기', op.get(`monthlyReports/2026-09_${A}`), 'deny'],
    ['월말 리포트 목록', op.list('monthlyReports', W('studentId', '==', A)), 'deny'],
    ['월말 리포트 쓰기', op.set(`monthlyReports/2026-10_${A}`, { x: 1 }), 'deny'],
    ['문제 정답키 읽기', op.get('problemKeys/p1'), 'deny'],
    ['문제·초안·출처 읽기', op.get('problems/p1'), 'deny'],
    ['피드백·해설사진·집중관리 읽기', op.get('feedbacks/f1'), 'deny'],
    ['규칙에 없는 컬렉션(settings/main) 읽기', op.get('settings/main'), 'deny'],
    ['학생 문서 수정(자기 것도)', op.update(`students/${A}`, { status: 'withdrawn' }), 'deny'],
    ['반 구성·과정 수정', op.set(`classes/${CLS}`, { studentIds: [] }, { merge: true }), 'deny'],
    ['숙제 승인 처리', op.update(`submissions/${A}_${DATE}`, { status: '승인' }), 'deny'],
    ['선생님 코멘트 작성', op.update(`submissions/${A}_${DATE}`, { teacherComment: 'x' }), 'deny'],
    ['선생님 코멘트 수정(상태는 제출완료 유지)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', teacherComment: '내가 쓴 코멘트' }), 'deny'],
    ['코멘트를 넣어 숙제 새로 만들기', op.set(`submissions/${A}_2026-10-23`, { studentId: A, status: '제출완료', teacherComment: 'x' }), 'deny'],
    ['숙제 삭제', op.del(`submissions/${A}_${DATE}`), 'deny'],
    ['최종불합격 숙제 재제출', op.set(`submissions/${A}_2026-10-10`, { studentId: A, status: '제출완료' }), 'deny'],
    ['STAD 자기 승인', op.set(`stadApplications/${A}_2026-12`, { studentId: A, status: 'approved', paymentConfirmed: true }), 'deny'],
    ['STAD 출석 표시', op.set(`stadDaily/${A}_${DATE}`, { attended: true }, { merge: true }), 'deny'],
    ['주말학습 수동인정 표시', op.set(`weekendSubmissions/${A}_2026-10-26`, { studentId: A, manual: true, photos: [] }), 'deny'],
    ['질문 답변 달기', op.update('questions/qA', { answerText: '답', status: '답변완료' }), 'deny'],
    ['답지 채점·검토 결과 쓰기', op.update(`answerSubmissions/asg1_${A}`, { review: { finalResults: [] } }), 'deny'],
    ['연습진도·KMM·내신 쓰기', op.set(`practiceProgress/${A}`, { tracks: [1] }), 'deny'],
    ['수업기록 사본 위조(서버만 쓴다)', op.set(`studentRecords/${A}_${CLS}_${DATE}`, { dailyTestScore: 100 }), 'deny'],
    ['규칙에 없는 컬렉션 쓰기', op.set('anything/doc1', { x: 1 }), 'deny'],
  ]);

  // ── 인증 방식 위조·익명·비로그인 ─────────────────────────────────────────
  const denyAll = [
    ['학생 문서 읽기', op.get(`students/${A}`)],
    ['내 숙제 읽기', op.get(`submissions/${A}_${DATE}`)],
    ['내 숙제 쓰기', op.set(`submissions/${A}_2026-10-20`, { studentId: A, status: '제출완료' })],
    ['내 질문 목록', op.list('questions', W('studentId', '==', A))],
    ['meta/settings 읽기', op.get('meta/settings')],
    ['월말 리포트 읽기', op.get(`monthlyReports/2026-09_${A}`)],
    ['월말 리포트 쓰기', op.set(`monthlyReports/2026-10_${A}`, { x: 1 })],
    ['과정 읽기', op.list('courses')],
  ].map(([l, f]) => [l, f, 'deny']);
  table('① 익명 세션(공급자 anonymous, claim 없음)', env, (e) => ctx.anon(e), denyAll);
  table('① 익명 + 학생 claim 위조', env, (e) => ctx.anonForgedStudent(e), denyAll);
  table('① 익명 + 원장 claim 위조', env, (e) => ctx.anonForgedDirector(e), denyAll);
  table('① 원장 UID 가 아닌 비밀번호 계정', env, (e) => ctx.passwordNotDirector(e), denyAll);
  table('① 비로그인', env, (e) => ctx.unauth(e), denyAll);

  // ── ③ 원장 ────────────────────────────────────────────────────────────────
  table('③ 원장 — 필요한 자료를 조회·수정할 수 있다', env, (e) => ctx.director(e), [
    ['전체 학생 목록(학생 코드·메모 포함)', op.list('students'), 'ok'],
    ['학생 문서 수정', op.update(`students/${A}`, { memo: 'x' }), 'ok'],
    ['반 구성 수정', op.set(`classes/${CLS}`, { studentIds: [A, B] }, { merge: true }), 'ok'],
    ['반 단위 수업기록 읽기·쓰기', op.set(`classRecords/${CLS}_${DATE}`, { [A]: { dailyTestScore: 100 } }, { merge: true }), 'ok'],
    ['주간계획·금요보강 쓰기', op.set(`weeklyPlans/${CLS}_${WEEK}`, { [A]: { mon: 'x' } }, { merge: true }), 'ok'],
    ['숙제 범위 쿼리(원장 최근 7일 화면)', op.list('submissions', W(ID(), '>=', `${A}_2026-10-12`), W(ID(), '<', `${A}_`)), 'ok'],
    ['숙제 날짜 쿼리', op.list('submissions', W('date', '>=', '2026-10-12')), 'ok'],
    ['검토대기 숙제 쿼리', op.list('submissions', W('status', '==', '대기')), 'ok'],
    ['숙제 승인·코멘트', op.update(`submissions/${A}_${DATE}`, { status: '승인', teacherComment: 'ok' }), 'ok'],
    ['STAD 승인·출석', op.set(`stadApplications/${A}_${MONTH}`, { status: 'approved', paymentConfirmed: true }, { merge: true }), 'ok'],
    ['질문 전체 목록·답변', op.update('questions/qA', { answerText: '답', status: '답변완료' }), 'ok'],
    ['답지 채점', op.update(`answerSubmissions/asg1_${A}`, { review: { finalResults: [] } }), 'ok'],
    ['KMM·내신·연습진도 쓰기', op.set(`kmm/${A}_${DATE}`, { score: 100 }, { merge: true }), 'ok'],
    ['학생별 사본 쓰기(서버 대행 전 점검용)', op.set(`studentRecords/${A}_${CLS}_${DATE}`, { attendance: '출석' }), 'ok'],
    ['문제저장소 읽기·쓰기', op.get('problemKeys/p1'), 'ok'],
    ['피드백·해설사진 쓰기', op.set('solutionPhotos/sol2', { title: 'x' }), 'ok'],
    ['전체 백업이 읽는 settings/main', op.get('settings/main'), 'ok'],
  ]);

  // ── ④ 월말 리포트 ─────────────────────────────────────────────────────────
  table('④ 원장 — 월말 리포트', env, (e) => ctx.director(e), [
    ['조회', op.get(`monthlyReports/2026-09_${A}`), 'ok'],
    ['month 쿼리', op.list('monthlyReports', W('month', '==', '2026-09')), 'ok'],
    ['수정본 저장', op.set(`monthlyReports/2026-09_${A}`, { edited: { text: 'x' } }, { merge: true }), 'ok'],
  ]);
});
