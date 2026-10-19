/* M&m 수학훈련소 — 월말 리포트 예약 생성 (Cloud Functions 2세대)
 *
 * 상태: 준비된 코드일 뿐 배포되지 않았다. 배포 절차와 비용 확인 사항은 docs/MONTHLY_REPORT_DEPLOY.md 참고.
 * 동작: 매월 1일 00:10 (Asia/Seoul) 에 직전 달 재원생별 초안을 monthlyReports/{YYYY-MM}_{학생ID} 에 만든다.
 *  - 자동 발송 없음. 앱의 '월말 리포트' 화면에서 원장이 검토·수정·복사한다.
 *  - 멱등: 문서 ID가 월·학생으로 고정이고 트랜잭션으로 쓰므로 중복 실행돼도 문서는 1개이며, 같은 자료면 변경하지 않는다.
 *  - 원장 수정본(edited)은 절대 덮어쓰지 않는다. 지연 기록으로 자료가 바뀌면 새 초안을 versions에 쌓고 hasNewerDraft 로 알린다.
 *  - 읽기만 하는 컬렉션: students, classes, courses, classRecords, weeklyPlans, submissions, kmm. 이 코드는 그 문서를 수정/삭제하지 않는다.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const core = require('./monthlyReportCore.js');

admin.initializeApp();
const fs = admin.firestore();

function todayKST() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // YYYY-MM-DD
}

function makeStepLabeler(courses) {
  const map = {};
  courses.forEach(c => (c.steps || []).forEach(st => {
    const parts = String(st.name || '').split('>');
    let tail = (parts.length > 1 ? parts[parts.length - 1] : st.name || '').trim();
    tail = tail.replace(/^STEP\s*\d+\s*/i, '').trim();
    map[st.id] = '[' + c.name + '] ' + (tail || st.name);
  }));
  return (id, rec) => (id === '__etc__' ? '기타·직접입력' : map[id]) || (rec && rec.stepLabelSnapshot) || '';
}

async function loadMonthData(ym, classes) {
  const r = core.mrMonthRange(ym);
  const weeks = core.mrWeekStartsOfMonth(ym);
  const FieldPath = admin.firestore.FieldPath;
  const recs = {}, plans = [];
  for (const c of classes) {
    const snap = await fs.collection('classRecords').where(FieldPath.documentId(), '>=', c.id + '_' + r.start).where(FieldPath.documentId(), '<', c.id + '_' + r.endEx).get();
    recs[c.id] = snap.docs.map(d => ({ date: d.id.slice(-10), data: d.data() }));
    for (const w of weeks) {
      const doc = await fs.collection('weeklyPlans').doc(c.id + '_' + w).get();
      if (doc.exists) plans.push({ clsId: c.id, weekStart: w, plan: doc.data() });
    }
  }
  const subSnap = await fs.collection('submissions').where('date', '>=', r.start).where('date', '<', r.endEx).get();
  const subs = subSnap.docs.map(d => Object.assign({ key: d.id, date: d.data().date || d.id.slice(-10) }, d.data()));
  const kmmSnap = await fs.collection('kmm').where('date', '>=', r.start).where('date', '<', r.endEx).get();
  const kmm = kmmSnap.docs.map(d => d.data());
  return { recs, plans, subs, kmm };
}

// 앱(index.html)의 classesForStudent 와 같은 규칙: classes.studentIds 우선, 없으면 레거시 students.classId
function classesOf(student, classes) {
  const list = classes.filter(c => (c.studentIds || []).includes(student.id));
  if (!list.length && student.classId) { const c = classes.find(x => x.id === student.classId); if (c) list.push(c); }
  if (student.classId) { const i = list.findIndex(c => c.id === student.classId); if (i > 0) list.unshift(list.splice(i, 1)[0]); }
  return list;
}

async function generateForMonth(ym) {
  const [stuSnap, clsSnap, courseSnap] = await Promise.all([fs.collection('students').get(), fs.collection('classes').get(), fs.collection('courses').get()]);
  const students = stuSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(s => s.status !== 'withdrawn');
  const classes = clsSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const stepLabelOf = makeStepLabeler(courseSnap.docs.map(d => Object.assign({ id: d.id }, d.data())));
  const raw = await loadMonthData(ym, classes);
  const today = todayKST();
  const count = { create: 0, update: 0, newer: 0, skip: 0 };
  for (const s of students) {
    const classIds = new Set(classesOf(s, classes).map(c => c.id));
    const records = [];
    Object.keys(raw.recs).forEach(cid => raw.recs[cid].forEach(x => { if (x.data && x.data[s.id]) { classIds.add(cid); records.push({ clsId: cid, date: x.date, rec: x.data[s.id] }); } }));
    const cls = [...classIds].map(id => classes.find(c => c.id === id)).filter(Boolean).map(c => ({ id: c.id, name: c.name }));
    const submissions = raw.subs.filter(x => (x.studentId || '') === s.id || (!x.studentId && x.key.startsWith(s.id + '_'))).map(x => ({ date: x.date, classId: x.classId || '', sub: x }));
    const built = core.mrBuildMonthlyReport({
      month: ym, today, student: { id: s.id, name: s.name, grade: s.grade }, classes: cls, records,
      plans: raw.plans.filter(p => classIds.has(p.clsId)), submissions,
      kmm: raw.kmm.filter(k => k.studentId === s.id).map(k => ({ date: k.date, score: k.score, range: k.range || '' })), stepLabelOf
    });
    const ref = fs.collection('monthlyReports').doc(ym + '_' + s.id);
    const action = await fs.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const res = core.mrApplyGenerated(snap.exists ? snap.data() : null, built, new Date().toISOString(), s.name);
      if (res.action === 'create') tx.set(ref, res.doc);
      else if (res.action === 'update' || res.action === 'newer') tx.update(ref, res.doc);
      return res.action;
    });
    count[action] = (count[action] || 0) + 1;
  }
  logger.info('monthly report generated', { month: ym, students: students.length, count });
  return count;
}

// 매월 1일 00:10 (한국시간) → 직전 달 초안 생성
exports.generateMonthlyReports = onSchedule(
  { schedule: '10 0 1 * *', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 540, memory: '512MiB', retryCount: 1 },
  async () => { await generateForMonth(core.mrPrevMonthOf(todayKST())); }
);
