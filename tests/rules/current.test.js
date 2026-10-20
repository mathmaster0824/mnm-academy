/* [기준선] 현재 운영 규칙(security/firestore.rules.current)이 무엇을 허용하는지 고정해 두는 테스트.
 * 2026-10-19 원장이 Firebase 콘솔 규칙 탭에서 직접 확인한 규칙을 그대로 옮긴 것이다.
 * 아래 "허용" 항목은 전부 **보안 문제의 증거**다. 1·2단계 규칙이 적용되면 이 노출은 사라져야 하며,
 * 이 파일은 그때 삭제하거나 phase1/phase2 테스트로 대체한다. */
const { A, B, DATE, CLS, ctx, op, table, suite } = require('./helpers');

suite('firestore.rules.current', (env) => {
  const anon = (e) => ctx.anon(e);

  table('[현재 노출] 익명 학생 세션 = 로그인만 하면 전부 허용', env, anon, [
    ['원장 설정 문서(meta/settings, 비밀번호 필드 포함) 읽기', op.get('meta/settings'), 'ok'],
    ['원장 설정 문서 덮어쓰기(비밀번호 변경 가능)', op.set('meta/settings', { adminPassword: 'x' }, { merge: true }), 'ok'],
    ['다른 학생(B) 숙제 제출 읽기', op.get(`submissions/${B}_${DATE}`), 'ok'],
    ['다른 학생(B) 숙제 제출 삭제', op.del(`submissions/${B}_${DATE}`), 'ok'],
    ['전체 학생 목록(학생 코드 필드 포함) 읽기', op.list('students'), 'ok'],
    ['학생 문서 수정', op.update(`students/${B}`, { status: 'withdrawn' }), 'ok'],
    ['반 기록(같은 반 전체 학생 점수·메모) 읽기', op.get(`classRecords/${CLS}_${DATE}`), 'ok'],
    ['월말 리포트 문서 생성', op.set('monthlyReports/2026-10_stu_fake', { x: 1 }), 'ok'],
    ['월말 리포트 읽기', op.get(`monthlyReports/2026-09_${A}`), 'ok'],
    ['문제 정답키(problemKeys) 읽기', op.get('problemKeys/p1'), 'ok'],
    ['STAD 신청 자기 승인(입금확인) 처리', op.update(`stadApplications/${A}_2026-11`, { status: 'approved', paymentConfirmed: true }), 'ok'],
  ]);

  table('[현재] 비로그인 세션은 거부', env, (e) => ctx.unauth(e), [
    ['meta/settings 읽기', op.get('meta/settings'), 'deny'],
    ['학생 목록 읽기', op.list('students'), 'deny'],
  ]);
});
