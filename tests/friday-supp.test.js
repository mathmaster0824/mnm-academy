/* 금요일 보강 체크 표시 시험. 브라우저(Playwright) + 메모리 Firestore 가짜(운영 Firebase 접속 없음, 가짜 학생·가짜 보강 데이터만).
 * 실행: node tests/friday-supp.test.js   종료 코드: 0 = 모두 통과, 1 = 실패 있음.
 * 재현하려는 것: 보강 기록은 'fridaySupp/<반ID>_<그 주 월요일>' 문서에 저장·표시되는데, 날짜를 골라 서버에서 읽는 경로가
 *               '<반ID>_<고른 날짜>' 문서를 읽어서, 로그인 때 미리 읽는 최근 7일 범위 밖의 주는 기록이 있어도 비어 보였다. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`FRIDAY-SUPP ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };

// 가짜 데이터: 2026-09-14(월) 주의 금요일 = 2026-09-18. 시험 실행일(최근 7일 범위)보다 충분히 과거.
const OLD_FRI = '2026-09-18', OLD_MON = '2026-09-14', OLD_WED = '2026-09-16', OLD_SUN = '2026-09-20';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  const setup = () => page.evaluate(({ OLD_MON }) => {
    session = { mode: 'director' };
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    db.students = [
      { id: 'stu_d', name: '가짜D', code: '1', classId: 'cls_x', status: 'active', grade: '중1' },
      { id: 'stu_e', name: '가짜E', code: '2', classId: 'cls_x', status: 'active', grade: '중1' },
      { id: 'stu_f', name: '가짜F(다른 반)', code: '3', classId: 'cls_y', status: 'active', grade: '중1' },
    ];
    db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: ['stu_d', 'stu_e'] }, { id: 'cls_y', name: 'Y반', dayGroup: 'mon-wed', studentIds: ['stu_f'] }];
    db.fridaySupp = {};   // 로그인 때는 최근 7일 범위만 읽으므로 과거 주는 비어 있음
    // 서버(가짜)에 있는 기록: D 는 15:00 보강, E 는 보강 없음 + 메모만, 다른 반 F 는 다른 시간
    window.__store.fridaySupp = {
      ['cls_x_' + OLD_MON]: { stu_d: { needed: true, time: '15:00', note: '가짜 보강 메모' }, stu_e: { needed: false, time: '', note: 'E 메모' } },
      ['cls_y_' + OLD_MON]: { stu_f: { needed: true, time: '17:30', note: 'Y반 메모' } },
    };
    window.__snapBefore = JSON.stringify(window.__store.fridaySupp);
  }, { OLD_MON });
  const view = (clsId, date) => page.evaluate(([clsId, date]) => {
    const cls = classById(clsId), wrap = document.createElement('div'); wrap.innerHTML = renderFridaySupp(cls, date);
    return [...wrap.querySelectorAll('tr')].slice(1).map((tr) => ({ name: tr.querySelector('b').textContent, needed: tr.querySelector('input[type=checkbox]').checked, time: tr.querySelector('input[type=time]').value, note: tr.querySelector('input[type=text]').value }));
  }, [clsId, date]);

  await setup();
  // 재현: 지난 주 금요일을 고르면(요일 무관) 그 주 기록이 보여야 한다
  for (const [label, d] of [['금요일', OLD_FRI], ['수요일', OLD_WED], ['월요일', OLD_MON], ['일요일', OLD_SUN]]) {
    await setup();
    await page.evaluate(async ([c, d]) => { await ensureClassDateData(c, d); }, ['cls_x', d]);
    const rows = await view('cls_x', d);
    const D = rows.find((r) => r.name === '가짜D'), E = rows.find((r) => r.name === '가짜E');
    check(`지난 주(로그인 때 안 읽는 주) ${label}(${d})을 골라도 가짜D 의 15:00 보강 기록이 표시됨`, D && D.needed === true && D.time === '15:00' && D.note === '가짜 보강 메모', JSON.stringify(rows));
    if (label === '금요일') check('같은 반 가짜E 는 그대로(보강 아님·메모만), 다른 반 가짜F 의 기록은 이 반 표에 나타나지 않음', E && E.needed === false && E.note === 'E 메모' && !rows.some((r) => r.name.includes('F')), JSON.stringify(rows));
  }
  // 읽기만 했을 뿐 서버(가짜) 기록은 한 글자도 바뀌지 않음
  const same = await page.evaluate(() => JSON.stringify(window.__store.fridaySupp) === window.__snapBefore);
  check('조회는 읽기 전용: 서버(가짜) 보강 문서가 바뀌거나 새로 생기지 않음', same);
  // 다른 반 날짜 조회가 이 반 표에 섞이지 않음
  await setup();
  await page.evaluate(async () => { await ensureClassDateData('cls_y', '2026-09-18'); });
  const y = await view('cls_y', OLD_FRI);
  check('다른 반(Y)의 같은 주 기록은 Y 반에서만 표시됨(17:30)', y.length === 1 && y[0].needed === true && y[0].time === '17:30', JSON.stringify(y));
  // 기존 동작 유지: 로그인 때 이미 읽어 둔 이번 주 기록은 그대로 표시(추가 읽기 없이도)
  await setup();
  const THIS = await page.evaluate(() => weekStartISO(todayISO()));
  await page.evaluate((THIS) => { db.fridaySupp['cls_x_' + THIS] = { stu_d: { needed: true, time: '15:00', note: '이번 주 가짜' } }; }, THIS);
  await page.evaluate(async (t) => { await ensureClassDateData('cls_x', t); }, await page.evaluate(() => todayISO()));
  const cur = await view('cls_x', await page.evaluate(() => todayISO()));
  check('이번 주 기록(미리 읽어 둔 값)은 그대로 표시됨', cur.find((r) => r.name === '가짜D').time === '15:00' && cur.find((r) => r.name === '가짜D').note === '이번 주 가짜', JSON.stringify(cur));
  // 오늘 금요일 보강 목록(대시보드)은 이번 주 기록만 모은다(기존 동작)
  const today = await page.evaluate(() => getTodaysFridaySupp().map((x) => x.studentName + '|' + x.time));
  check('대시보드 "오늘 금요일 보강"은 이번 주 기록을 그대로 모음', today.includes('가짜D|15:00'), JSON.stringify(today));

  // 구형 일요일 키도 현재 주 보강으로 읽되, 서버의 두 원본 문서는 읽기 전용으로 남는다.
  await setup();
  await page.evaluate(({ OLD_MON, OLD_SUN }) => {
    window.__store.fridaySupp['cls_x_' + OLD_SUN] = { stu_d: { needed: true, time: '16:00', note: '일요일 키 기록' }, stu_e: { needed: true, time: '17:00' } };
    window.__store.fridaySupp['cls_x_' + OLD_MON] = { stu_d: { needed: true, time: '15:00', note: '월요일 키 우선' } };
    window.__snapBefore = JSON.stringify(window.__store.fridaySupp);
  }, { OLD_MON, OLD_SUN });
  await page.evaluate(async (d) => { await ensureClassDateData('cls_x', d, true); }, OLD_WED);
  const compatible = await view('cls_x', OLD_WED);
  check('구형 일요일 키의 다른 학생 예약은 같은 주에 표시되고, 월요일 키의 동일 학생 값이 우선함',
    compatible.find(r=>r.name==='가짜D')?.time==='15:00' && compatible.find(r=>r.name==='가짜E')?.time==='17:00', JSON.stringify(compatible));
  check('구형 키 호환 조회도 Firestore 원본을 이동·수정하지 않음',
    await page.evaluate(()=>JSON.stringify(window.__store.fridaySupp)===window.__snapBefore));

  // 전용 페이지: 월수/화목 반을 같은 주 기준으로 묶어 편집하고, 메인에는 시간/이름만 표시한다.
  await setup();
  await page.evaluate(({ OLD_MON }) => {
    db.classes[1].dayGroup='tue-thu';
    window.__store.fridaySupp={
      ['cls_x_'+OLD_MON]: { stu_d:{needed:true,time:'15:00',note:'숨김 메모',tasksText:'오답 3개'}, stu_e:{needed:false,note:'미예약'} },
      ['cls_y_'+OLD_MON]: { stu_f:{needed:true,time:'15:00',note:'다른 반 메모',tasksText:'연산 문제'} },
    };
    db.fridaySupp={};
    currentSubState={fridayBoardDate:OLD_MON};
    currentView='fridaySupp';
    render();
  }, { OLD_MON });
  await page.waitForFunction((week)=>fridayWeekLoads[week]?.status==='loaded', OLD_MON);
  const board = await page.evaluate(()=>document.getElementById('mainArea').innerText);
  check('보강 전용 페이지가 월수반·화목반 및 학생별 해야 할 일을 표시함',
    board.includes('월수반') && board.includes('화목반') && board.includes('가짜D') && board.includes('오답 3개'), board.slice(-500));
  const saveTask = await page.evaluate(async () => {
    const key='cls_x_'+OLD_MON;
    const ok=await updateFriday(key,'stu_d','tasksText','틀린 문제 다시 풀기');
    return {ok, saved:window.__store.fridaySupp[key].stu_d};
  });
  check('학생별 할 일만 고쳐도 기존 예약 시간·메모가 보존되고 서버에도 저장됨',
    saveTask.ok && saveTask.saved.tasksText==='틀린 문제 다시 풀기' && saveTask.saved.time==='15:00' && saveTask.saved.note==='숨김 메모', JSON.stringify(saveTask));
  const dashboardSummary=await page.evaluate(()=>renderFridayDashboardSummary(OLD_MON));
  check('메인 요약은 같은 시간 학생을 한 번씩 집계하고, 메모·해야 할 일 내용은 노출하지 않음',
    dashboardSummary.includes('15:00 · 2명') && dashboardSummary.includes('가짜D') && dashboardSummary.includes('가짜F(다른 반)') && !dashboardSummary.includes('숨김 메모') && !dashboardSummary.includes('틀린 문제 다시 풀기'), dashboardSummary);

  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close();
  const fail = results.filter((x) => !x).length;
  console.log(`FRIDAY-SUPP SUMMARY total=${results.length} pass=${results.length - fail} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FRIDAY-SUPP SCRIPT ERROR', e); process.exit(1); });
