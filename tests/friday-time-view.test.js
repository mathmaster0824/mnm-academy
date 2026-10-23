/* 금요일 보강 "시간대별" 보기 시험. 브라우저(Playwright) + 메모리 Firestore 가짜(운영 Firebase 접속 없음, 가짜 학생·가짜 보강 데이터만).
 * 실행: node tests/friday-time-view.test.js   종료 코드: 0 = 모두 통과, 1 = 실패 있음. 운영 데이터 동작은 이 시험으로 확인되지 않는다. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`FRIDAY-TIME ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };
const WEEK = '2026-10-19', FRI = '2026-10-23', OTHER_WEEK = '2026-10-12';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  const setup = async ({ today = '2026-10-21', mode = '', data } = {}) => {
    await page.evaluate(({ WEEK, today, mode, data }) => {
      session = { mode: 'director' };
      document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
      window.todayISO = () => today;
      db.students = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n, i) => ({ id: 'stu_' + n, name: '가짜' + n, code: String(i), classId: i < 4 ? 'cls_x' : 'cls_y', status: 'active', grade: '중1' }));
      db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: ['stu_A', 'stu_B', 'stu_C', 'stu_D'] }, { id: 'cls_y', name: 'Y반', dayGroup: 'tue-thu', studentIds: ['stu_E', 'stu_F', 'stu_G'] }];
      db.fridaySupp = {}; Object.keys(fridayWeekLoads).forEach((k) => delete fridayWeekLoads[k]);
      listenersReady.classes = true; fridayViewMode = mode; window.__failSet = false; window.__sets = [];
      window.__store.fridaySupp = JSON.parse(JSON.stringify(data));
      window.__snap = JSON.stringify(window.__store.fridaySupp);
      if (!window.__wrapped) { window.__wrapped = true; const oc = fsdb.collection.bind(fsdb);
        fsdb.collection = (c) => { const q = oc(c); if (c !== 'fridaySupp') return q; const od = q.doc; q.doc = (id) => { const d = od(id), os = d.set; d.set = async (...a) => { window.__sets.push({ id, data: JSON.parse(JSON.stringify(a[0])) }); if (window.__failSet) throw Object.assign(new Error('boom'), { code: 'unavailable' }); return os(...a); }; return d; }; return q; }; }
      currentView = 'fridaySupp'; currentSubState = { fridayBoardDate: WEEK };
      window.render = () => { document.getElementById('mainArea').innerHTML = renderFridaySuppPage(); };
      window.render();
    }, { WEEK, today, mode, data });
    await page.waitForFunction((w) => fridayWeekLoads[w] && fridayWeekLoads[w].status === 'loaded', WEEK);
    await page.waitForTimeout(80);
  };
  // 가짜 예약: 15:00 대 3명(D 15:00, F 15:00, E 15:30 → 이름·시간 정렬 시험), 17:30 1명, 시간 미정 1명, 예약 아님(시간만 있음) 1명,
  // 같은 학생 B 가 두 반이 아닌 한 반에 한 번만. 그리고 다른 주(OTHER_WEEK) 기록은 섞이면 안 됨.
  const DATA = {
    ['cls_x_' + WEEK]: { stu_A: { needed: true, time: '17:30', tasksText: '오답 3문제\n개념 정리', note: 'A 메모' }, stu_B: { needed: false, time: '15:10', note: '예약 아님' }, stu_C: { needed: true, time: '', note: '시간 미정' }, stu_D: { needed: true, time: '15:00', tasksText: 'D 할 일', done: true } },
    ['cls_y_' + WEEK]: { stu_E: { needed: true, time: '15:30' }, stu_F: { needed: true, time: '15:00' }, stu_G: { needed: false } },
    ['cls_x_' + OTHER_WEEK]: { stu_A: { needed: true, time: '16:00', note: '지난 주' } },
  };
  const slotsOf = () => page.evaluate(() => [...document.querySelectorAll('[data-friday-slot]')].map((sec) => ({ slot: sec.getAttribute('data-friday-slot'), title: sec.querySelector('h3').textContent, badge: sec.querySelector('.badge').textContent, names: [...sec.querySelectorAll('[data-friday-row] b')].map((b) => b.textContent) })));
  const chk = (name) => page.locator(`input[aria-label="${name} 보강 완료"]`);
  const doc = (k) => page.evaluate((k) => JSON.parse(JSON.stringify(window.__store.fridaySupp[k])), k);

  // 1) 자동 기본값: 금요일이 아니면 반별, 금요일(이번 주)이면 시간대별. 직접 고르면 그 선택이 우선
  await setup({ today: '2026-10-21', data: DATA });
  check('금요일이 아닌 날: 기본은 반별 보기(예약 입력 표), 시간대별 영역 없음', (await page.locator('[data-fview="class"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-friday-slot]').count()) === 0 && (await page.locator('th:has-text("예약")').count()) > 0);
  await setup({ today: FRI, data: DATA });
  check('오늘이 금요일(이번 주): 기본이 시간대별 보기', (await page.locator('[data-fview="time"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-friday-slot]').count()) > 0);
  await setup({ today: FRI, mode: 'class', data: DATA });
  check('금요일이어도 직접 반별을 고르면 반별 보기 유지', (await page.locator('[data-friday-slot]').count()) === 0);
  await setup({ today: FRI, data: DATA });
  await page.evaluate(() => { currentSubState.fridayBoardDate = '2026-10-12'; window.render(); });
  check('금요일이어도 지난 주를 보면 기본은 반별 보기(자동은 이번 주에만 적용)', (await page.locator('[data-friday-slot]').count()) === 0);

  // 2) 시간대 묶음·정렬·집계
  await setup({ today: FRI, data: DATA });
  const slots = await slotsOf();
  check('시간대: 15:00–15:59(3명) → 17:00–17:59(1명) → 시간 미정(1명) 순서, 예약 아님(B)과 다른 주 기록은 없음', slots.map((s) => s.slot).join() === '15:00,17:00,none' && slots[0].names.length === 3 && slots[1].names.length === 1 && slots[2].names.length === 1 && !JSON.stringify(slots).includes('가짜B'), JSON.stringify(slots));
  check('같은 시간대 안에서는 시간 → 이름순(15:00 가짜D, 15:00 가짜F, 15:30 가짜E)', slots[0].names.join() === '가짜D,가짜F,가짜E', slots[0].names.join());
  check('시간대 제목 "15:00–15:59", 완료 집계(D 완료 → 1/3명), 전체 요약 "보강 완료 1/5명"', /15:00–15:59/.test(slots[0].title) && /1\/3명 완료/.test(slots[0].badge) && /보강 완료 1\/5명/.test(await page.locator('[data-friday-time-summary]').textContent()), slots[0].badge);
  const rowA = await page.locator('[data-friday-row="stu_A"]').textContent();
  check('각 줄에 시간·학생·반·해야 할 일·메모가 표시됨', /17:30/.test(rowA) && /가짜A/.test(rowA) && /X반/.test(rowA) && /오답 3문제/.test(rowA) && /A 메모/.test(rowA), rowA);

  // 3) 완료 체크: 같은 문서에 부분 저장(다른 필드 유지), 집계·색 갱신, 해제, 반별 보기와 공유
  await chk('가짜F').check(); await page.waitForTimeout(150);
  const fAfter = await doc('cls_y_' + WEEK);
  const setF = await page.evaluate(() => window.__sets.slice());
  check('완료 체크: 해당 학생의 done 만 true 로 저장되고 같은 문서의 다른 학생(E·G)은 그대로, 시간 등 기존 값 유지', fAfter.stu_F.done === true && fAfter.stu_F.needed === true && fAfter.stu_F.time === '15:00' && JSON.stringify(fAfter.stu_E) === JSON.stringify({ needed: true, time: '15:30' }) && fAfter.stu_G && setF.length === 1 && Object.keys(setF[0].data).join() === 'stu_F', JSON.stringify({ fAfter, setF }));
  const s2 = await slotsOf();
  check('체크 후 화면: 15시대 2/3명 완료, 전체 2/5명, 체크칸 유지', /2\/3명 완료/.test(s2[0].badge) && /보강 완료 2\/5명/.test(await page.locator('[data-friday-time-summary]').textContent()) && await chk('가짜F').isChecked());
  await chk('가짜D').uncheck(); await page.waitForTimeout(150);
  check('완료 해제: done=false 로 저장되고 집계가 줄어듦', (await doc('cls_x_' + WEEK)).stu_D.done === false && /1\/3명 완료/.test((await slotsOf())[0].badge));
  await page.locator('[data-fview="class"]').click(); await page.waitForTimeout(80);
  const classViewDone = await page.evaluate(() => [...document.querySelectorAll('input[aria-label$="보강 완료"]')].filter((i) => i.checked).map((i) => i.getAttribute('aria-label')));
  check('반별 보기로 바꾸면 같은 완료 상태가 그대로 보임(F 완료, D 미완료) — 저장 구조 공유', classViewDone.includes('가짜F 보강 완료') && !classViewDone.includes('가짜D 보강 완료'), JSON.stringify(classViewDone));
  await page.locator('[data-fview="time"]').click(); await page.waitForTimeout(80);
  check('시간대별로 되돌아오면 다시 시간대 묶음 표시', (await page.locator('[data-friday-slot]').count()) === 3);

  // 4) 저장 실패: 체크가 되돌려지고 알림, 저장소 불변
  await setup({ today: FRI, data: DATA });
  await page.evaluate(() => { window.__failSet = true; });
  dialogs.length = 0;
  await chk('가짜A').click(); await page.waitForTimeout(250);   // 저장 실패로 원래대로 돌아가므로 check() 대신 click()
  check('저장 실패: 체크가 원래대로 돌아가고(미완료) 실패 알림, 저장소 문서 불변, 칸은 다시 눌러 볼 수 있음', !(await chk('가짜A').isChecked()) && dialogs.some((d) => /저장에 실패/.test(d)) && (await page.evaluate(() => window.__snap === JSON.stringify(window.__store.fridaySupp))) && !(await chk('가짜A').isDisabled()));
  await page.evaluate(() => { window.__failSet = false; });
  await chk('가짜A').check(); await page.waitForTimeout(150);
  check('실패 뒤 다시 누르면 저장됨', (await doc('cls_x_' + WEEK)).stu_A.done === true);

  // 5) 빈 주·중복 예약·읽기 실패
  await setup({ today: FRI, data: { ['cls_x_' + WEEK]: { stu_A: { needed: false } } } });
  check('예약이 없는 주: 안내 문구 표시(빈 표 없음)', /보강 예약된 학생이 없어요/.test(await page.locator('#mainArea').textContent()) && (await page.locator('[data-friday-slot]').count()) === 0);
  await setup({ today: FRI, data: { ['cls_x_' + WEEK]: { stu_A: { needed: true, time: '15:00' } }, ['cls_y_' + WEEK]: { stu_A: { needed: true, time: '17:00' } } } });
  check('같은 학생이 두 반에 예약돼 있으면 중복 안내가 보이고 두 시간대에 각각 표시(한쪽을 숨기지 않음)', /중복 예약 확인/.test(await page.locator('#mainArea').textContent()) && (await slotsOf()).map((s) => s.names.join()).join('|') === '가짜A|가짜A');
  await setup({ today: FRI, data: DATA });
  await page.evaluate((w) => { fridayWeekLoads[w] = { status: 'error', errors: ['X반'] }; window.render(); }, WEEK);
  check('서버 읽기 실패 주에는 시간대별 보기에서도 빈 명단으로 처리하지 않고 오류와 다시 불러오기를 표시', /읽지 못했습니다/.test(await page.locator('#mainArea').textContent()) && (await page.locator('[data-friday-slot]').count()) === 0);

  check('시험 중 페이지 오류 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(`FRIDAY-TIME SUMMARY total=${results.length} pass=${results.length - bad} fail=${bad}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FRIDAY-TIME SCRIPT ERROR', e); process.exit(1); });
