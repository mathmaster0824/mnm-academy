'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
Module._load = function(request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') return { onCall: (_options, handler) => handler, HttpsError };
  return originalLoad.call(this, request, parent, isMain);
};
const createHandlers = require('../functions/growthSurveyFunctions');
Module._load = originalLoad;

const union = values => ({ __arrayUnion: values });
function mergeValue(oldValue, newValue) {
  if (newValue && Array.isArray(newValue.__arrayUnion)) {
    const old = Array.isArray(oldValue) ? oldValue : [];
    return old.concat(newValue.__arrayUnion.filter(x => !old.some(y => JSON.stringify(y) === JSON.stringify(x))));
  }
  if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
    return { ...(oldValue && typeof oldValue === 'object' ? oldValue : {}), ...newValue };
  }
  return newValue;
}
class MemoryFirestore {
  constructor(seed = {}) { this.data = structuredClone(seed); }
  collection(name) { return new Collection(this, name); }
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: ref => ref.get(),
      set: (ref, data, options = {}) => writes.push({ type: 'set', ref, data: structuredClone(data), merge: !!options.merge }),
      create: (ref, data) => writes.push({ type: 'create', ref, data: structuredClone(data) }),
      update: (ref, data) => writes.push({ type: 'update', ref, data: structuredClone(data) })
    };
    const result = await fn(tx);
    for (const w of writes) {
      const col = this.data[w.ref.collection] ||= {};
      const old = col[w.ref.id];
      if (w.type === 'create' && old) throw new Error('already-exists');
      if (w.type === 'update' && !old) throw new Error('not-found');
      const next = w.merge || w.type === 'update' ? { ...(old || {}) } : {};
      for (const [key, value] of Object.entries(w.data)) next[key] = mergeValue(next[key], value);
      col[w.ref.id] = next;
    }
    return result;
  }
}
class DocRef {
  constructor(db, collection, id) { this.db = db; this.collection = collection; this.id = id; }
  async get() {
    const data = this.db.data[this.collection]?.[this.id];
    return { id: this.id, exists: data !== undefined, data: () => data && structuredClone(data), ref: this };
  }
  async set(data, options = {}) {
    const col = this.db.data[this.collection] ||= {};
    const next = options.merge ? { ...(col[this.id] || {}) } : {};
    for (const [key, value] of Object.entries(data)) next[key] = mergeValue(next[key], value);
    col[this.id] = next;
  }
}
class Query {
  constructor(db, collection, filters = [], max = Infinity) { Object.assign(this, { db, collection, filters, max }); }
  where(field, op, value) { return new Query(this.db, this.collection, [...this.filters, [field, op, value]], this.max); }
  limit(max) { return new Query(this.db, this.collection, this.filters, max); }
  async get() {
    const rows = Object.entries(this.db.data[this.collection] || {}).filter(([, data]) =>
      this.filters.every(([field, op, value]) => op === '==' ? data[field] === value :
        op === 'array-contains' ? Array.isArray(data[field]) && data[field].includes(value) : false)
    ).slice(0, this.max).map(([id, data]) => ({ id, data: () => structuredClone(data), ref: new DocRef(this.db, this.collection, id) }));
    return { docs: rows, empty: rows.length === 0, size: rows.length };
  }
}
class Collection extends Query {
  constructor(db, name) { super(db, name); }
  doc(id) { return new DocRef(this.db, this.collection, id); }
}
function setup(seed = {}) {
  const db = new MemoryFirestore(seed);
  const admin = { firestore: { FieldValue: { arrayUnion: (...values) => union(values) } } };
  const handlers = createHandlers(admin, db);
  return { db, sync: handlers.syncStudentQuestionToProblemRepo };
}
function request(studentId, questionId) {
  return { auth: { uid: studentId, token: { role: 'student', studentId, firebase: { sign_in_provider: 'custom' } } }, data: { questionId } };
}

test('학생 질문은 서버가 후보로 연결하고 반복 호출해도 후보를 중복 생성하지 않는다', async () => {
  const { db, sync } = setup({
    questions: { q1: { studentId: 'stu_a', sourceType: 'TEXTBOOK', sourceCourseId: 'course-1', sourceBook: '쎈', sourcePage: 'p 12', sourceProblemNo: '3번', text: '도형 질문', photos: [] } },
    courses: { 'course-1': { name: '중 1-1학기' } }
  });
  const first = await sync(request('stu_a', 'q1'));
  const second = await sync(request('stu_a', 'q1'));
  assert.equal(first.status, 'candidate');
  assert.equal(second.status, 'candidate');
  assert.equal(Object.keys(db.data.problemDrafts).length, 1);
  assert.equal(Object.keys(db.data.problemSources).length, 1);
  assert.equal(db.data.questions.q1.problemDraftId, first.problemDraftId);
  const draft = db.data.problemDrafts[first.problemDraftId];
  assert.equal(draft.sourceKey, 'course-1::쎈::p12::q3');
  assert.equal(draft.questionText, '도형 질문');
});

test('다른 학생은 질문 ID만 알아도 문제저장소 연결을 실행할 수 없다', async () => {
  const { sync } = setup({ questions: { q1: { studentId: 'stu_owner', sourceType: 'MNM', problemId: 'p1' } } });
  await assert.rejects(sync(request('stu_other', 'q1')), error => error.code === 'permission-denied');
});

test('이미 등록된 문제 출처와 일치하면 새 후보 대신 기존 문제에 연결한다', async () => {
  const key = 'mnm::p1';
  const { db, sync } = setup({
    questions: { q1: { studentId: 'stu_a', sourceType: 'MNM', problemId: 'p1' } },
    problems: { p1: { sourceKeys: [key] } }
  });
  const result = await sync(request('stu_a', 'q1'));
  assert.equal(result.status, 'linked');
  assert.equal(result.problemId, 'p1');
  assert.equal(db.data.questions.q1.problemId, 'p1');
  assert.equal(db.data.problemDrafts, undefined);
});

test('출처가 없는 학생 질문도 질문별 후보로 보존한다', async () => {
  const { db, sync } = setup({
    questions: { q2: { studentId: 'stu_a', sourceType: 'OTHER', text: '출처가 없는 질문', photos: [] } }
  });
  const result = await sync(request('stu_a', 'q2'));
  assert.equal(result.status, 'candidate');
  assert.equal(db.data.problemDrafts[result.problemDraftId].sourceKey, 'student-question::q2');
  assert.equal(db.data.questions.q2.problemDraftId, result.problemDraftId);
});

test('비밀번호 세션은 학생 callable을 호출할 수 없다', async () => {
  const { sync } = setup({
    questions: { q1: { studentId: 'stu_a', sourceType: 'MNM', problemId: 'p1' } }
  });
  await assert.rejects(sync({
    auth: { uid: 'stu_a', token: { role: 'student', studentId: 'stu_a', firebase: { sign_in_provider: 'password' } } },
    data: { questionId: 'q1' }
  }), error => error.code === 'permission-denied');
});

test('사진 질문 후보는 원장 분석 대기열에서 쓸 수 있는 이미지 키를 보존한다', async () => {
  const photo = { storageKey: 'questions/q3/photo.jpg', url: 'https://photos.example/q3.jpg' };
  const { db, sync } = setup({
    questions: { q3: { studentId: 'stu_a', sourceType: 'OTHER', text: '사진 문제', photos: [photo] } }
  });
  const result = await sync(request('stu_a', 'q3'));
  const draft = db.data.problemDrafts[result.problemDraftId];
  assert.equal(draft.status, 'review');
  assert.equal(draft.analysis.status, 'vision-pending');
  assert.equal(draft.cropKey, photo.storageKey);
  assert.deepEqual(draft.media, [photo]);
});
