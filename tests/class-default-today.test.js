/* 반 관리: 처음 열면 오늘 수업하는 반 중 가장 이른 반(월수=월수330, 화목=화목430)이 선택됨. Playwright + 메모리 Firestore 가짜. 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`CLASS-DEFAULT ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' };
    // 일부러 화목530이 맨 앞(등록 순서)
    db.classes = [{ id: 'c530t', name: '화목530', dayGroup: 'tue-thu', studentIds: [] }, { id: 'c610w', name: '월수610', dayGroup: 'mon-wed', studentIds: [] }, { id: 'c330w', name: '월수330', dayGroup: 'mon-wed', studentIds: [] }, { id: 'c430t', name: '화목430', dayGroup: 'tue-thu', studentIds: [] }, { id: 'c430w', name: '월수430', dayGroup: 'mon-wed', studentIds: [] }];
    db.students = [];
    window.sel = (d) => { window.academicTodayISO = () => d; window.todayISO = () => d; currentSubState = {}; renderClasses(); return currentSubState.classId; };
  });
  const sel = (d) => page.evaluate((x) => window.sel(x), d);
  check('월요일 → 월수330', (await sel('2026-11-09')) === 'c330w');
  check('화요일 → 화목430', (await sel('2026-11-10')) === 'c430t');
  check('수요일 → 월수330', (await sel('2026-11-11')) === 'c330w');
  check('목요일 → 화목430', (await sel('2026-11-12')) === 'c430t');
  check('금요일(수업 없음) → 맨 앞 반(월수330)', (await sel('2026-11-13')) === 'c330w');
  check('이미 반을 골라 둔 상태면 그대로 유지', await page.evaluate(() => { currentSubState = { classId: 'c610w' }; window.academicTodayISO = () => '2026-11-10'; renderClasses(); return currentSubState.classId === 'c610w'; }));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `CLASS-DEFAULT FAIL ${f}/${results.length}` : `CLASS-DEFAULT OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
