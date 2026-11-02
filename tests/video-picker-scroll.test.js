/* 영상 숙제 고르기: 체크해도 목록 스크롤이 맨 위로 돌아가지 않고, 선택·개수·추가가 정상인지. Playwright + 메모리 Firestore 가짜. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`VID-PICK ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => '2026-11-02';
    db.students = [{ id: 'stu_A', name: '가짜A', code: '1', classId: 'cls_x', status: 'active', grade: '중1' }];
    db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: ['stu_A'] }];
    db.courses = [{ id: 'crs1', name: '중1-1', order: 1 }];
    db.videos = Array.from({ length: 12 }, (_, i) => ({ id: 'v' + i, title: '영상' + (i + 1), url: 'https://v/' + i, courseId: 'crs1', videoType: '개념', unit: 'U1', order: i }));
    window.__store.classRecords = {}; db.classRecords = {};
    currentSubState._vidAssignDraft = { 'cls_x_2026-11-02_stu_A': { type: '개념', courseId: 'crs1', book: '', unit: 'U1', checked: {} } };
    window.render = () => { document.getElementById('mainArea').innerHTML = '<div id="host">' + renderVideoAssignPicker('cls_x', '2026-11-02', 'stu_A') + '</div>'; };
    window.render();
  });
  const list = page.locator('#host div[style*="max-height:110px"]');
  check('영상 12개 목록이 스크롤 영역에 표시', (await page.locator('#host input[type=checkbox]').count()) === 12);
  await list.evaluate((e) => { e.scrollTop = 120; });
  const before = await list.evaluate((e) => e.scrollTop);
  await page.locator('#host input[type=checkbox]').nth(8).check();
  const after = await list.evaluate((e) => e.scrollTop);
  check('아래쪽 영상을 체크해도 스크롤 위치가 그대로(맨 위로 안 올라감)', before > 0 && after === before, `${before}->${after}`);
  await page.locator('#host input[type=checkbox]').nth(9).check();
  { const st = await list.evaluate((e) => e.scrollTop), tx = await page.locator('.vid-add-btn').innerText(); check('연달아 체크해도 목록이 맨 위로 안 돌아가고 버튼에 개수 표시', st > 0 && tx.includes('2개'), st + ' / ' + tx); }
  await page.locator('#host input[type=checkbox]').nth(9).uncheck();
  check('체크 해제하면 개수 1개로', (await page.locator('.vid-add-btn').innerText()).includes('1개'));
  await page.evaluate(() => { render(); });
  check('다시 그려도 선택 상태(8번째) 유지', await page.locator('#host input[type=checkbox]').nth(8).isChecked());
  await page.locator('.vid-add-btn').click(); await page.waitForTimeout(300);
  const arr = await page.evaluate(() => (window.__store.classRecords['cls_x_2026-11-02'] || {}).stu_A?.videoAssignments || []);
  check('추가 버튼: 체크한 영상 1개만 과제로 저장', arr.length === 1 && arr[0].title === '영상9' && arr[0].done === false, JSON.stringify(arr));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `VID-PICK FAIL ${f}/${results.length}` : `VID-PICK OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
