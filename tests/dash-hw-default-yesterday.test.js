/* 대시보드 숙제 미확인 카드: 기본이 어제, 그저께/오늘 전환. Playwright + 메모리 Firestore 가짜(가짜 학생·기록). 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`DASH-HW ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => '2026-11-11'; window.academicTodayISO = () => '2026-11-11';   // 수요일
    homeworkRecentLoadState = 'ready'; homeworkRecentStart = '2026-11-01';
    db.students = [{ id: 'stu_A', name: '가짜어제', code: '1', classId: 'cls_x', status: 'active', grade: '중1' }, { id: 'stu_B', name: '가짜그저께', code: '2', classId: 'cls_x', status: 'active', grade: '중1' }];
    db.classes = [{ id: 'cls_x', name: '월수반', dayGroup: 'mon-wed', studentIds: ['stu_A', 'stu_B'] }];
    const wk = weekStartISO('2026-11-11');
    // 둘 다 월·화·수 숙제 계획. A는 11/9(그저께)만 제출, B는 11/10(어제)만 제출
    db.weeklyPlans['cls_x_' + wk] = { stu_A: { mon: '월', tue: '화', wed: '수' }, stu_B: { mon: '월', tue: '화', wed: '수' } };
    db.submissions = { 'stu_A_2026-11-09': { studentId: 'stu_A', classId: 'cls_x', date: '2026-11-09', status: '확인' }, 'stu_B_2026-11-10': { studentId: 'stu_B', classId: 'cls_x', date: '2026-11-10', status: '확인' } };
    dashHwHidden['2026-11-09'] = []; dashHwHidden['2026-11-10'] = []; dashHwHidden['2026-11-11'] = [];
    currentSubState = {};
    window.render = () => { document.getElementById('mainArea').innerHTML = renderDashboard(); };
    window.render();
  });
  const card = async () => (await page.locator('h3', { hasText: '숙제 미확인' }).locator('xpath=ancestor::div[contains(@class,"card")][1]').innerText());
  let t = await card();
  check('처음 열면 "어제"(11/10) 기준: 어제 미제출 = 가짜어제 1명', t.includes('11/10') && t.includes('가짜어제') && !t.includes('가짜그저께'), t);
  check('버튼 3개(그저께·어제·오늘), 어제가 선택된 상태', (await page.locator('[data-dash-hwday]').count()) === 3 && (await page.locator('[data-dash-hwday="yesterday"]').getAttribute('class')).split(' ').includes('outline') === false && (await page.locator('[data-dash-hwday="today"]').getAttribute('class')).includes('outline'));
  await page.locator('[data-dash-hwday="before"]').click(); t = await card();
  check('"그저께"(11/9): 가짜그저께만 미제출', t.includes('11/9') && t.includes('가짜그저께') && !t.includes('가짜어제'), t);
  await page.locator('[data-dash-hwday="today"]').click(); t = await card();
  check('"오늘"(11/11): 오늘 숙제는 둘 다 미제출 + 공지 문구에 "오늘"', t.includes('가짜어제') && t.includes('가짜그저께') && t.includes('오늘'), t);
  await page.locator('[data-dash-hwday="yesterday"]').click(); t = await card();
  check('다시 "어제"로 돌아옴 + 공지 문구에 "오늘" 단어 없음', t.includes('가짜어제') && !t.includes('오늘 숙제') && (await page.locator('button[data-text]').first().getAttribute('data-text')).length > 0 && !decodeURIComponent(await page.locator('button[data-text]').first().getAttribute('data-text')).includes('오늘'));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `DASH-HW FAIL ${f}/${results.length}` : `DASH-HW OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
