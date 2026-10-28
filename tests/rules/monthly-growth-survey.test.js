'use strict';

const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const {
  initializeTestEnvironment, assertFails, assertSucceeds
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, deleteDoc, updateDoc, query, where } = require('firebase/firestore');

const projectId = 'demo-mnm-growth-survey';
const ownerUid = 'growth-survey-director-test';
const studentId = 'growth-survey-student-test';
const ownDocId = studentId + '_2026-10';
const rulesPath = path.join(__dirname, '..', '..', 'security', 'firestore.rules.phase2.growth-survey.proposed');

let env;
before(async () => {
  const rules = fs.readFileSync(rulesPath, 'utf8')
    .replaceAll('REPLACE_WITH_DIRECTOR_UID', ownerUid);
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'growthSurveys', ownDocId), {
      studentId, month: '2026-10', status: 'published',
      student: { smallGoal: '오답 한 문제 다시 풀기' },
      teacher: { studentMemo: '꾸준히 해냈어요.' }
    });
    await setDoc(doc(db, 'students', studentId), {
      name: '테스트 학생', grade: '중2', memo: '원장 전용 테스트 메모',
      warnings: ['테스트 경고'], diligence: 80, status: 'active'
    });
    await setDoc(doc(db, 'classes', 'class-own'), { studentIds: [studentId] });
    await setDoc(doc(db, 'classes', 'class-other'), { studentIds: ['another-student'] });
    await setDoc(doc(db, 'weekendClasses', 'weekend-own'), { studentIds: [studentId] });
    await setDoc(doc(db, 'weekendClasses', 'weekend-other'), { studentIds: ['another-student'] });
    await setDoc(doc(db, 'assignments', 'assignment-own'), { studentIds: [studentId], title: 'fixture' });
    await setDoc(doc(db, 'assignments', 'assignment-other'), { studentIds: ['another-student'], title: 'fixture' });
    for (const name of ['schoolScores', 'questions', 'kmm']) {
      await setDoc(doc(db, name, name + '-own'), { studentId, title: 'fixture' });
      await setDoc(doc(db, name, name + '-other'), { studentId: 'another-student', title: 'fixture' });
    }
    await setDoc(doc(db, 'practiceProgress', studentId), { completed: 1 });
    await setDoc(doc(db, 'practiceProgress', 'another-student'), { completed: 2 });
    await setDoc(doc(db, 'stadApplications', studentId + '_2026-10'), {
      studentId, month: '2026-10', status: 'rejected', paymentConfirmed: false
    });
    await setDoc(doc(db, 'stadApplications', 'another-student_2026-10'), {
      studentId: 'another-student', month: '2026-10', status: 'pending', paymentConfirmed: false
    });
    await setDoc(doc(db, 'stadDaily', studentId + '_2026-10-27'), {
      studentId, date: '2026-10-27', attended: false, todoItems: []
    });
    await setDoc(doc(db, 'stadDaily', 'another-student_2026-10-27'), {
      studentId: 'another-student', date: '2026-10-27', attended: false, todoItems: []
    });
    await setDoc(doc(db, 'answerSubmissions', 'assignment-own_' + studentId), { studentId, assignmentId: 'assignment-own' });
    await setDoc(doc(db, 'answerSubmissions', 'assignment-other_another-student'), { studentId: 'another-student', assignmentId: 'assignment-other' });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test('등록된 원장 계정은 설문을 읽고 관리할 수 있다', async () => {
  const db = env.authenticatedContext(ownerUid, {
    firebase: { sign_in_provider: 'password' }
  }).firestore();
  await assertSucceeds(getDoc(doc(db, 'growthSurveys', ownDocId)));
  await assertSucceeds(setDoc(doc(db, 'growthSurveys', ownDocId), {
    studentId, month: '2026-10', status: 'published',
    student: { smallGoal: '목표' }, teacher: { studentMemo: '메모' }
  }));
});

test('학생 설문은 callable 전용이어서 본인 문서도 직접 읽거나 쓸 수 없다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  await assertFails(getDoc(doc(db, 'growthSurveys', ownDocId)));
  await assertFails(getDocs(collection(db, 'growthSurveys')));
  await assertFails(setDoc(doc(db, 'growthSurveys', ownDocId), {
    studentId, month: '2026-10', status: 'published'
  }));
  await assertFails(deleteDoc(doc(db, 'growthSurveys', ownDocId)));
});

test('다른 학생이나 비로그인 사용자는 설문에 접근할 수 없다', async () => {
  const anotherStudent = env.authenticatedContext('another-student', {
    role: 'student', studentId: 'another-student',
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  const anonymous = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anotherStudent, 'growthSurveys', ownDocId)));
  await assertFails(getDoc(doc(anonymous, 'growthSurveys', ownDocId)));
  await assertFails(getDocs(collection(anonymous, 'growthSurveys')));
});

test('학생은 기존 학생별 기록을 정확한 문서 조회로 읽고 다른 학생 기록은 읽지 못한다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  for (const collectionName of ['submissions', 'weekendSubmissions', 'stadApplications', 'stadDaily']) {
    await assertSucceeds(getDoc(doc(db, collectionName, studentId + '_2026-10-27')));
    await assertFails(getDoc(doc(db, collectionName, 'another-student_2026-10-27')));
  }
});

test('학생 프로필은 callable allowlist 경로만 사용하고 직접 읽기는 원장만 허용한다', async () => {
  const student = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  await assertFails(getDoc(doc(student, 'students', studentId)));
  await assertFails(getDocs(collection(student, 'students')));

  const director = env.authenticatedContext(ownerUid, {
    firebase: { sign_in_provider: 'password' }
  }).firestore();
  await assertSucceeds(getDoc(doc(director, 'students', studentId)));
  await assertSucceeds(getDocs(collection(director, 'students')));
});

test('학생 로그인 제한 문서는 클라이언트에서 접근할 수 없다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  await assertFails(getDoc(doc(db, '_system_login_throttle', 'hashed-ip')));
  await assertFails(setDoc(doc(db, '_system_login_throttle', 'hashed-ip'), {
    attempts: 0
  }));
});


test('학생 화면에서 쓰는 소속·학생ID 조건 조회는 본인 자료만 허용한다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();

  for (const collectionName of ['classes', 'weekendClasses', 'assignments']) {
    const own = query(collection(db, collectionName), where('studentIds', 'array-contains', studentId));
    const other = query(collection(db, collectionName), where('studentIds', 'array-contains', 'another-student'));
    const ownSnap = await assertSucceeds(getDocs(own));
    assert.equal(ownSnap.size, 1);
    await assertFails(getDocs(other));
  }

  for (const collectionName of ['schoolScores', 'questions', 'kmm']) {
    const own = query(collection(db, collectionName), where('studentId', '==', studentId));
    const other = query(collection(db, collectionName), where('studentId', '==', 'another-student'));
    const ownSnap = await assertSucceeds(getDocs(own));
    assert.equal(ownSnap.size, 1);
    await assertFails(getDocs(other));
  }

  await assertSucceeds(getDoc(doc(db, 'practiceProgress', studentId)));
  await assertFails(getDoc(doc(db, 'practiceProgress', 'another-student')));
  await assertSucceeds(getDoc(doc(db, 'answerSubmissions', 'assignment-own_' + studentId)));
  await assertFails(getDoc(doc(db, 'answerSubmissions', 'assignment-other_another-student')));
});

test('STAD 학생 쓰기는 본인 신청·일일 계획의 허용 필드만 바꿀 수 있다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();

  await assertSucceeds(updateDoc(doc(db, 'stadApplications', studentId + '_2026-10'), {
    status: 'pending', appliedAt: '2026-10-28T00:00:00.000Z', paymentConfirmed: false
  }));
  await assertFails(updateDoc(doc(db, 'stadApplications', 'another-student_2026-10'), {
    status: 'pending', paymentConfirmed: false
  }));
  await assertSucceeds(updateDoc(doc(db, 'stadDaily', studentId + '_2026-10-27'), {
    todoItems: [{ id: 'todo_1', task: '오답 정리', expectedMinutes: 20 }],
    todoSubmittedAt: '2026-10-28T00:00:00.000Z'
  }));
  await assertFails(updateDoc(doc(db, 'stadDaily', 'another-student_2026-10-27'), {
    todoItems: [{ id: 'todo_1', task: '조작 시도', expectedMinutes: 20 }]
  }));
  await assertFails(updateDoc(doc(db, 'stadDaily', studentId + '_2026-10-27'), { attended: true }));
  await assertFails(updateDoc(doc(db, 'stadDaily', studentId + '_2026-10-27'), { date: '2026-10-28' }));
});

test('학생은 답안 제출 때 채점 결과를 직접 기록할 수 없다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  const id = 'assignment-new_' + studentId;
  await assertSucceeds(setDoc(doc(db, 'answerSubmissions', id), {
    assignmentId: 'assignment-new', studentId, originalAnswers: ['42'], wrongReasons: {}, submittedAt: '2026-10-28T00:00:00.000Z'
  }));
  await assertFails(setDoc(doc(db, 'answerSubmissions', 'assignment-fake_' + studentId), {
    assignmentId: 'assignment-fake', studentId, originalAnswers: ['42'],
    autoResults: [{ state: 'correct', earnedPoints: 10 }]
  }));
});

test('학생의 기존 숙제·주말학습·질문·타이머 쓰기 경로는 본인 문서에서 동작한다', async () => {
  const db = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  const homeworkId = studentId + '_2026-10-28';
  const homeworkRef = doc(db, 'submissions', homeworkId);
  await assertSucceeds(setDoc(homeworkRef, {
    studentId, date: '2026-10-28', status: '제출완료', photos: ['fixture-photo'], submittedAt: '2026-10-28T00:00:00.000Z'
  }));
  await assertSucceeds(updateDoc(homeworkRef, { commentSeen: true }));
  await assertSucceeds(updateDoc(homeworkRef, { status: '제출완료', photos: ['fixture-photo-2'] }));

  const weekendRef = doc(db, 'weekendSubmissions', studentId + '_2026-10-27_sat_am');
  await assertSucceeds(setDoc(weekendRef, {
    studentId, weekStart: '2026-10-26', slot: 'sat_am', photos: ['fixture-photo'], submittedAt: '2026-10-28T00:00:00.000Z'
  }));
  await assertSucceeds(updateDoc(weekendRef, { studentId, weekStart: '2026-10-26', slot: 'sat_am', photos: [], submittedAt: '2026-10-28T00:00:00.000Z' }));
  await assertSucceeds(deleteDoc(weekendRef));

  const questionRef = doc(db, 'questions', 'question-own');
  await assertSucceeds(setDoc(questionRef, { studentId, text: '도형 문제 질문', photos: [], answerText: '', answerPhotos: [], status: '대기' }));
  await assertSucceeds(updateDoc(questionRef, { text: '도형 문제 질문을 수정했어요.' }));

  const timerRef = doc(db, 'timerState', studentId + '_2026-10-28');
  await assertSucceeds(setDoc(timerRef, { studentId, date: '2026-10-28', seconds: 60 }));
});

test('학생은 문제저장소에 직접 쓸 수 없고 원장만 대기열을 관리한다', async () => {
  const student = env.authenticatedContext(studentId, {
    role: 'student', studentId,
    firebase: { sign_in_provider: 'custom' }
  }).firestore();
  for (const collectionName of ['problemSources', 'problemDrafts', 'problems', 'problemKeys']) {
    await assertFails(setDoc(doc(student, collectionName, 'student-forged'), { sourceKey: 'fake' }));
  }

  const director = env.authenticatedContext(ownerUid, {
    firebase: { sign_in_provider: 'password' }
  }).firestore();
  await assertSucceeds(setDoc(doc(director, 'problemSources', 'server-candidate'), { sourceKey: 'fixture' }));
  await assertSucceeds(getDoc(doc(director, 'problemSources', 'server-candidate')));
});
