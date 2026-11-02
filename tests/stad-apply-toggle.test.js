/* STAD 신청 열기/닫기 스위치 시험. Playwright + 메모리 Firestore 가짜(가짜 학생). 운영 접속 없음. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`STAD-APPLY ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);
  const setup = (today, mode, role) => page.evaluate(({ today, mode, role }) => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = role === 'student' ? { mode: 'student', studentId: 'stu_A' } : { mode: 'director' };
    window.todayISO = () => today;
    db.students = [{ id: 'stu_A', name: '가짜A', code: '1', classId: 'c', status: 'active', grade: '중1' }];
    db.stadSettings = { enabled: true, infoText: '안내', zoomLink: 'z', ...(mode ? { applyMode: mode } : {}) };
    window.__store.stadSettings = { main: JSON.parse(JSON.stringify(db.stadSettings)) };
    window.__store.stadApplications = {}; db.stadApplications = {};
    window.render = () => { document.getElementById('mainArea').innerHTML = role === 'student' ? renderStadPage() : renderStadAdmin(); };
    window.render();
  }, { today, mode, role });
  const applyBtn = () => page.locator('button[onclick^="confirmApplyForStad"]').count();
  const apps = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.stadApplications)));

  await setup('2026-11-02', '', 'student');
  check('자동 모드, 11/2: 신청 닫힘(신청 버튼 없음)', (await applyBtn()) === 0 && (await page.evaluate(() => isStadApplyOpen())) === false);
  await setup('2026-11-25', '', 'student');
  check('자동 모드, 11/25: 신청 열림(기존 동작 그대로)', (await applyBtn()) === 1);
  await setup('2026-11-02', 'open', 'student');
  check('수동 열기, 11/2: 신청 버튼 표시', (await applyBtn()) === 1);
  await page.evaluate(() => applyForStad('stu_A')); await page.waitForTimeout(150);
  const a = await apps();
  check('수동 열기: 학생 신청이 이번 달(11월) 참여 대기(pending)로 저장', Object.values(a).length === 1 && Object.values(a)[0].status === 'pending' && Object.values(a)[0].month === '2026-11', JSON.stringify(a));
  await setup('2026-11-25', '', 'student');
  await page.evaluate(() => applyForStad('stu_A')); await page.waitForTimeout(150);
  check('자동 기간(11/25) 신청은 기존대로 다음 달(12월) 참여', Object.values(await apps())[0]?.month === '2026-12');
  await setup('2026-11-25', 'closed', 'student');
  check('수동 닫기, 11/25(자동이면 열릴 날): 신청 버튼 없음', (await applyBtn()) === 0);
  dialogs.length = 0;
  await page.evaluate(() => applyForStad('stu_A')); await page.waitForTimeout(150);
  check('수동 닫기: 직접 호출해도 거절되고 저장 안 됨', Object.keys(await apps()).length === 0 && dialogs.some((d) => d.includes('신청 기간이 아니')));

  // 원장 버튼
  await setup('2026-11-02', '', 'director');
  check('원장 화면에 열기/닫기 버튼 표시', (await page.locator('[data-stad-mode="open"]').count()) === 1 && (await page.locator('[data-stad-mode="closed"]').count()) === 1);
  await page.locator('[data-stad-mode="open"]').click(); await page.waitForTimeout(200);
  let st = await page.evaluate(() => window.__store.stadSettings.main);
  check('열기 클릭: applyMode=open 저장, 안내문구·줌주소는 그대로', st.applyMode === 'open' && st.infoText === '안내' && st.zoomLink === 'z', JSON.stringify(st));
  check('열기 후 화면: 열기 버튼 잠김, 되돌리기 표시', (await page.locator('[data-stad-mode="open"]').isDisabled()) && (await page.locator('[data-stad-mode="auto"]').count()) === 1);
  await page.locator('[data-stad-mode="closed"]').click(); await page.waitForTimeout(200);
  st = await page.evaluate(() => window.__store.stadSettings.main);
  check('닫기 클릭: applyMode=closed', st.applyMode === 'closed');
  await page.locator('[data-stad-mode="auto"]').click(); await page.waitForTimeout(200);
  st = await page.evaluate(() => window.__store.stadSettings.main);
  check('자동으로 되돌리기: applyMode=auto', st.applyMode === 'auto');
  check('저장 실패 시 안내(fsSet 실패 흉내)', await page.evaluate(async () => { const o = window.fsSet; window.fsSet = async () => false; let msg = ''; const oa = window.alert; window.alert = (m) => { msg = m; }; await setStadApplyMode('open'); window.alert = oa; window.fsSet = o; return msg.includes('저장하지 못했'); }));
  check('저장 버튼(안내문구)이 스위치 상태를 지우지 않음', await page.evaluate(async () => { await fsSet('stadSettings', 'main', { applyMode: 'closed' }, true); document.getElementById('stadInfoText').value = '새'; await saveStadSettings(); return window.__store.stadSettings.main.applyMode === 'closed' && window.__store.stadSettings.main.infoText === '새'; }));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close();
  const f = results.filter((x) => !x).length;
  console.log(f ? `STAD-APPLY FAIL ${f}/${results.length}` : `STAD-APPLY OK ${results.length}/${results.length}`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
