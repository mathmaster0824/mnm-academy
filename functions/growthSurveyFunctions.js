/* Secure, bounded Cloud Functions for the monthly growth survey.
 * Every read is an exact document read or a month query capped at 10 rows.
 * No handler scans students, classes, assignments, or survey history.
 */
'use strict';

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const core = require('./growthSurveyCore');

const REGION = 'asia-northeast3';
const COLLECTION = 'growthSurveys';
const PAGE_SIZE = 10;
const MAX_MONTH_LIST = 10;

function kstDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return m.year + '-' + m.month + '-' + m.day;
}
function monthFromDate(date) { return String(date).slice(0, 7); }
function previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
}
function validStudentId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
}
function docId(studentId, month) { return studentId + '_' + month; }
function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  return request.auth;
}
function requireStudent(request) {
  const auth = requireAuth(request);
  const claims = auth.token || {};
  if (claims.role !== 'student' || !validStudentId(claims.studentId) || auth.uid !== claims.studentId) {
    throw new HttpsError('permission-denied', '학생 권한이 확인되지 않았습니다.');
  }
  return { uid: auth.uid, studentId: claims.studentId };
}
function requireDirector(request) {
  const auth = requireAuth(request);
  const providers = auth.token.firebase && auth.token.firebase.sign_in_provider;
  const configured = String(process.env.MNM_DIRECTOR_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (providers !== 'password' || !configured.includes(auth.uid)) {
    throw new HttpsError('permission-denied', '원장 권한이 확인되지 않았습니다.');
  }
  return auth.uid;
}
function shiftDate(dateISO, days) {
  const d = new Date(dateISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
function weekStartKST(dateISO) {
  const d = new Date(dateISO + 'T12:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function requireMonth(value) {
  if (!core.isMonth(value)) throw new HttpsError('invalid-argument', '월 형식이 올바르지 않습니다.');
  return value;
}
function safeStudentView(doc) {
  if (!doc) return null;
  return {
    studentId: doc.studentId,
    month: doc.month,
    status: doc.status,
    templateVersion: doc.templateVersion,
    student: doc.student || {},
    teacher: doc.status === 'published' ? (doc.teacher || {}) : null,
    evidenceRefs: doc.evidenceRefs || [],
    publishedAt: doc.status === 'published' ? (doc.publishedAt || null) : null
  };
}
async function takeLoginAttempt(fs, request) {
  const ip = String(request.rawRequest && request.rawRequest.ip || 'unknown');
  const key = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 48);
  const ref = fs.collection('_system_login_throttle').doc(key);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  let blocked = false;
  await fs.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prior = snap.exists ? snap.data() : {};
    const started = Number(prior.windowStartedAt || 0);
    const count = started > now - windowMs ? Number(prior.attempts || 0) : 0;
    if (count >= 10) { blocked = true; return; }
    tx.set(ref, { windowStartedAt: started > now - windowMs ? started : now, attempts: count + 1, expiresAt: new Date(now + 24 * 60 * 60 * 1000) });
  });
  if (blocked) throw new HttpsError('resource-exhausted', '시도가 많습니다. 잠시 뒤 다시 시도해주세요.');
}
async function findStudentByCode(fs, code) {
  const refs = fs.collection('students');
  const results = await Promise.all([
    refs.where('code', '==', code).limit(2).get(),
    refs.where('code', '==', Number(code)).limit(2).get()
  ]);
  const matches = new Map();
  results.forEach(snap => snap.docs.forEach(doc => matches.set(doc.id, doc)));
  if (matches.size !== 1) return null;
  const match = [...matches.values()][0];
  const student = match.data();
  if (!student || student.status === 'withdrawn') return null;
  return match.id;
}

function createGrowthSurveyHandlers(admin, fs) {
  return {
    getStudentBootstrap: onCall({ region: REGION }, async request => {
      const { studentId } = requireStudent(request);
      const today = kstDate();
      const start = shiftDate(today, -6);
      const endEx = shiftDate(today, 1);
      const studentSnap = await fs.collection('students').doc(studentId).get();
      if (!studentSnap.exists || studentSnap.data().status === 'withdrawn') {
        throw new HttpsError('permission-denied', '학생 정보를 확인할 수 없습니다.');
      }
      const rawStudent = studentSnap.data();
      const classSnap = await fs.collection('classes')
        .where('studentIds', 'array-contains', studentId).limit(5).get();
      const classDocs = new Map(classSnap.docs.map(d => [d.id, d]));
      if (rawStudent.classId && !classDocs.has(rawStudent.classId)) {
        const legacy = await fs.collection('classes').doc(String(rawStudent.classId)).get();
        if (legacy.exists) classDocs.set(legacy.id, legacy);
      }
      const classes = [...classDocs.values()].sort((a,b) => (a.id === String(rawStudent.classId || '') ? -1 : b.id === String(rawStudent.classId || '') ? 1 : a.id.localeCompare(b.id))).slice(0, 5).map(d => ({
        id: d.id,
        name: String(d.data().name || ''),
        dayGroup: String(d.data().dayGroup || ''),
        studentIds: [studentId]
      }));
      const FieldPath = admin.firestore.FieldPath;
      const recordTasks = classes.map(async cls => {
        const [records, suppCurrent, suppLegacy, plan] = await Promise.all([
          fs.collection('classRecords')
            .where(FieldPath.documentId(), '>=', cls.id + '_' + start)
            .where(FieldPath.documentId(), '<', cls.id + '_' + endEx).get(),
          fs.collection('fridaySupp').doc(cls.id + '_' + weekStartKST(today)).get(),
          fs.collection('fridaySupp').doc(cls.id + '_' + shiftDate(weekStartKST(today), -1)).get(),
          fs.collection('weeklyPlans').doc(cls.id + '_' + weekStartKST(today)).get()
        ]);
        const outRecords = {};
        records.docs.forEach(d => {
          const mine = d.data()[studentId];
          if (mine) outRecords[d.id] = { [studentId]: mine };
        });
        const current = suppCurrent.exists ? suppCurrent.data()[studentId] : null;
        const legacy = suppLegacy.exists ? suppLegacy.data()[studentId] : null;
        const supp = Object.assign({}, legacy || {}, current || {});
        const fridaySupp = Object.keys(supp).length ? { [cls.id + '_' + weekStartKST(today)]: { [studentId]: supp } } : {};
        const rawPlan = plan.exists ? plan.data()[studentId] : null;
        const weeklyPlans = rawPlan ? { [cls.id + '_' + weekStartKST(today)]: { [studentId]: rawPlan } } : {};
        return { outRecords, fridaySupp, weeklyPlans };
      });
      const [perClass, weekendClassSnap, weekendSettingsSnap, stadSettingsSnap] = await Promise.all([
        Promise.all(recordTasks),
        fs.collection('weekendClasses').where('studentIds', 'array-contains', studentId).limit(10).get(),
        fs.collection('weekendSettings').doc('main').get(),
        fs.collection('stadSettings').doc('main').get()
      ]);
      const classRecords = {}, fridaySupp = {}, weeklyPlans = {};
      perClass.forEach(x => { Object.assign(classRecords, x.outRecords); Object.assign(fridaySupp, x.fridaySupp); Object.assign(weeklyPlans, x.weeklyPlans); });
      const student = {
        id: studentId, name: String(rawStudent.name || ''), grade: String(rawStudent.grade || ''),
        classId: String(rawStudent.classId || ''), status: String(rawStudent.status || 'active')
      };
      const weekendClasses = weekendClassSnap.docs.map(d => {
        const data = d.data();
        return { id: d.id, name: String(data.name || ''), school: String(data.school || ''), grade: String(data.grade || ''), level: String(data.level || ''), studentIds: [studentId] };
      });
      return {
        student, classes, classRecords, weeklyPlans, fridaySupp, weekendClasses,
        weekendSettings: weekendSettingsSnap.exists ? weekendSettingsSnap.data() : { enabled: false },
        stadSettings: stadSettingsSnap.exists ? stadSettingsSnap.data() : { enabled: false, infoText: '', applyOpen: '', applyClose: '', zoomLink: '' }
      };
    }),

    studentGrowthSurveyLogin: onCall({ region: REGION }, async request => {
      const code = String(request.data && request.data.code || '').trim();
      if (!/^\d{4}$/.test(code)) throw new HttpsError('invalid-argument', '학생 코드를 확인해주세요.');
      await takeLoginAttempt(fs, request);
      const studentId = await findStudentByCode(fs, code);
      if (!studentId) throw new HttpsError('unauthenticated', '학생 코드를 확인해주세요.');
      const token = await admin.auth().createCustomToken(studentId, { role: 'student', studentId });
      return { token };
    }),

    getGrowthSurvey: onCall({ region: REGION }, async request => {
      const auth = requireAuth(request);
      const month = requireMonth(request.data && request.data.month);
      const isStudent = auth.token.role === 'student' && validStudentId(auth.token.studentId) && auth.uid === auth.token.studentId;
      const isOwner = isStudent ? false : (() => { requireDirector(request); return true; })();
      const studentId = isStudent ? auth.token.studentId : String(request.data && request.data.studentId || '');
      if (!validStudentId(studentId)) throw new HttpsError('invalid-argument', '학생을 확인해주세요.');
      const snap = await fs.collection(COLLECTION).doc(docId(studentId, month)).get();
      if (!snap.exists) return { survey: null };
      const value = snap.data();
      return { survey: isStudent ? safeStudentView(value) : value, isOwner };
    }),

    listGrowthSurveyStudents: onCall({ region: REGION }, async request => {
      requireDirector(request);
      const cursor = String(request.data && request.data.cursor || '');
      let query = fs.collection('students').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) {
        if (!validStudentId(cursor)) throw new HttpsError('invalid-argument', '페이지 위치가 올바르지 않습니다.');
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      const rows = snap.docs.map(d => {
        const s = d.data();
        return { id: d.id, name: String(s.name || ''), grade: String(s.grade || ''), classId: String(s.classId || ''), status: String(s.status || 'active') };
      }).filter(s => s.status !== 'withdrawn');
      return { rows, nextCursor: snap.size === PAGE_SIZE ? snap.docs[snap.docs.length - 1].id : null, limit: PAGE_SIZE };
    }),

    prepareGrowthSurveyDraft: onCall({ region: REGION }, async request => {
      requireDirector(request);
      const month = requireMonth(request.data && request.data.month);
      const studentId = String(request.data && request.data.studentId || '');
      if (!validStudentId(studentId)) throw new HttpsError('invalid-argument', '학생을 확인해주세요.');
      const previous = previousMonth(month);
      const [currentSnap, previousSnap, reportSnap] = await Promise.all([
        fs.collection(COLLECTION).doc(docId(studentId, month)).get(),
        fs.collection(COLLECTION).doc(docId(studentId, previous)).get(),
        fs.collection('monthlyReports').doc(month + '_' + studentId).get()
      ]);
      const current = currentSnap.exists ? currentSnap.data() : null;
      const recommendation = core.recommendDraft(previousSnap.exists ? previousSnap.data() : null, reportSnap.exists ? reportSnap.data() : null, month);
      return { survey: current, recommendation };
    }),

    listGrowthSurveys: onCall({ region: REGION }, async request => {
      requireDirector(request);
      const month = requireMonth(request.data && request.data.month);
      const cursor = String(request.data && request.data.cursor || '');
      let query = fs.collection(COLLECTION).where('month', '==', month).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) {
        if (!validStudentId(cursor.split('_' + month)[0]) || !cursor.endsWith('_' + month)) {
          throw new HttpsError('invalid-argument', '페이지 위치가 올바르지 않습니다.');
        }
        query = query.startAfter(cursor);
      }
      const snap = await query.get();
      const rows = snap.docs.map(d => d.data());
      const last = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;
      return { rows, nextCursor: snap.size === PAGE_SIZE ? last : null, limit: PAGE_SIZE };
    }),

    submitGrowthSurvey: onCall({ region: REGION }, async request => {
      const { studentId } = requireStudent(request);
      const month = requireMonth(request.data && request.data.month);
      const today = kstDate();
      if (month !== monthFromDate(today) || Number(today.slice(8, 10)) < 20) {
        throw new HttpsError('failed-precondition', '이번 달 설문은 매월 20일부터 작성할 수 있습니다.');
      }
      const valid = core.validateStudentSubmission(request.data && request.data.student);
      if (!valid.ok) throw new HttpsError('invalid-argument', valid.error);
      const ref = fs.collection(COLLECTION).doc(docId(studentId, month));
      await fs.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const old = snap.exists ? snap.data() : {};
        if (old.status === 'published') throw new HttpsError('failed-precondition', '게시된 설문은 수정할 수 없습니다.');
        const prior = old.student || {};
        tx.set(ref, {
          studentId, month, status: old.status || 'open', templateVersion: 1,
          student: Object.assign({}, prior, valid.value, { submittedAt: new Date().toISOString() }),
          teacher: old.teacher || {}, evidenceRefs: old.evidenceRefs || [],
          createdAt: old.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
        }, { merge: true });
      });
      return { ok: true };
    }),

    saveGrowthSurveyTeacher: onCall({ region: REGION }, async request => {
      requireDirector(request);
      const month = requireMonth(request.data && request.data.month);
      const studentId = String(request.data && request.data.studentId || '');
      if (!validStudentId(studentId)) throw new HttpsError('invalid-argument', '학생을 확인해주세요.');
      const valid = core.validateTeacherFields(request.data && request.data.teacher);
      if (!valid.ok) throw new HttpsError('invalid-argument', valid.error);
      const publish = request.data.publish === true;
      const ref = fs.collection(COLLECTION).doc(docId(studentId, month));
      await fs.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const old = snap.exists ? snap.data() : {};
        if (publish && (!old.student || !old.student.submittedAt)) {
          throw new HttpsError('failed-precondition', '학생 응답을 받은 뒤 게시할 수 있습니다.');
        }
        const patch = {
          studentId, month, templateVersion: 1,
          teacher: valid.value,
          status: publish ? 'published' : (old.status === 'published' ? 'published' : 'open'),
          evidenceRefs: old.evidenceRefs || [],
          createdAt: old.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...(publish ? { publishedAt: new Date().toISOString() } : {})
        };
        if (snap.exists) tx.update(ref, patch);
        else tx.set(ref, Object.assign({ student: {} }, patch));
      });
      return { ok: true, published: publish };
    })
  };
}

module.exports = createGrowthSurveyHandlers;
