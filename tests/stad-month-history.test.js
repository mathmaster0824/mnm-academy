/* STAD 엽전 지급용 월 집계: 지난달 기록 보기 + 7일 넘은 기록 불러오기 시험. Playwright + 메모리 Firestore 가짜(가짜 학생). 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`STAD-HIST ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => '2026-11-03'; window.academicTodayISO = () => '2026-11-03'; window.recentRecordStartISO = () => '2026-10-28';
    db.students = [{ id: 'stu_A', name: '가짜A', code: '1', status: 'active', grade: '중1' }, { id: 'stu_B', name: '가짜B', code: '2', status: 'active', grade: '중1' }];
    const apps = { stu_A_2026_10: 0 };
    db.stadApplications = {
      'stu_A_2026-10': { studentId: 'stu_A', month: '2026-10', status: 'approved' }, 'stu_B_2026-10': { studentId: 'stu_B', month: '2026-10', status: 'approved' },
      'stu_A_2026-11': { studentId: 'stu_A', month: '2026-11', status: 'approved' },
    };
    // 서버 전체 기록: A 10월 아침 6일(2,5,6,7,8,29) + 저녁 4일, B 10월 아침 2일. A 11월 1일.
    const att = (id, d) => ({ studentId: id, date: d, attended: true });
    const full = {};
    ['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-29'].forEach((d) => { full['stu_A_' + d] = att('stu_A', d); });
    ['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-29'].forEach((d) => { full['stu_A_' + d].settlementSubmittedAt = 'x'; });
    ['2026-10-12', '2026-10-13'].forEach((d) => { full['stu_B_' + d] = att('stu_B', d); });
    full['stu_A_2026-11-02'] = att('stu_A', '2026-11-02');
    window.__store.stadDaily = full;
    // 실시간 구독은 최근 7일(10/28~)만
    db.stadDaily = Object.fromEntries(Object.entries(full).filter(([, v]) => v.date >= '2026-10-28'));
    window.__queries = []; window.__failGet = false;
    const oc = fsdb.collection.bind(fsdb);
    const wrap = (q) => { const ow = q.where.bind(q), og = q.get.bind(q); q.where = (f, op, v) => { window.__queries.push([f, op, v]); return wrap(ow(f, op, v)); }; q.get = async (...a) => { if (window.__failGet) throw new Error('boom'); return og(...a); }; return q; };
    fsdb.collection = (c) => { const q = oc(c); return c === 'stadDaily' ? wrap(q) : q; };
    currentSubState = {};
    window.render = () => { document.getElementById('mainArea').innerHTML = renderStadAdmin(); };
    window.render();
  });
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#stadMonthCard tr')].slice(1).map((tr) => [...tr.children].map((c) => c.textContent.trim())));
  const settle = () => page.waitForTimeout(400);
  let r = await rows();
  check('이번 달(11월) 기본 표시: A 아침1', r.length === 1 && r[0][0] === '가짜A' && r[0][1] === '1', JSON.stringify(r));
  await page.locator('[data-stadmonth="prev"]').click(); await settle();
  r = await rows();
  const A = r.find((x) => x[0] === '가짜A'), B = r.find((x) => x[0] === '가짜B');
  check('지난달(10월) 보기: 7일 넘은 기록까지 포함해 A 아침6·저녁4·합계10', A && A[1] === '6' && A[2] === '4' && A[3] === '10', JSON.stringify(r));
  check('지난달 B: 아침2(10/12·13, 7일 밖)', B && B[1] === '2' && B[3] === '2', JSON.stringify(r));
  check('지난달 출석률은 그 달 평일 기준(10월 평일 22일 → A 6/22=27%)', A && A[4] === '27%', JSON.stringify(A));
  const q = await page.evaluate(() => window.__queries);
  check('서버에는 10/1~10/31 날짜 범위로 조회', q.some((x) => x[0] === 'date' && x[1] === '>=' && x[2] === '2026-10-01') && q.some((x) => x[0] === 'date' && x[1] === '<=' && x[2] === '2026-10-31'), JSON.stringify(q));
  check('제목이 "지난 기록 집계"로 표시되고 다음 달 버튼 활성, 이번 달로 버튼 있음', (await page.locator('#stadMonthCard h3').innerText()).includes('지난 기록') && !(await page.locator('[data-stadmonth="next"]').isDisabled()) && (await page.locator('[data-stadmonth="now"]').count()) === 1);
  await page.locator('[data-stadmonth="now"]').click(); await settle();
  r = await rows();
  check('이번 달로 돌아오면 11월 집계(A 아침1)', r.length === 1 && r[0][1] === '1' && (await page.locator('[data-stadmonth="next"]').isDisabled()));
  // 불러오기 실패 → 안내 + 재시도, 일부 합계를 보여주지 않음
  await page.evaluate(() => { for (const k of Object.keys(stadHistState)) delete stadHistState[k]; for (const k of Object.keys(stadDailyHist)) delete stadDailyHist[k];
    window.__failGet = true; });
  await page.locator('[data-stadmonth="prev"]').click(); await settle();
  check('불러오기 실패 시 오류 안내와 다시 불러오기 버튼, 표(부분 합계)는 숨김', (await page.locator('#stadMonthCard').innerText()).includes('불러오지 못했어요') && (await rows()).length === 0);
  await page.evaluate(() => { window.__failGet = false; });
  await page.locator('#stadMonthCard button', { hasText: '다시 불러오기' }).click(); await settle();
  r = await rows();
  check('다시 불러오기 성공 시 정상 집계', r.find((x) => x[0] === '가짜A')?.[3] === '10', JSON.stringify(r));
  // 월 중순에도 이번 달 7일 밖 기록이 합계에 들어간다(전엔 누락)
  await page.evaluate(() => { window.todayISO = () => '2026-11-20'; window.academicTodayISO = () => '2026-11-20'; window.recentRecordStartISO = () => '2026-11-14'; currentSubState.stadAdminMonth = '2026-11'; window.__store.stadDaily['stu_A_2026-11-03'] = { studentId: 'stu_A', date: '2026-11-03', attended: true }; db.stadDaily = {}; for (const k of Object.keys(stadHistState)) delete stadHistState[k]; for (const k of Object.keys(stadDailyHist)) delete stadDailyHist[k]; window.render(); });
  await settle();
  r = await rows();
  check('11/20 기준 이번 달 집계에 7일 넘은 11/2·11/3 기록도 포함(A 아침2)', r[0] && r[0][1] === '2', JSON.stringify(r));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `STAD-HIST FAIL ${f}/${results.length}` : `STAD-HIST OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
