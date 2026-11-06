/* 학교별 시험 기간 달력 + 학생 학교 입력 + 학교별 성적표 (가짜 Firestore). 실행: node tests/school-exam-calendar.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (n, ok, d) => { results.push(!!ok); console.log(`SCHOOL-EXAM ${ok ? '✔' : '✖'} ${n}${ok ? '' : ' ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route(/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await page.route(/^https?:/, r => { if (r.request().url().includes('firebasejs')) return r.fallback(); r.abort(); });
    await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
    await page.waitForTimeout(600);
    const r = await page.evaluate(async () => {
      const o = {};
      db.students = [
        { id: 's1', name: '가나', grade: '중2', school: '남악중', status: 'active' },
        { id: 's2', name: '다라', grade: '중2', school: '', status: 'active' },
        { id: 's3', name: '마바', grade: '고1', school: '새학교고', status: 'active' },
        { id: 's4', name: '초등', grade: '초5', school: '', status: 'active' },
        { id: 's5', name: '퇴원', grade: '중3', school: '', status: 'withdrawn' }];
      db.schoolExams = [
        { id: 'e1', school: '남악중', grade: 2, examName: '2학기 기말', range: '1~3단원', date: '2026-11-10', endDate: '2026-11-12' },
        { id: 'e2', school: '새학교고', grade: 1, examName: '기말', range: '수학상', date: '2026-11-11' }];
      db.schoolScores = { 'e1_s1': { examId: 'e1', studentId: 's1', score: 88 } };
      currentSubState = { examCalendarMonth: '2026-11' };
      const html = renderSchoolExams();
      const box = document.createElement('div'); box.innerHTML = html;
      const chips = id => box.querySelectorAll(`[data-exam-chip="${id}"]`).length;
      o.e1Chips = chips('e1'); o.e2Chips = chips('e2');
      o.rangeShown = /범위: 1~3단원/.test(html) && /11\/10.*~.*11\/12/.test(html);
      o.schools = schoolExamSchools();
      o.missingCard = /비어 있는 중·고등부 학생 <b>1명/.test(html);
      o.setupRows = box.querySelectorAll('[data-school-row]').length;
      o.hasEndInput = !!box.querySelector('#examEndDate');
      o.optCount = /새학교고 \(1명\)/.test(html);
      // 시험 등록 (끝 날짜 포함)
      document.body.insertAdjacentHTML('beforeend', '<div id="x"><input id="examSchool" value="남악중"><input id="examGrade" value="2"><input id="examName" value="중간"><input id="examRange" value="r"><input id="examDate" value="2026-12-01"><input id="examEndDate" value="2026-11-30"></div>');
      let alerted = ''; window.alert = m => { alerted = m; };
      let added = null; fsAdd = async (c, d) => { added = { c, d }; return 'id'; };
      await addSchoolExam(); o.badEndBlocked = /빨라요/.test(alerted) && added === null;
      document.getElementById('examEndDate').value = '2026-12-03';
      await addSchoolExam(); o.added = added && added.d.endDate === '2026-12-03' && added.d.date === '2026-12-01';
      // 날짜 수정
      let upd = null; fsUpdate = async (c, id, d) => { upd = { c, id, d }; return true; };
      document.body.insertAdjacentHTML('beforeend', '<input id="examDateEdit_e2" value="2026-11-20"><input id="examEndEdit_e2" value="2026-11-22">');
      await saveExamDates('e2', null);
      o.upd = upd && upd.id === 'e2' && upd.d.date === '2026-11-20' && upd.d.endDate === '2026-11-22';
      // 성적표에 학생 노출
      currentSubState.examSchool = '남악중'; currentSubState.examGrade = 2;
      const h2 = renderSchoolExams(); o.scoreRow = /가나/.test(h2) && /value="88"/.test(h2);
      // 달 바뀌어도 기간 이어짐: 12월 달력에 11월 시작 시험 영향 없음 / 11월 말~12월 초 걸치는 시험
      db.schoolExams.push({ id: 'e3', school: '남악중', grade: 1, examName: '걸침', date: '2026-11-29', endDate: '2026-12-02' });
      currentSubState.examCalendarMonth = '2026-12';
      const b2 = document.createElement('div'); b2.innerHTML = renderSchoolExamCalendar();
      o.dec = b2.querySelectorAll('[data-exam-chip="e3"]').length;
      return o;
    });
    check('3일 시험이 3일 동안 달력에 표시', r.e1Chips === 3, r.e1Chips);
    check('하루 시험은 1칸', r.e2Chips === 1, r.e2Chips);
    check('시험 범위·기간 표시', r.rangeShown);
    check('학교 목록에 학생 학교 자동 포함', r.schools.includes('새학교고') && r.schools.includes('남악중'), r.schools);
    check('학교 비어 있는 중·고등부만 집계(초등·퇴원 제외)', r.missingCard && r.setupRows === 1, r.setupRows);
    check('끝나는 날 입력칸·학교별 인원수 표시', r.hasEndInput && r.optCount);
    check('끝 날짜가 시작보다 빠르면 막음', r.badEndBlocked);
    check('시험 등록에 끝 날짜 저장', r.added);
    check('시험 날짜 수정 저장', r.upd);
    check('학교별 성적표에 학생·점수 표시', r.scoreRow);
    check('월 경계를 넘는 시험이 다음 달에도 표시', r.dec === 2, r.dec);
    check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  } finally { await browser.close(); }
  process.exit(results.every(Boolean) ? 0 : 1);
})();
