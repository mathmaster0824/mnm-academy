/* 복수 반 학생: 숙제 현황 표가 같은 날짜의 두 반 숙제를 반마다 따로 보여주는지. Playwright + 메모리 Firestore 가짜(가짜 학생·반). 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`MULTI-HW ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => '2026-10-16'; window.academicTodayISO = () => '2026-10-16';
    homeworkRecentLoadState = 'ready'; homeworkRecentStart = '2026-10-01';
    db.students = [{ id: 'stu_M', name: '가짜복수', code: '7', classId: 'cls_x', status: 'active', grade: '중1' }, { id: 'stu_S', name: '가짜단일', code: '8', classId: 'cls_x', status: 'active', grade: '중1' }];
    db.classes = [{ id: 'cls_x', name: '월수반', dayGroup: 'mon-wed', studentIds: ['stu_M', 'stu_S'] }, { id: 'cls_y', name: '화목반', dayGroup: 'tue-thu', studentIds: ['stu_M'] }];
    db.weeklyPlans = { 'cls_x_2026-10-12': { stu_M: { tue: '월수반 쎈 3단원' }, stu_S: { tue: '단일 숙제' } }, 'cls_y_2026-10-12': { stu_M: { tue: '화목반 개념원리 5쪽' } } };
    db.classRecords = { 'cls_y_2026-10-15': { stu_M: { attendance: '출석' } }, 'cls_x_2026-10-14': { stu_M: { attendance: '출석' }, stu_S: { attendance: '출석' } } };
    // 10/13(화): 월수반(대표 반)은 인증됨, 화목반(보조 반)은 제출 없음
    db.submissions = { 'stu_M_2026-10-13': { studentId: 'stu_M', classId: 'cls_x', date: '2026-10-13', status: '확인', hwPhotos: [] }, 'stu_S_2026-10-13': { studentId: 'stu_S', classId: 'cls_x', date: '2026-10-13', status: '확인', hwPhotos: [] } };
    window.__store.submissions = JSON.parse(JSON.stringify(db.submissions));
    window.render = () => { document.getElementById('mainArea').innerHTML = renderHomeworkGlanceForWarning(window.__who || 'stu_M'); };
    window.render();
  });
  const rowText = () => page.locator('tr[data-hwmulti="2026-10-13"]').innerText();
  check('두 반이 있는 날(10/13)은 반별로 나눈 행으로 표시', (await page.locator('tr[data-hwmulti="2026-10-13"]').count()) === 1);
  const t = await rowText();
  check('월수반·화목반 이름과 각 반의 숙제 내용이 함께 보임', t.includes('월수반') && t.includes('화목반') && t.includes('쎈 3단원') && t.includes('개념원리 5쪽'), t);
  const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('tr[data-hwmulti="2026-10-13"] [data-hwverify-cls]')].map((b) => [b.getAttribute('data-hwverify-cls'), b.getAttribute('data-state')])));
  check('월수반은 인정(approved), 화목반은 미제출(missing)로 따로 표시', states.cls_x === 'approved' && states.cls_y === 'missing', JSON.stringify(states));
  // 화목반만 눌러 인증 → 화목반 기록만 생기고 월수반 기록은 그대로
  await page.locator('tr[data-hwmulti="2026-10-13"] [data-hwverify-cls="cls_y"]').click(); await page.waitForTimeout(500);
  const keys = await page.evaluate(() => Object.keys(window.__store.submissions).filter((k) => k.startsWith('stu_M')).sort());
  check('화목반 버튼은 화목반 기록(stu_M_cls_y_날짜)만 만들고 월수반 기록은 그대로', keys.includes('stu_M_cls_y_2026-10-13') && keys.includes('stu_M_2026-10-13') && keys.length === 2, JSON.stringify(keys));
  const after = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('tr[data-hwmulti="2026-10-13"] [data-hwverify-cls]')].map((b) => [b.getAttribute('data-hwverify-cls'), b.getAttribute('data-state')])));
  check('눌린 뒤 화목반도 인정으로 바뀌고 월수반은 그대로', after.cls_y === 'approved' && after.cls_x === 'approved', JSON.stringify(after));
  // 단일 반 학생은 예전과 같은 한 줄
  await page.evaluate(() => { window.__who = 'stu_S'; window.render(); });
  check('반이 하나인 학생은 반별 행 없이 기존 표시 그대로', (await page.locator('tr[data-hwmulti]').count()) === 0 && (await page.locator('[data-hwverify-detail="2026-10-13"]').count()) === 1);
  // 연속 미이행 경고 계산은 그대로(대표 상태 기준)
  check('연속 미이행 계산 함수는 그대로 동작', await page.evaluate(() => typeof currentMissedStreakForStudent('stu_M') === 'number'));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `MULTI-HW FAIL ${f}/${results.length}` : `MULTI-HW OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
