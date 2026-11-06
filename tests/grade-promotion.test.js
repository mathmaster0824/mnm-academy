/* 새 학년 진급 (가짜 Firestore). 실행: node tests/grade-promotion.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (n, ok, d) => { results.push(!!ok); console.log(`PROMO ${ok ? '✔' : '✖'} ${n}${ok ? '' : ' ← ' + (d || '')}`); };
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
      o.map = ['초1', '초6', '중2', '중3', '고1', '고3', '졸업', ''].map(promotedGrade).join(',');
      db.students = [
        { id: 'a', name: '가', grade: '중3', school: '남악중', status: 'active' },
        { id: 'b', name: '나', grade: '중1', school: '남악중', status: 'active' },
        { id: 'c', name: '다', grade: '고3', school: '남악고', status: 'active' },
        { id: 'd', name: '라', grade: '초6', school: '', status: 'active' },
        { id: 'e', name: '마', grade: '중2', school: '', status: 'withdrawn' },
        { id: 'f', name: '바', grade: '졸업', school: '', status: 'active' }];
      const store = {}; db.students.forEach(s => store[s.id] = s);
      fsUpdate = async (c, id, d) => { Object.assign(store[id], d); return true; };
      window.alert = () => {}; render = () => {};
      openPromotionDialog();
      o.rows = document.querySelectorAll('[data-promo-row]').length;
      o.disabledForm = document.querySelector('[data-promo-pick="f"]').disabled;
      // 나(중1) 제외
      document.querySelector('[data-promo-pick="b"]').checked = false;
      await applyPromotion();
      o.a = JSON.stringify([store.a.grade, store.a.school, store.a.schoolHistory.map(h => h.school + h.grade)]);
      o.b = store.b.grade + '|' + store.b.school;
      o.c = store.c.grade + '|' + store.c.school + '|' + store.c.schoolHistory[0].school;
      o.d = store.d.grade + '|' + (store.d.schoolHistory || []).length;
      o.e = store.e.grade; o.f = store.f.grade;
      // 같은 학년도 두 번 막기
      let al = ''; window.alert = m => { al = m; };
      openPromotionDialog(); await applyPromotion(); o.twice = /이미 했어요/.test(al) && store.a.grade === '고1';
      // 진급 후 학교 비어 있는 중·고 학생이 입력 카드에 뜸
      o.missing = renderStudentSchoolSetup().includes('data-school-row="a"');
      o.hist = schoolHistoryText(store.a);
      // 되돌리기
      let conf = null; openConfirm = (t, b, fn) => { conf = fn; };
      undoPromotion(); await conf();
      o.undoA = store.a.grade + '|' + store.a.school + '|' + store.a.schoolHistory.length + '|' + store.a.promoPrev;
      o.undoC = store.c.grade + '|' + store.c.school;
      return o;
    });
    check('학년 변환 규칙', r.map === '초2,중1,중3,고1,고2,졸업,,'.replace(',,', ',') || r.map === '초2,중1,중3,고1,고2,졸업,,', r.map);
    check('미리보기에 재원생만(퇴원 제외) 표시', r.rows === 5, r.rows);
    check('학년 형식이 아닌 학생은 선택 불가', r.disabledForm);
    check('중3→고1: 학교 비우고 이전 학교 보관', r.a === '["고1","",["남악중중3"]]', r.a);
    check('제외한 학생은 그대로', r.b === '중1|남악중', r.b);
    check('고3→졸업, 이전 학교 보관', r.c === '졸업|' + '|남악고', r.c);
    check('초6→중1, 학교 없으면 이력 없음', r.d === '중1|0', r.d);
    check('퇴원생·졸업생은 변경 안 됨', r.e === '중2' && r.f === '졸업');
    check('같은 학년도 중복 진급 막음', r.twice);
    check('새 학교 입력 카드에 자동으로 나타남 + 이력 표시', r.missing && r.hist === '남악중(중3)', r.hist);
    check('되돌리기로 학년·학교·이력 복구', r.undoA === '중3|남악중|0|null' && r.undoC === '고3|남악고', r.undoA + ' / ' + r.undoC);
    check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  } finally { await browser.close(); }
  process.exit(results.every(Boolean) ? 0 : 1);
})();
