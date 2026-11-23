/* 대시보드 질문 대기 개수 = 질문 게시판 개수 (분리된 원래 질문 제외). 실행: node tests/dash-question-count.test.js */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(!!ok); console.log(`DASH-Q ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, r => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; db.students = [{ id: 's1', name: '학생', status: 'active', grade: '중2' }];
    const mk = (id, extra) => ({ id, studentId: 's1', date: '2026-11-20', text: 'q', status: '대기', photos: [], ...extra });
    db.questions = [mk('p1', { splitQuestionIds: ['p1_item_2', 'p1_item_3'] }), mk('p2', { splitQuestionIds: ['p2_item_1', 'p2_item_2'] }), mk('c1', { status: '답변완료' }), mk('n1', {})];
    currentSubState = {};
    const box = document.createElement('div'); box.innerHTML = renderDashboard();
    const dash = Number(box.querySelector('[data-dash-qtodo]').textContent);
    const board = document.createElement('div'); board.innerHTML = renderQnaDirector();
    const tab = board.querySelector('[data-qna-tab="todo"]').textContent;
    db.questions = [mk('p1', { splitQuestionIds: ['a'] }), mk('p2', { splitQuestionIds: ['b'] })];
    const box2 = document.createElement('div'); box2.innerHTML = renderDashboard();
    return { dash, tab, zero: Number(box2.querySelector('[data-dash-qtodo]').textContent) };
  });
  check('분리된 원래 질문은 대시보드 개수에서 제외(대기 1건만)', r.dash === 1, r.dash);
  check('게시판 탭 개수와 같음', /\(1\)/.test(r.tab), r.tab);
  check('분리된 원래 질문만 남으면 0건', r.zero === 0, r.zero);
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length;
  console.log(f ? `DASH-Q FAIL ${f}/${results.length}` : `DASH-Q OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
