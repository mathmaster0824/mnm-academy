/* 대시보드 숙제 확인 카드: 수업 기준 묶음(월수=월·화/수~일), 수업 없는 날은 어제 기본, 그저께/어제/오늘 전환. Playwright + 메모리 Firestore 가짜(가짜 학생·기록). 운영 접속 없음. */
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
    session = { mode: 'director' }; window.__today = '2026-11-11'; window.todayISO = () => window.__today; window.academicTodayISO = () => window.__today;   // 수요일
    homeworkRecentLoadState = 'ready'; homeworkRecentStart = '2026-11-01';
    const st = (id, n) => ({ id, name: n, code: id, classId: 'cls_x', status: 'active', grade: '중1' });
    db.students = [st('stu_A', '가짜A'), st('stu_B', '가짜B'), st('stu_C', '가짜C'), st('stu_D', '가짜D'), { ...st('stu_F', '가짜F'), classId: 'cls_y' }];
    db.classes = [{ id: 'cls_x', name: '월수5:30', dayGroup: 'mon-wed', studentIds: ['stu_A', 'stu_B', 'stu_C', 'stu_D'] }, { id: 'cls_y', name: '월수6:10', dayGroup: 'mon-wed', studentIds: ['stu_F'] }, { id: 'cls_z', name: '화목4:30', dayGroup: 'tue-thu', studentIds: [] }];
    const all = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
    const wkA = weekStartISO('2026-11-11'), wkB = weekStartISO('2026-11-16');
    db.weeklyPlans['cls_x_' + wkA] = { stu_A: all, stu_B: all, stu_C: all, stu_D: all }; db.weeklyPlans['cls_y_' + wkA] = { stu_F: all };
    db.weeklyPlans['cls_x_' + wkB] = { stu_A: { wed: '수', fri: '금', sun: '일' } }; db.weeklyPlans['cls_y_' + wkB] = {};
    const S = (id, d, status, cls) => ({ studentId: id, ...(cls ? { classId: cls } : { classId: 'cls_x' }), date: d, status });
    db.submissions = {
      // 11/9(월)·11/10(화) 숙제: A는 월 인정·화 없음, B는 월 없음·화 인정, C 둘 다 인정, D 월 인정·화 검토대기, F 둘 다 인정
      'stu_A_2026-11-09': S('stu_A', '2026-11-09', '확인'), 'stu_B_2026-11-10': S('stu_B', '2026-11-10', '확인'),
      'stu_C_2026-11-09': S('stu_C', '2026-11-09', '확인'), 'stu_C_2026-11-10': S('stu_C', '2026-11-10', '확인'),
      'stu_D_2026-11-09': S('stu_D', '2026-11-09', '확인'), 'stu_D_2026-11-10': S('stu_D', '2026-11-10', '대기'),
      'stu_F_2026-11-09': S('stu_F', '2026-11-09', '확인', 'cls_y'), 'stu_F_2026-11-10': S('stu_F', '2026-11-10', '확인', 'cls_y'),
      // 다음 주(11/16 월요일 확인용): A는 수(11/11)만 제출, 금·일 없음
      'stu_A_2026-11-11': S('stu_A', '2026-11-11', '확인'),
    };
    ['class_2026-11-11', 'class_2026-11-16', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16'].forEach((k) => { dashHwHidden[k] = []; });
    currentSubState = {};
    window.render = () => { document.getElementById('mainArea').innerHTML = renderDashboard(); };
    window.render();
  });
  const card = async () => (await page.locator('[data-dash-hwcard], h3:has-text("숙제 미확인")').first().locator('xpath=ancestor-or-self::div[contains(@class,"card")][1]').innerText());
  let t = await card();
  check('수업 있는 날(수)은 기본이 "수업 기준": 월수 두 반 + 월·화 숙제, 화목반은 안 나옴', (await page.locator('[data-dash-hwcard="class"]').count()) === 1 && (await page.locator('[data-dash-class-block]').count()) === 2 && t.includes('월수5:30') && t.includes('월·화 숙제') && !t.includes('화목4:30'), t);
  check('미확인 명단: A(화 ×), B(월 ×), D(화 △) 표시, 모두 인정인 C는 목록에 없음', (await page.locator('[data-dash-class-row="stu_A"]').innerText()).includes('화 ×') && (await page.locator('[data-dash-class-row="stu_A"]').innerText()).includes('월 ○') && (await page.locator('[data-dash-class-row="stu_B"]').innerText()).includes('월 ×') && (await page.locator('[data-dash-class-row="stu_D"]').innerText()).includes('화 △') && (await page.locator('[data-dash-class-row="stu_C"]').count()) === 0);
  check('제목 미확인 2명(A·B; 검토대기 D는 미확인에 안 셈), 두 번째 반은 "모두 확인됨"', t.includes('2명') && (await page.locator('[data-dash-class-block="cls_y"]').innerText()).includes('모두 확인됨'), t);
  const notice = decodeURIComponent(await page.locator('button[data-text]').first().getAttribute('data-text'));
  check('공지 문구: 반별로 미제출 학생과 요일(A 화, B 월), 검토대기 D는 제외', notice.includes('[월수5:30 · 월·화]') && notice.includes('가짜A (화)') && notice.includes('가짜B (월)') && !notice.includes('가짜D') && !notice.includes('가짜C'), notice);
  await page.locator('[data-dash-class-row="stu_B"] button').click(); await page.waitForTimeout(300);
  check('✕로 B를 공지 명단에서 빼면 되돌리기 링크가 나오고 공지에서 빠짐', (await page.locator('[data-dash-class-row="stu_B"]').count()) === 0 && (await card()).includes('되돌리기') && !decodeURIComponent(await page.locator('button[data-text]').first().getAttribute('data-text')).includes('가짜B'));
  await page.evaluate(() => { dashHwHidden['class_2026-11-11'] = []; window.render(); });
  // 버튼 4개, 다른 보기
  check('버튼 4개(수업 기준·그저께·어제·오늘)', (await page.locator('[data-dash-hwday]').count()) === 4);
  await page.locator('[data-dash-hwday="yesterday"]').click(); t = await card();
  check('"어제"(11/10): A·가짜D(대기 제외)… 어제 미제출 = A', t.includes('11/10') && t.includes('가짜A') && !t.includes('가짜B'), t);
  await page.locator('[data-dash-hwday="before"]').click(); t = await card();
  check('"그저께"(11/9): B만 미제출', t.includes('11/9') && t.includes('가짜B') && !t.includes('가짜A'), t);
  await page.locator('[data-dash-hwday="class"]').click();
  check('"수업 기준"으로 다시 돌아옴', (await page.locator('[data-dash-hwcard="class"]').count()) === 1);
  // 월요일(11/16): 수~일 숙제, 숙제표에 적힌 날(수·금·일)만 따짐
  await page.evaluate(() => { window.__today = '2026-11-16'; db.weeklyPlans['cls_x_' + weekStartISO('2026-11-11')].stu_A = { wed: '수', fri: '금', sun: '일' }; currentSubState = {}; window.render(); });
  t = await page.locator('[data-dash-hwcard="class"]').innerText();
  const rowA = await page.locator('[data-dash-class-row="stu_A"]').innerText();
  check('월요일: 월수5:30 "수·목·금·토·일 숙제", A는 숙제표에 있는 수 ○ · 금 × · 일 × 만 표시(목·토는 안 따짐)', t.includes('수·목·금·토·일 숙제') && rowA.includes('수 ○') && rowA.includes('금 ×') && rowA.includes('일 ×') && !rowA.includes('목') && !rowA.includes('토'), rowA);
  // 수업 없는 날(금 11/13): 기본 어제, 수업 기준 버튼 없음
  await page.evaluate(() => { window.__today = '2026-11-13'; currentSubState = {}; window.render(); });
  t = await card();
  check('수업 없는 날(금)은 기본 "어제"(11/12), 수업 기준 버튼 없음', (await page.locator('[data-dash-hwday="class"]').count()) === 0 && (await page.locator('[data-dash-hwday]').count()) === 3 && t.includes('11/12'), t);
  await page.locator('[data-dash-hwday="today"]').click(); t = await card();
  check('"오늘" 보기: 공지 문구에 "오늘"', (await page.locator('button[data-text]').count()) === 0 || decodeURIComponent(await page.locator('button[data-text]').first().getAttribute('data-text')).includes('오늘'));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `DASH-HW FAIL ${f}/${results.length}` : `DASH-HW OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
