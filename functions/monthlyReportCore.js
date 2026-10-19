/* MNM monthly report core v1
 * 월말 학습 리포트 초안 생성 로직. Firestore/DOM에 접근하지 않는 순수 함수 모음이다.
 * - 앱(index.html)과 Cloud Functions(functions/index.js)가 이 파일의 동일한 코드를 사용한다.
 *   index.html 안의 MONTHLY_CORE_START ~ MONTHLY_CORE_END 사이 내용은 이 파일과 항상 같아야 하며,
 *   `node scripts/check-monthly-core-sync.js` 로 확인한다.
 * - 기록에 실제로 있는 정보만 쓰고, 없으면 '기록 없음'으로 둔다. 내부 전용 메모(conceptMemo 등)는 입력으로 받지 않는다.
 */
var MR_VERSION = 1;
var MR_CUTOVER = '2026-09-07'; // 숙제 리스타트 기준일: 이전 날짜는 제출 집계에서 제외
var MR_NONE = '기록 없음';
var MR_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function mrPad(n) { return String(n).padStart(2, '0'); }
function mrMonthRange(ym) {
  var p = String(ym).split('-'), y = Number(p[0]), m = Number(p[1]);
  var ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: y + '-' + mrPad(m) + '-01', endEx: ny + '-' + mrPad(nm) + '-01', end: y + '-' + mrPad(m) + '-' + mrPad(last) };
}
// 'YYYY-MM-DD' 날짜가 속한 달의 직전 달 'YYYY-MM'
function mrPrevMonthOf(dateISO) {
  var y = Number(dateISO.slice(0, 4)), m = Number(dateISO.slice(5, 7));
  m -= 1; if (m === 0) { m = 12; y -= 1; }
  return y + '-' + mrPad(m);
}
function mrAddDays(dateISO, n) {
  var d = new Date(dateISO + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + '-' + mrPad(d.getUTCMonth() + 1) + '-' + mrPad(d.getUTCDate());
}
function mrWeekStart(dateISO) {
  var dow = new Date(dateISO + 'T00:00:00Z').getUTCDay();
  return mrAddDays(dateISO, dow === 0 ? -6 : 1 - dow);
}
// 월에 걸친 모든 주의 월요일 목록 (weeklyPlans 문서 ID: 반ID_주시작일)
function mrWeekStartsOfMonth(ym) {
  var r = mrMonthRange(ym), out = [], w = mrWeekStart(r.start);
  while (w < r.endEx) { out.push(w); w = mrAddDays(w, 7); }
  return out;
}
function mrHash(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(16);
}
function mrMd(dateISO) { return Number(dateISO.slice(5, 7)) + '/' + Number(dateISO.slice(8, 10)); }
function mrHasText(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }

// 제출 문서 상태 분류: submitted(제출 완료·인정·레거시) / pending(과거 방식 검토대기) / rejected(불합격·재제출 필요)
function mrSubmissionKind(sub) {
  var st = String((sub && sub.status) || '').trim();
  if (st === '' || st === '확인' || st === 'approved' || st === '제출완료') return 'submitted';
  if (st === '불합격' || st === '최종불합격' || st === 'rejected') return 'rejected';
  return 'pending';
}

/* input:
 *  month 'YYYY-MM', today 'YYYY-MM-DD'
 *  student {id,name,grade}
 *  classes [{id,name}]            이 달에 기록이 있거나 현재 소속인 반
 *  records [{clsId,date,rec}]     classRecords[반_날짜][학생ID]
 *  plans   [{clsId,weekStart,plan}] weeklyPlans[반_주시작일] 문서 데이터
 *  submissions [{date,classId,sub}] 해당 학생의 이 달 제출 문서 (classId는 문서의 classId, 없으면 '')
 *  kmm [{date,score,range}]
 *  stepLabelOf(stepId, rec) → 표시용 STEP 이름 (없으면 스냅샷 사용)
 */
function mrBuildMonthlyReport(input) {
  var range = mrMonthRange(input.month);
  var today = input.today || range.end;
  var stepLabelOf = input.stepLabelOf || function (id, rec) { return (rec && rec.stepLabelSnapshot) || ''; };
  var classes = input.classes || [];
  var clsName = {}; classes.forEach(function (c) { clsName[c.id] = c.name; });
  var records = (input.records || []).filter(function (r) { return r.date >= range.start && r.date < range.endEx; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.clsId < b.clsId ? -1 : 1); });

  // 1) 출결
  var att = { lessons: records.length, present: 0, late: 0, absent: 0, other: 0, abnormal: [] };
  records.forEach(function (r) {
    var a = (r.rec && r.rec.attendance) || '';
    if (a === '출석') att.present++; else if (a === '지각') { att.late++; att.abnormal.push(mrMd(r.date) + ' 지각'); }
    else if (a === '결석') { att.absent++; att.abnormal.push(mrMd(r.date) + ' 결석'); } else att.other++;
  });

  // 2) 진도 + 수업 상세
  var progress = [];
  records.forEach(function (r) {
    var rec = r.rec || {};
    var step = rec.stepId ? (stepLabelOf(rec.stepId, rec) || rec.stepLabelSnapshot || '') : (rec.stepLabelSnapshot || '');
    var extras = (rec.extraSteps || []).map(function (id, i) { return stepLabelOf(id, rec) || (rec.extraStepLabelSnapshots || [])[i] || ''; }).filter(Boolean);
    var detail = mrHasText(rec.lessonDetail) ? String(rec.lessonDetail).replace(/\s*\n+\s*/g, ' ').trim() : '';
    if (!step && !extras.length && !detail) return;
    progress.push({ date: r.date, clsId: r.clsId, step: step, extras: extras, detail: detail });
  });

  // 3) 숙제 제출 이행: 주간계획에 숙제가 적힌 날(리스타트 기준일 이후, 오늘까지)을 기준으로 반별 집계
  var perClassHw = {};
  classes.forEach(function (c) { perClassHw[c.id] = { planned: 0, submitted: 0, pending: 0, rejected: 0, missing: 0, missingDates: [], hasPlan: false }; });
  var subsByDate = {};
  (input.submissions || []).forEach(function (s) { if (s.date >= range.start && s.date < range.endEx) { (subsByDate[s.date] = subsByDate[s.date] || []).push(s); } });
  (input.plans || []).forEach(function (pl) {
    var h = perClassHw[pl.clsId]; if (!h) return;
    var per = (pl.plan && pl.plan[input.student.id]) || {};
    h.hasPlan = true;
    for (var off = 0; off < 7; off++) {
      var date = mrAddDays(pl.weekStart, off);
      if (date < range.start || date >= range.endEx || date > today || date < MR_CUTOVER) continue;
      var cell = per[MR_DAY_KEYS[new Date(date + 'T00:00:00Z').getUTCDay()]];
      if (!mrHasText(cell)) continue;
      h.planned++;
      var cands = (subsByDate[date] || []).filter(function (s) { return !s.classId || s.classId === pl.clsId; });
      var best = cands.find(function (s) { return s.classId === pl.clsId; }) || cands[0];
      if (!best) { h.missing++; h.missingDates.push(date); continue; }
      var k = mrSubmissionKind(best.sub);
      if (k === 'submitted') h.submitted++; else if (k === 'pending') h.pending++; else h.rejected++;
    }
  });
  var hwTotals = { planned: 0, submitted: 0, pending: 0, rejected: 0, missing: 0 };
  Object.keys(perClassHw).forEach(function (id) { ['planned', 'submitted', 'pending', 'rejected', 'missing'].forEach(function (k) { hwTotals[k] += perClassHw[id][k]; }); });
  var hwHasPlan = Object.keys(perClassHw).some(function (id) { return perClassHw[id].hasPlan; });
  var submittedDays = {}; (input.submissions || []).forEach(function (s) { if (mrSubmissionKind(s.sub) === 'submitted') submittedDays[s.date] = true; });

  // 4) 숙제 완성도 (수업 중 기록한 값만, 미기록은 미평가)
  var comp = { '상': 0, '중': 0, '하': 0, unrated: 0, perClass: {} };
  classes.forEach(function (c) { comp.perClass[c.id] = { '상': 0, '중': 0, '하': 0, unrated: 0 }; });
  records.forEach(function (r) {
    var lv = r.rec && r.rec.homeworkCompletionLevel;
    var pc = comp.perClass[r.clsId] || (comp.perClass[r.clsId] = { '상': 0, '중': 0, '하': 0, unrated: 0 });
    if (lv === '상' || lv === '중' || lv === '하') { comp[lv]++; pc[lv]++; } else { comp.unrated++; pc.unrated++; }
  });

  // 5) 점수
  var tests = [];
  records.forEach(function (r) {
    var v = r.rec && r.rec.dailyTestScore;
    if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) tests.push({ date: r.date, score: Number(v) });
  });
  var kmm = (input.kmm || []).filter(function (k) { return k.date >= range.start && k.date < range.endEx && k.score !== undefined && k.score !== '' && !isNaN(Number(k.score)); })
    .map(function (k) { return { date: k.date, score: Number(k.score), range: k.range || '' }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var avg = tests.length ? Math.round(tests.reduce(function (a, b) { return a + b.score; }, 0) / tests.length) : null;

  // 6) 특이사항
  var notes = [];
  records.forEach(function (r) { if (r.rec && mrHasText(r.rec.note)) notes.push({ date: r.date, clsId: r.clsId, note: String(r.rec.note).replace(/\s*\n+\s*/g, ' ').trim() }); });

  // 7) 다음 달 방향 초안 (기록 기반 문장만. 원장 검토 전제)
  var dir = [];
  if (progress.length) {
    var last = progress[progress.length - 1];
    var lastTxt = last.step || last.detail;
    if (lastTxt) dir.push('이번 달 마지막 진도(' + lastTxt + ')에 이어 다음 단계를 진행할 예정입니다.');
  }
  if (tests.length >= 2 && tests[tests.length - 1].score < tests[0].score - 5) dir.push('일일테스트 점수가 월초보다 내려가 있어 취약 단원 점검과 복습을 병행하겠습니다.');
  else if (avg !== null && avg < 70) dir.push('일일테스트 평균이 ' + avg + '점으로, 기본 개념 정리와 반복 확인에 비중을 두겠습니다.');
  if (comp['하'] >= 2 || (comp['하'] >= 1 && comp['하'] >= comp['상'] + comp['중'])) dir.push('숙제 완성도 ‘하’가 반복되어, 분량 조절과 풀이·오답 정리 습관 점검을 함께 하겠습니다.');
  if (att.absent >= 2) dir.push('결석이 있었던 부분은 보강 여부를 확인하겠습니다.');
  if (hwHasPlan && hwTotals.missing >= 2) dir.push('숙제 미제출이 있었던 날이 있어 제출 습관을 함께 점검하겠습니다.');

  var multi = classes.length > 1;
  var perClass = classes.map(function (c) {
    var recs = records.filter(function (r) { return r.clsId === c.id; });
    var lastP = progress.filter(function (p) { return p.clsId === c.id; }).pop();
    return {
      clsId: c.id, name: c.name, lessons: recs.length,
      present: recs.filter(function (r) { return r.rec && r.rec.attendance === '출석'; }).length,
      lastProgress: lastP ? (lastP.step || lastP.detail || '') : '',
      homework: perClassHw[c.id], completeness: comp.perClass[c.id]
    };
  });

  var data = {
    version: MR_VERSION, month: input.month, studentId: input.student.id,
    attendance: att, progress: progress, homework: { totals: hwTotals, hasPlan: hwHasPlan, perClass: perClassHw, submittedDays: Object.keys(submittedDays).length },
    completeness: { '상': comp['상'], '중': comp['중'], '하': comp['하'], unrated: comp.unrated },
    scores: { dailyTests: tests, average: avg, kmm: kmm }, notes: notes, nextDirection: dir,
    perClass: multi ? perClass : []
  };
  return { data: data, text: mrRenderText(input.student, data, clsName, multi), sig: mrHash(JSON.stringify(data)) };
}

function mrRenderText(student, d, clsName, multi) {
  var m = Number(d.month.slice(5, 7));
  var L = [];
  L.push('[M&m 수학훈련소] ' + student.name + ' 학생 ' + m + '월 학습 리포트');
  L.push('');
  L.push('1. 출결·수업 참여');
  if (!d.attendance.lessons) L.push('· ' + MR_NONE);
  else {
    L.push('· 수업 ' + d.attendance.lessons + '회 (출석 ' + d.attendance.present + ' · 지각 ' + d.attendance.late + ' · 결석 ' + d.attendance.absent + ')');
    if (d.attendance.abnormal.length) L.push('· 지각·결석: ' + d.attendance.abnormal.join(', '));
  }
  L.push('');
  L.push('2. 진도와 수업 내용');
  if (!d.progress.length) L.push('· ' + MR_NONE);
  d.progress.forEach(function (p) {
    var head = (multi && clsName[p.clsId] ? '[' + clsName[p.clsId] + '] ' : '') + (p.step || '');
    if (p.extras.length) head += (head ? ' + ' : '') + p.extras.join(', ');
    L.push('· ' + mrMd(p.date) + ' ' + head + (p.detail ? (head ? ' — ' : '') + p.detail : ''));
  });
  L.push('');
  L.push('3. 숙제 제출 이행');
  if (d.homework.hasPlan) {
    var t = d.homework.totals;
    if (!t.planned) L.push('· ' + MR_NONE);
    else {
      L.push('· 숙제가 있었던 ' + t.planned + '일 중 제출 완료 ' + t.submitted + '일' + (t.pending ? ' · 확인 대기 ' + t.pending + '일' : '') + (t.rejected ? ' · 재제출 필요 ' + t.rejected + '일' : '') + (t.missing ? ' · 미제출 ' + t.missing + '일' : ''));
    }
  } else if (d.homework.submittedDays) {
    L.push('· 제출 완료 ' + d.homework.submittedDays + '일 (주간 숙제 계획 기록 없음)');
  } else L.push('· ' + MR_NONE);
  L.push('');
  L.push('4. 숙제 완성도 (수업 시간 확인)');
  var c = d.completeness, ratedN = c['상'] + c['중'] + c['하'];
  if (!ratedN && !c.unrated) L.push('· ' + MR_NONE);
  else L.push('· 상 ' + c['상'] + ' · 중 ' + c['중'] + ' · 하 ' + c['하'] + ' · 미평가 ' + c.unrated);
  L.push('');
  L.push('5. 점수');
  if (!d.scores.dailyTests.length && !d.scores.kmm.length) L.push('· ' + MR_NONE);
  if (d.scores.dailyTests.length) {
    var ts = d.scores.dailyTests, f = ts[0], l = ts[ts.length - 1];
    L.push('· 일일테스트 ' + ts.length + '회 평균 ' + d.scores.average + '점' + (ts.length > 1 ? ' (' + mrMd(f.date) + ' ' + f.score + '점 → ' + mrMd(l.date) + ' ' + l.score + '점)' : ''));
  }
  d.scores.kmm.forEach(function (k) { L.push('· KMM ' + mrMd(k.date) + ' ' + k.score + '점' + (k.range ? ' (' + k.range + ')' : '') + ' ' + (k.score >= 80 ? 'PASS' : 'FAIL')); });
  L.push('');
  L.push('6. 특이사항');
  if (!d.notes.length) L.push('· ' + MR_NONE);
  d.notes.forEach(function (n) { L.push('· ' + mrMd(n.date) + (multi && clsName[n.clsId] ? ' [' + clsName[n.clsId] + ']' : '') + ' ' + n.note); });
  if (multi && d.perClass.length) {
    L.push('');
    L.push('[반별 요약]');
    d.perClass.forEach(function (p) {
      var hw = p.homework || {}, cp = p.completeness || {};
      L.push('· ' + p.name + ': 수업 ' + p.lessons + '회' + (p.lastProgress ? ' · 최근 진도 ' + p.lastProgress : '') +
        (hw.planned ? ' · 숙제 제출 ' + hw.submitted + '/' + hw.planned + '일' : '') +
        ' · 완성도 상 ' + (cp['상'] || 0) + ' 중 ' + (cp['중'] || 0) + ' 하 ' + (cp['하'] || 0) + ' 미평가 ' + (cp.unrated || 0));
    });
  }
  L.push('');
  L.push('7. 다음 달 학습 방향');
  if (!d.nextDirection.length) L.push('· ' + MR_NONE);
  d.nextDirection.forEach(function (x) { L.push('· ' + x); });
  return L.join('\n');
}

/* 재생성 시 문서 갱신 규칙 (앱·함수 공통).
 * existing: 기존 monthlyReports 문서 데이터 또는 null, built: mrBuildMonthlyReport 결과, nowISO: 생성 시각
 * 반환: { action: 'create'|'skip'|'update'|'newer', doc } — doc은 저장할 전체 문서(create/update) 또는 변경 필드(newer)
 * 원칙: 원장 수정본(edited)은 절대 덮어쓰지 않는다. 수정본이 있으면 새 초안은 versions에만 쌓고 hasNewerDraft로 알린다. */
function mrApplyGenerated(existing, built, nowISO, studentName) {
  var entry = { version: 1, generatedAt: nowISO, sig: built.sig, text: built.text };
  if (!existing) {
    return { action: 'create', doc: { month: built.data.month, studentId: built.data.studentId, studentName: studentName || '', status: 'draft',
      generated: { version: 1, generatedAt: nowISO, sig: built.sig, text: built.text, data: built.data }, versions: [entry], edited: null, hasNewerDraft: false, createdAt: nowISO } };
  }
  var cur = existing.generated || {};
  if (cur.sig === built.sig) return { action: 'skip', doc: {} };
  var versions = (existing.versions || []).slice();
  var nextVersion = (versions.length ? Math.max.apply(null, versions.map(function (v) { return v.version || 0; })) : (cur.version || 0)) + 1;
  entry.version = nextVersion;
  versions.push(entry);
  if (versions.length > 8) versions = versions.slice(versions.length - 8);
  if ((existing.edited && mrHasText(existing.edited.text)) || existing.status === 'reviewed' || existing.status === 'edited') {
    // 수정본 보존: generated는 최신 자동 초안으로 갱신하되 edited는 그대로 두고 알림만 켠다.
    return { action: 'newer', doc: { generated: { version: nextVersion, generatedAt: nowISO, sig: built.sig, text: built.text, data: built.data }, versions: versions, hasNewerDraft: true, updatedAt: nowISO } };
  }
  return { action: 'update', doc: { generated: { version: nextVersion, generatedAt: nowISO, sig: built.sig, text: built.text, data: built.data }, versions: versions, hasNewerDraft: false, status: 'draft', updatedAt: nowISO } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MR_VERSION: MR_VERSION, mrMonthRange: mrMonthRange, mrPrevMonthOf: mrPrevMonthOf, mrWeekStartsOfMonth: mrWeekStartsOfMonth, mrBuildMonthlyReport: mrBuildMonthlyReport, mrApplyGenerated: mrApplyGenerated, mrSubmissionKind: mrSubmissionKind, mrAddDays: mrAddDays };
}
