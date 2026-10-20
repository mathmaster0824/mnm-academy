/* 1단계 제안 규칙(security/firestore.rules.phase1.proposed) 테스트 — Emulator 필요.
 * 목적: ① 학생(익명) 세션이 원장 설정·월말 리포트에 접근하지 못한다 ② 원장 권한은 서버(비밀번호 로그인+허용 목록)가
 * 검증한다 ③ 학생 세션의 기존 기능(숙제 제출 등)은 그대로 된다 ④ 학생 세션이 원장 전용 상태값을 바꾸지 못한다.
 * 1단계 한계(학생 A 가 B 의 자료를 읽는 것)는 맨 아래 "[알려진 한계]" 에 그대로 고정해 둔다. */
const { A, B, A2, CLS, DATE, WEEK, MONTH, ctx, op, table, suite } = require('./helpers');

suite('firestore.rules.phase1.proposed', (env) => {
  const anon = (e) => ctx.anon(e);
  const W = op.where, ID = op.documentId;

  // ① 원장 설정
  const metaDeny = [
    ['meta/settings 읽기(비밀번호 문서)', op.get('meta/settings')],
    ['meta 전체 목록', op.list('meta')],
    ['meta/settings 덮어쓰기', op.set('meta/settings', { adminPassword: 'x' }, { merge: true })],
    ['meta/directors 읽기', op.get('meta/directors')],
    ['meta/directors 에 자기 uid 추가(권한 상승 시도)', op.set('meta/directors', { uids: ['anon1', 'dir1'] })],
    ['meta 새 문서 만들기', op.set('meta/whatever', { x: 1 })],
  ].map(([l, f]) => [l, f, 'deny']);
  table('① 익명 학생 세션 → 원장 설정(meta)', env, anon, metaDeny);
  table('① 비밀번호 로그인이지만 허용 목록에 없는 계정 → meta', env, (e) => ctx.passwordNotDirector(e), metaDeny);
  table('① 익명 + 원장 claim 위조 → meta', env, (e) => ctx.anonForgedDirector(e), metaDeny);
  table('① 비로그인 → meta', env, (e) => ctx.unauth(e), metaDeny);
  table('① 원장(비밀번호 로그인 + 허용 목록) → meta', env, (e) => ctx.director(e), [
    ['meta/settings 읽기', op.get('meta/settings'), 'ok'],
    ['meta/settings 쓰기', op.set('meta/settings', { x: 1 }, { merge: true }), 'ok'],
    ['meta/directors 읽기', op.get('meta/directors'), 'ok'],
  ]);

  // ④ 월말 리포트
  const mrCases = [
    ['문서 조회', op.get(`monthlyReports/2026-09_${A}`)],
    ['컬렉션 목록', op.list('monthlyReports')],
    ['month 조건 쿼리', op.list('monthlyReports', W('month', '==', '2026-09'))],
    ['문서 생성', op.set('monthlyReports/2026-10_stu_fake', { x: 1 })],
    ['문서 수정', op.update(`monthlyReports/2026-09_${A}`, { status: 'reviewed' })],
    ['문서 삭제', op.del(`monthlyReports/2026-09_${A}`)],
    ['하위 컬렉션 조회', op.get(`monthlyReports/2026-09_${A}/versions/v1`)],
  ].map(([l, f]) => [l, f, 'deny']);
  table('④ 익명 학생 세션 → 월말 리포트', env, anon, mrCases);
  table('④ 허용 목록에 없는 비밀번호 계정 → 월말 리포트', env, (e) => ctx.passwordNotDirector(e), mrCases);
  table('④ 익명 + claim 위조 → 월말 리포트', env, (e) => ctx.anonForgedDirector(e), mrCases);
  table('④ 비로그인 → 월말 리포트', env, (e) => ctx.unauth(e), mrCases);
  table('④ 원장 → 월말 리포트', env, (e) => ctx.director(e), [
    ['문서 조회', op.get(`monthlyReports/2026-09_${A}`), 'ok'],
    ['month 조건 쿼리', op.list('monthlyReports', W('month', '==', '2026-09')), 'ok'],
    ['수정본 저장', op.set(`monthlyReports/2026-09_${A}`, { edited: { text: 'x' }, status: 'edited' }, { merge: true }), 'ok'],
  ]);

  // ③ 학생 세션의 기존 기능 유지
  table('③ 익명 학생 세션 — 기존 기능이 계속 된다', env, anon, [
    ['학생 목록 읽기(로그인 화면용)', op.list('students'), 'ok'],
    ['반·과정·주말/STAD 설정 읽기', op.list('classes'), 'ok'],
    ['과정 읽기', op.list('courses'), 'ok'],
    ['주말학습 설정 읽기', op.get('weekendSettings/main'), 'ok'],
    ['STAD 설정 읽기', op.get('stadSettings/main'), 'ok'],
    ['반 기록 읽기(문서 ID 범위 쿼리)', op.list('classRecords', W(ID(), '>=', `${CLS}_2026-10-12`), W(ID(), '<', `${CLS}_`)), 'ok'],
    ['주간계획 읽기', op.get(`weeklyPlans/${CLS}_${WEEK}`), 'ok'],
    ['내 숙제 읽기(문서 ID 범위 쿼리)', op.list('submissions', W(ID(), '>=', `${A}_2026-10-12`), W(ID(), '<', `${A}_`)), 'ok'],
    ['숙제 신규 제출(상태 제출완료)', op.set(`submissions/${A}_2026-10-20`, { studentId: A, date: '2026-10-20', status: '제출완료', hwPhotos: [] }, undefined), 'ok'],
    ['숙제 재제출(전체 덮어쓰기, 상태 제출완료)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', hwPhotos: [] }), 'ok'],
    ['선생님 코멘트 확인 표시(commentSeen)', op.update(`submissions/${A}_${DATE}`, { commentSeen: true }), 'ok'],
    ['재제출 시 기존 코멘트를 그대로 유지한 문서(숙제 초안 복사본)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', teacherComment: 'FAKE', commentSeen: false }), 'ok'],
    ['타이머 저장', op.set(`timerState/${A}_2026-10-20`, { baseSeconds: 5 }), 'ok'],
    ['타이머 삭제(제출 후 정리)', op.del(`timerState/${A}_${DATE}`), 'ok'],
    ['주말학습 사진 제출', op.set(`weekendSubmissions/${A}_2026-10-26`, { studentId: A, weekStart: '2026-10-26', photos: [] }), 'ok'],
    ['주말학습 사진 삭제', op.del(`weekendSubmissions/${A}_${WEEK}`), 'ok'],
    ['STAD 신청(대기)', op.set(`stadApplications/${A}_2026-12`, { studentId: A, month: '2026-12', status: 'pending', paymentConfirmed: false }), 'ok'],
    ['STAD 반려 후 재신청', op.set(`stadApplications/${A}_${MONTH}`, { status: 'pending', paymentConfirmed: false }, { merge: true }), 'ok'],
    ['STAD 할 일 제출', op.set(`stadDaily/${A}_${DATE}`, { studentId: A, date: DATE, todoItems: [], attended: false }, { merge: true }), 'ok'],
    ['질문 등록(대기, 답변 없음)', op.set('questions/qNew', { studentId: A, status: '대기', text: 'FAKE', photos: [], answerText: '', answerPhotos: [] }), 'ok'],
    ['질문 수정(글·사진만)', op.update('questions/qA', { text: '수정', photos: [] }), 'ok'],
    ['내 질문 조회(studentId 쿼리)', op.list('questions', W('studentId', '==', A)), 'ok'],
    ['답지 최초 제출', op.set(`answerSubmissions/asg2_${A}`, { assignmentId: 'asg2', studentId: A, originalAnswers: ['1'], autoResults: [], wrongReasons: {}, review: null }), 'ok'],
    ['답지 틀린 이유 선택', op.update(`answerSubmissions/asg1_${A}`, { wrongReasons: { 0: '실수' } }), 'ok'],
    ['답지 학습완료 표시', op.update(`answerSubmissions/asg1_${A}`, { learningCompletedAt: '2026-10-19T00:00:00Z' }), 'ok'],
    ['배정 답지 목록(array-contains 쿼리)', op.list('assignments', W('studentIds', 'array-contains', A)), 'ok'],
    ['내신 성적 조회(studentId 쿼리)', op.list('schoolScores', W('studentId', '==', A)), 'ok'],
    ['연습진도 읽기', op.get(`practiceProgress/${A}`), 'ok'],
    ['KMM 조회(studentId 쿼리)', op.list('kmm', W('studentId', '==', A)), 'ok'],
    ['검토대기 숙제 쿼리(원장 화면과 같은 읽기)', op.list('submissions', W('status', '==', '대기')), 'ok'],
  ]);

  // ④ 학생 세션이 원장 전용 조작을 못 한다
  table('④ 익명 학생 세션 — 원장 전용 조작은 막힌다', env, anon, [
    ['숙제 승인 처리', op.update(`submissions/${A}_${DATE}`, { status: '승인' }), 'deny'],
    ['숙제 보완 요청 처리', op.update(`submissions/${A}_${DATE}`, { status: '보완', reviewReason: 'x' }), 'deny'],
    ['선생님 코멘트 작성', op.update(`submissions/${A}_${DATE}`, { teacherComment: '잘했어요' }), 'deny'],
    ['선생님 코멘트 수정(상태는 제출완료 유지)', op.set(`submissions/${A}_${DATE}`, { studentId: A, date: DATE, status: '제출완료', teacherComment: '내가 쓴 코멘트' }), 'deny'],
    ['코멘트를 넣어 숙제 새로 만들기', op.set(`submissions/${A}_2026-10-23`, { studentId: A, status: '제출완료', teacherComment: 'x' }), 'deny'],
    ['승인 상태로 숙제 새로 만들기', op.set(`submissions/${A}_2026-10-21`, { studentId: A, status: '승인' }), 'deny'],
    ['최종불합격 숙제 재제출', op.set(`submissions/${A}_2026-10-10`, { studentId: A, status: '제출완료' }), 'deny'],
    ['숙제 삭제', op.del(`submissions/${A}_${DATE}`), 'deny'],
    ['학생 문서 수정', op.update(`students/${A}`, { status: 'withdrawn' }), 'deny'],
    ['학생 문서 생성', op.set('students/stu_new', { name: 'x' }), 'deny'],
    ['반 구성 수정', op.set(`classes/${CLS}`, { studentIds: [] }, { merge: true }), 'deny'],
    ['과정 수정', op.set('courses/course1', { steps: ['x'] }, { merge: true }), 'deny'],
    ['반 기록 쓰기', op.set(`classRecords/${CLS}_${DATE}`, { [A]: { dailyTestScore: 100 } }, { merge: true }), 'deny'],
    ['주간계획 쓰기', op.set(`weeklyPlans/${CLS}_${WEEK}`, { [A]: { mon: 'x' } }, { merge: true }), 'deny'],
    ['금요보강 쓰기', op.set(`fridaySupp/${CLS}_${DATE}`, { [A]: { done: true } }, { merge: true }), 'deny'],
    ['STAD 자기 승인(입금확인)', op.set(`stadApplications/${A}_2026-12`, { studentId: A, status: 'approved', paymentConfirmed: true }), 'deny'],
    ['STAD 승인된 신청을 대기로 되돌리기', op.set(`stadApplications/${B}_${MONTH}`, { status: 'pending', paymentConfirmed: false }, { merge: true }), 'deny'],
    ['STAD 신청 삭제', op.del(`stadApplications/${A}_${MONTH}`), 'deny'],
    ['STAD 출석 표시', op.set(`stadDaily/${A}_${DATE}`, { attended: true }, { merge: true }), 'deny'],
    ['주말학습 수동인정 표시', op.set(`weekendSubmissions/${A}_2026-10-26`, { studentId: A, manual: true, photos: [] }), 'deny'],
    ['질문 답변 달기', op.update('questions/qA', { answerText: '답', status: '답변완료' }), 'deny'],
    ['답변 있는 질문 만들기', op.set('questions/qFake', { studentId: A, status: '답변완료', answerText: '정답은 3' }), 'deny'],
    ['질문 삭제', op.del('questions/qA'), 'deny'],
    ['답지 채점·검토 결과 쓰기', op.update(`answerSubmissions/asg1_${A}`, { review: { finalResults: [] } }), 'deny'],
    ['KMM 점수 쓰기', op.set(`kmm/${A}_${DATE}`, { score: 100 }, { merge: true }), 'deny'],
    ['내신 성적 쓰기', op.set(`schoolScores/ex1_${A}`, { score: 100 }, { merge: true }), 'deny'],
    ['연습진도 쓰기', op.set(`practiceProgress/${A}`, { tracks: [1] }), 'deny'],
    ['배정 답지 만들기', op.set('assignments/asgX', { studentIds: [A] }), 'deny'],
    ['영상·내신시험 수정', op.set('videos/v1', { title: 'x' }, { merge: true }), 'deny'],
    ['피드백 읽기', op.get('feedbacks/f1'), 'deny'],
    ['해설사진 읽기', op.get('solutionPhotos/sol1'), 'deny'],
    ['집중관리 기록 읽기', op.list('focusHistory'), 'deny'],
    ['규칙에 없는 컬렉션 읽기(settings/main)', op.get('settings/main'), 'deny'],
    ['규칙에 없는 컬렉션 쓰기', op.set('anything/doc1', { x: 1 }), 'deny'],
  ]);

  // ⑤ 원장 기능
  table('⑤ 원장 — 필요한 조회·수정이 된다', env, (e) => ctx.director(e), [
    ['학생 문서 수정', op.update(`students/${A}`, { memo: 'x' }), 'ok'],
    ['학생 문서 생성·반 구성 수정', op.set(`classes/${CLS}`, { studentIds: [A, B] }, { merge: true }), 'ok'],
    ['반 기록 쓰기', op.set(`classRecords/${CLS}_${DATE}`, { [A]: { dailyTestScore: 100 } }, { merge: true }), 'ok'],
    ['주간계획 쓰기', op.set(`weeklyPlans/${CLS}_${WEEK}`, { [A]: { mon: 'x' } }, { merge: true }), 'ok'],
    ['숙제 승인·코멘트', op.update(`submissions/${A}_${DATE}`, { status: '승인', teacherComment: 'ok' }), 'ok'],
    ['숙제 삭제(학생 퇴원 정리)', op.del(`submissions/${A}_${DATE}`), 'ok'],
    ['STAD 승인', op.set(`stadApplications/${A}_${MONTH}`, { status: 'approved', paymentConfirmed: true }, { merge: true }), 'ok'],
    ['STAD 출석', op.set(`stadDaily/${A}_${DATE}`, { attended: true }, { merge: true }), 'ok'],
    ['질문 답변', op.update('questions/qA', { answerText: '답', status: '답변완료' }), 'ok'],
    ['답지 채점', op.update(`answerSubmissions/asg1_${A}`, { review: { finalResults: [] } }), 'ok'],
    ['KMM·내신·연습진도 쓰기', op.set(`kmm/${A}_${DATE}`, { score: 100 }, { merge: true }), 'ok'],
    ['피드백 작성', op.set('feedbacks/f2', { studentId: A, comment: 'x' }), 'ok'],
    ['해설사진 저장', op.set('solutionPhotos/sol2', { title: 'x' }), 'ok'],
    ['전체 백업이 읽는 settings/main', op.get('settings/main'), 'ok'],
    ['전체 컬렉션 목록 읽기(백업)', op.list('students'), 'ok'],
    ['월말 리포트 읽기', op.get(`monthlyReports/2026-09_${A}`), 'ok'],
  ]);

  // ⑥ 알려진 한계 — 1단계로는 막지 못한다. 2단계에서 이 항목들이 "거부"로 바뀌어야 한다.
  table('⑥ [알려진 한계] 1단계에서도 열려 있는 것 (2단계 필요)', env, anon, [
    ['학생 A 세션이 학생 B 의 숙제 제출을 읽는다', op.get(`submissions/${B}_${DATE}`), 'ok'],
    ['학생 A 세션이 B 의 이름으로 숙제를 제출한다', op.set(`submissions/${B}_2026-10-20`, { studentId: B, status: '제출완료' }), 'ok'],
    ['학생 A 세션이 B 의 질문·답지·타이머를 읽는다', op.get('questions/qB'), 'ok'],
    ['학생 목록에서 모든 학생의 코드(code)·메모가 읽힌다', op.get(`students/${B}`), 'ok'],
    ['같은 반 전체 학생의 점수·메모가 든 반 기록이 읽힌다', op.get(`classRecords/${CLS}_${DATE}`), 'ok'],
    ['문제저장소 정답키(problemKeys)가 읽힌다 — 질문→저장소 연결 때문에 현행 유지', op.get('problemKeys/p1'), 'ok'],
  ]);
});
