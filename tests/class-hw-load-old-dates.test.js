/* 반 출석부: 7일 넘은 날짜의 숙제 확인 버튼(회색 …) → 눌러서 불러오기 → 수동 확인 가능 시험. Playwright + 메모리 Firestore 가짜(가짜 학생·기록). */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`CLS-HW-LOAD ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
const LESSON = '2026-10-26', TODAY = '2026-11-02';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);
  await page.evaluate(({ LESSON, TODAY }) => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => TODAY;
    db.students = [{ id: 'stu_A', name: '가짜A', code: '1', classId: 'cls_x', status: 'active', grade: '중1' }];
    db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: ['stu_A'] }];
    homeworkRecentLoadState = 'ready'; homeworkRecentStart = '2026-10-27'; homeworkKnownDates.clear(); homeworkKnownStudents.clear();
    db.submissions = {};
    // 서버에만 있는 10/22(목) 인증 기록 하나
    window.__store.submissions = { 'stu_A_2026-10-22': { studentId: 'stu_A', classId: 'cls_x', date: '2026-10-22', status: '확인', hwPhotos: [] } };
    window.render = () => { document.getElementById('mainArea').innerHTML = renderClassRow(db.classes[0], db.students[0], LESSON, {}, '', '', false); };
    window.render();
  }, { LESSON, TODAY });
  check('7일 넘은 날짜는 회색 "불러오기" 버튼으로 표시(전엔 누를 수 없는 회색 …)', (await page.locator('button.hw-load').count()) === 5 && (await page.locator('button.hw-verify').count()) === 0, String(await page.locator('button.hw-load').count()));
  await page.locator('button.hw-load[data-hwload="2026-10-22"]').click(); await page.waitForTimeout(300);
  check('눌러서 불러오면 그 날짜가 확인 가능 상태가 되고 서버 기록(인증)이 반영됨', (await page.locator('button.hw-verify[data-hwverify="2026-10-22"]').getAttribute('data-state')) === 'approved' && (await page.locator('button.hw-load').count()) === 4);
  await page.locator('button.hw-load[data-hwload="2026-10-23"]').click(); await page.waitForTimeout(300);
  check('기록이 없는 날은 불러온 뒤 미제출(빨강)로 확인 가능', (await page.locator('button.hw-verify[data-hwverify="2026-10-23"]').getAttribute('data-state')) === 'missing');
  await page.locator('button.hw-verify[data-hwverify="2026-10-23"]').click(); await page.waitForTimeout(400);
  const doc = await page.evaluate(() => JSON.parse(JSON.stringify(Object.entries(window.__store.submissions).filter(([k]) => k.includes('2026-10-23')))));
  check('불러온 날짜를 눌러 수동 인증하면 저장됨', doc.length === 1 && /확인|approved/.test(doc[0][1].status || ''), JSON.stringify(doc));
  check('이미 불러온 날짜를 다시 누를 일 없고(버튼 사라짐) 다른 날짜는 영향 없음', (await page.locator('button.hw-load[data-hwload="2026-10-21"]').count()) === 1);
  // 학생(원장 아님)에게는 불러오기 버튼 없음
  await page.evaluate(() => { session = { mode: 'student', studentId: 'stu_A' }; window.render(); });
  check('원장이 아니면 불러오기 버튼이 없다', (await page.locator('button.hw-load').count()) === 0);
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close();
  const f = results.filter((x) => !x).length;
  console.log(f ? `CLS-HW-LOAD FAIL ${f}/${results.length}` : `CLS-HW-LOAD OK ${results.length}/${results.length}`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
