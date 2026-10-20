/* 서버 채점 함수 본체(functions/gradeAnswerSheet.js) 단독 시험 — 메모리 가짜 Firestore, 운영 접속 없음. 실행: node --test tests/grade-function.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeStoredSubmission } = require('../functions/gradeAnswerSheet.js');

function fakeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed)); const reads = []; const writes = [];
  return { store, reads, writes, collection: (c) => ({ doc: (id) => ({
    get: async () => { reads.push(`${c}/${id}`); const d = (store[c] || {})[id]; return { exists: d !== undefined, data: () => JSON.parse(JSON.stringify(d)) }; },
    update: async (patch) => { writes.push(`${c}/${id}`); store[c][id] = { ...store[c][id], ...patch }; },
  }) }) };
}
const base = () => ({
  assignments: { A1: { studentIds: ['s1'], problems: [
    { problemId: 'P1', type: 'mc', points: 2 }, { problemId: 'P2', type: 'short', points: 3 },
    { problemId: 'P3', type: 'constructed', points: 5 }, { problemId: 'P4', type: 'short', points: 1 } ] } },
  problemKeys: { P1: { answer: '③', acceptedAnswers: ['③'] }, P2: { answer: '17', acceptedAnswers: ['17'] } },
  answerSubmissions: { A1_s1: { originalAnswers: ['3', '18', '', '5'],
    autoResults: [{ state: 'grading' }, { state: 'grading' }, { state: 'pending' }, { state: 'grading' }] } },
});

test('저장된 제출을 정답키로 채점: ③=3 정답, 17≠18 오답, 서술형 pending 유지, 정답키 없는 문항은 pending(오답 단정 안 함)', async () => {
  const db = fakeDb(base());
  const out = await gradeStoredSubmission(db, 'A1', 's1');
  assert.deepEqual(out.autoResults.map((r) => r.state), ['correct', 'wrong', 'pending', 'pending']);
  assert.equal(out.autoResults[0].earnedPoints, 2);
  assert.equal(out.autoResults[1].earnedPoints, 0);
  assert.deepEqual(db.store.answerSubmissions.A1_s1.autoResults, out.autoResults);
});

test('응답과 저장 결과에 정답키·내부 표시가 없다', async () => {
  const db = fakeDb(base());
  const out = await gradeStoredSubmission(db, 'A1', 's1');
  const text = JSON.stringify(out) + JSON.stringify(db.store.answerSubmissions.A1_s1.autoResults);
  assert.ok(!/③|"17"|acceptedAnswers|keyMissing|"answer"/.test(text), text);
});

test('멱등: 이미 채점된 제출은 다시 채점·저장하지 않고 정답키도 읽지 않는다', async () => {
  const db = fakeDb(base());
  await gradeStoredSubmission(db, 'A1', 's1');
  db.reads.length = 0; db.writes.length = 0;
  const again = await gradeStoredSubmission(db, 'A1', 's1');
  assert.equal(again.alreadyGraded, true);
  assert.equal(db.writes.length, 0);
  assert.ok(!db.reads.some((r) => r.startsWith('problemKeys/')), db.reads.join());
});

test('답을 바꿔 정답 탐색 불가: 호출 인자로 답을 받지 않고 저장된 originalAnswers 만 채점', async () => {
  assert.equal(gradeStoredSubmission.length, 3); // (db, assignmentId, studentId)
});

test('원장이 먼저 바꾼 문항(grading 이 아닌 상태)은 덮어쓰지 않는다', async () => {
  const seed = base(); seed.answerSubmissions.A1_s1.autoResults[1] = { state: 'correct', earnedPoints: 3 };
  const db = fakeDb(seed);
  const out = await gradeStoredSubmission(db, 'A1', 's1');
  assert.equal(out.autoResults[1].state, 'correct');
});

test('배정 학생이 아니거나 문서가 없거나 id 가 이상하면 거절', async () => {
  const db = fakeDb(base());
  assert.equal((await gradeStoredSubmission(db, 'A1', 'sX')).error, 'not-found');
  const seed = base(); seed.answerSubmissions.A1_s2 = seed.answerSubmissions.A1_s1;
  assert.equal((await gradeStoredSubmission(fakeDb(seed), 'A1', 's2')).error, 'permission-denied');
  assert.equal((await gradeStoredSubmission(db, '../x', 's1')).error, 'invalid-argument');
  assert.equal((await gradeStoredSubmission(db, '', 's1')).error, 'invalid-argument');
});
