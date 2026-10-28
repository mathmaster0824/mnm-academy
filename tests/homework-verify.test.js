/* 학생별·날짜별 숙제 확인 상태(인증/미인증) 클릭 수정 시험.
 * 브라우저(Playwright) + 메모리 Firestore 가짜(운영 Firebase 접속 없음, 가짜 학생·가짜 숙제 데이터만). 실행: node tests/homework-verify.test.js
 * 종료 코드: 0 = 모두 통과, 1 = 실패 있음. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`HW-VERIFY ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };

// 월수반, 수요일 수업(2026-10-14) → 숙제 날짜 = 월 10/12, 화 10/13
const LESSON = '2026-10-14', MON = '2026-10-12', TUE = '2026-10-13';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  // 학생·설정 정보가 먼저 도착해도 반 목록 전에는 화면 진입을 막아,
  // 복수 반 학생의 보조 반 주간 계획 조회가 빠지지 않도록 확인한다.
  const bootClassRace = await page.evaluate(() => {
    const oldEnterApp = enterApp, oldReady = { ...listenersReady }, oldSession = session, oldEntered = appEntered;
    const oldStudents = db.students, oldClasses = db.classes;
    let entered = false;
    enterApp = () => { entered = true; };
    session = { mode: 'student', studentId: 'stu_multi' };
    db.students = [{ id: 'stu_multi', classId: 'cls_mon', status: 'active' }];
    db.classes = [];
    appEntered = false;
    listenersReady = { settings: true, students: true, classes: false };
    maybeFinishLoading();
    const waitedForClasses = !entered;
    db.classes = [
      { id: 'cls_mon', studentIds: ['stu_multi'] },
      { id: 'cls_tue', studentIds: ['stu_multi'] },
    ];
    listenersReady.classes = true;
    maybeFinishLoading();
    const result = { waitedForClasses, enteredAfterClasses: entered, classIds: classesForStudent('stu_multi').map(c => c.id) };
    enterApp = oldEnterApp; listenersReady = oldReady; session = oldSession; appEntered = oldEntered;
    db.students = oldStudents; db.classes = oldClasses;
    return result;
  });
  check('학생 로그인은 반 목록 준비 전 대기하고, 준비 후 월수·화목 두 반을 모두 연결',
    bootClassRace.waitedForClasses && bootClassRace.enteredAfterClasses && bootClassRace.classIds.length === 2,
    JSON.stringify(bootClassRace));

  // 가짜 데이터 + 저장 지연/실패 주입 + 해당 학생 행만 그리는 render 대체(실제 renderClassRow 를 그대로 사용)
  const setupApp = async (initialStore) => page.evaluate(({ LESSON, MON, TUE, initialStore }) => {
    session = { mode: 'director' };
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    db.students = [
      { id: 'stu_a', name: '가짜A(휴대전화 없음)', code: '1111', classId: 'cls_x', status: 'active', grade: '중1' },
      { id: 'stu_b', name: '가짜B', code: '2222', classId: 'cls_x', status: 'active', grade: '중1' },
    ];
    db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: ['stu_a', 'stu_b'] }];
    db.classRecords = {}; db.submissions = {};
    // B 는 기기로 낸 제출(사진·제출시각 있음)이 월요일에 있고 화요일은 없음. A 는 둘 다 없음.
    const bSub = { studentId: 'stu_b', classId: 'cls_x', date: MON, status: '제출완료', reviewCount: 0, hwPhotos: ['photo-b.jpg'], practicePhotos: [], submittedAt: '2026-10-12T10:00:00.000Z', firstSubmittedAt: '2026-10-12T10:00:00.000Z' };
    window.__store.submissions = initialStore || { ['stu_b_' + MON]: JSON.parse(JSON.stringify(bSub)) };
    db.submissions = JSON.parse(JSON.stringify(window.__store.submissions));
    window.__bSubBefore = JSON.stringify(bSub);
    homeworkRecentLoadState = 'ready'; homeworkRecentStart = '2026-10-01'; // 기록 조회가 끝난 상태(없는 날은 '미제출')
    const oc = fsdb.collection;
    fsdb.collection = (c) => { const q = oc(c); const od = q.doc; q.doc = (id) => { const d = od(id); const os = d.set; d.set = async (...a) => { if (window.__delay) await new Promise((r) => setTimeout(r, window.__delay)); if (window.__fail) throw Object.assign(new Error('boom'), { code: 'unavailable' }); return os(...a); }; return d; }; return q; };
    window.__who = 'stu_a';
    window.__draw = () => { const s = db.students.find((x) => x.id === window.__who); document.getElementById('mainArea').innerHTML = '<div id="rowHost">' + renderClassRow(db.classes[0], s, LESSON, {}, '', new Set()) + '</div>'; };
    window.render = window.__draw; window.__draw();
  }, { LESSON, MON, TUE, initialStore });
  await setupApp(null);

  const badge = (d) => page.locator(`[data-hwverify="${d}"]`);
  const store = (k) => page.evaluate((k) => window.__store.submissions && window.__store.submissions[k] ? JSON.parse(JSON.stringify(window.__store.submissions[k])) : null, k);
  const bUnchanged = () => page.evaluate(() => JSON.stringify(window.__store.submissions['stu_b_2026-10-12']) === window.__bSubBefore);

  // 1) 처음 상태: 두 날짜 모두 기록 없음 → 미인증(×)
  check('학생A: 기록 없는 월·화는 미제출(×)로 보이고 클릭 가능한 칸', (await badge(MON).textContent()).includes('×') && (await badge(TUE).textContent()).includes('×'));

  // 2) A 월요일 클릭 → 저장 중 표시(눌림 방지) → 저장 성공 표시
  await page.evaluate(() => { window.__delay = 400; });
  await badge(MON).click();
  await page.waitForTimeout(120);
  const savingTxt = await badge(MON).textContent(), savingDisabled = await badge(MON).isDisabled();
  check('클릭 직후 "저장 중" 표시, 저장이 끝날 때까지 칸이 잠김', /저장 중/.test(savingTxt) && savingDisabled, savingTxt);
  check('저장이 끝나기 전에는 서버(가짜 Firestore)에 아직 기록이 없음', (await store('stu_a_' + MON)) === null);
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__delay = 0; });
  const okTxt = await badge(MON).textContent();
  const a1 = await store('stu_a_' + MON);
  check('저장 성공: 인증(○) + 저장됨 안내가 보이고 칸 색이 초록', okTxt.includes('○') && /✓/.test(okTxt) && (await badge(MON).getAttribute('class')).includes('green') && (await page.locator(`[data-hwverify-msg="${MON}"]`).textContent()).includes('인증 저장됨'), okTxt);
  check('A 월요일 문서: status=확인, 선생님 직접 확인(verifyMethod=teacher-direct), 학생·반·날짜 기록, 사진·제출시각 없음', a1 && a1.status === '확인' && a1.verifyMethod === 'teacher-direct' && a1.studentId === 'stu_a' && a1.classId === 'cls_x' && a1.date === MON && !a1.submittedAt && !(a1.hwPhotos || []).length, JSON.stringify(a1));
  check('같은 학생의 화요일, 다른 학생 B의 기록은 바뀌지 않음', (await store('stu_a_' + TUE)) === null && (await bUnchanged()) && (await badge(TUE).textContent()).includes('×'));
  const lbl = await page.evaluate(([MON]) => homeworkReviewLabel(db.submissions['stu_a_' + MON], MON, 'stu_a') + '|' + submissionIsAutoSubmitted(db.submissions['stu_a_' + MON]) + '|' + homeworkCountsAsCompleted(db.submissions['stu_a_' + MON], MON), [MON]);
  check('선생님 직접 확인은 "선생님 직접 확인"으로 구분되고 기기 제출(제출 완료)로 표시되지 않음, 완료로 집계', lbl === '선생님 직접 확인|false|true', lbl);

  // 3) 새로고침 대응: 화면 데이터를 비우고 서버(가짜 Firestore) 문서로 다시 불러와 그려도 유지
  await page.evaluate(() => { db.submissions = JSON.parse(JSON.stringify(window.__store.submissions)); window.__draw(); });
  check('서버 저장값으로 다시 그려도 월요일 인증 유지(화요일은 미인증 유지)', (await badge(MON).textContent()).includes('○') && (await badge(TUE).textContent()).includes('×'));

  // 4) 다시 클릭 → 미인증(선생님 직접 확인 해제). 기록 없음과 같게 집계
  await badge(MON).click(); await page.waitForTimeout(150);
  const a2 = await store('stu_a_' + MON);
  const m = await page.evaluate(([MON]) => ({ done: homeworkCountsAsCompleted(db.submissions['stu_a_' + MON], MON), missed: homeworkCountsAsMissed(db.submissions['stu_a_' + MON], MON, 'stu_a'), label: homeworkReviewLabel(db.submissions['stu_a_' + MON], MON, 'stu_a') }), [MON]);
  check('다시 클릭하면 미인증: status=미인증, 완료로 세지 않고 미이행(미제출과 동일)으로 집계, 라벨 "미인증"', a2 && a2.status === '미인증' && !m.done && m.missed && m.label === '미인증' && (await badge(MON).textContent()).includes('×'), JSON.stringify({ a2, m }));
  check('미인증 되돌림 뒤에도 B 기록·A 화요일 불변', (await bUnchanged()) && (await store('stu_a_' + TUE)) === null);

  // 5) 기기로 제출한 학생 B: 인증 해제는 검토대기(사진·제출시각 보존), 다시 인증은 일반 인정(직접 확인으로 표시하지 않음)
  await page.evaluate(() => { window.__who = 'stu_b'; window.__draw(); });
  const b0 = await store('stu_b_' + MON);
  await badge(MON).click(); await page.waitForTimeout(150);
  const b1 = await store('stu_b_' + MON);
  const bShown = await badge(MON).textContent(), bLabel = await page.evaluate(([MON]) => homeworkReviewLabel(db.submissions['stu_b_' + MON], MON, 'stu_b') + '|' + homeworkCountsAsCompleted(db.submissions['stu_b_' + MON], MON), [MON]);
  const keep = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !['status', 'reviewedAt', 'reviewReason'].includes(k)).sort()));
  check('B(기기 제출 있음) 반별 카드 O→X: status=미인증, 칸에 ×·라벨 "미인증"·완료 아님, 사진·제출시각·그 밖의 제출 기록은 한 글자도 바뀌지 않음, verifyMethod 없음', b0 && b1 && b1.status === '미인증' && bShown.includes('×') && !bShown.includes('○') && bLabel === '미인증|false' && keep(b1) === keep(b0) && b1.hwPhotos[0] === 'photo-b.jpg' && b1.submittedAt === '2026-10-12T10:00:00.000Z' && !b1.verifyMethod, JSON.stringify({ b0, b1, bShown, bLabel }));
  await badge(MON).click(); await page.waitForTimeout(150);
  const b2 = await store('stu_b_' + MON);
  const bl = await page.evaluate(([MON]) => homeworkReviewLabel(db.submissions['stu_b_' + MON], MON, 'stu_b') + '|' + homeworkIsTeacherDirect(db.submissions['stu_b_' + MON]), [MON]);
  check('B 다시 인증: status=확인, 사진 보존, "선생님 직접 확인"으로 잘못 표시되지 않음(기기 제출 기록)', b2 && b2.status === '확인' && b2.hwPhotos[0] === 'photo-b.jpg' && !b2.verifyMethod && bl === '인정|false', JSON.stringify({ b2, bl }));
  check('B 를 바꿔도 A 기록은 그대로(월 미인증 문서만 존재)', (await store('stu_a_' + MON)).status === '미인증' && (await store('stu_a_' + TUE)) === null);

  // 6) 저장 실패: 화면이 성공한 것처럼 남지 않고, 서버·화면 데이터 모두 이전 그대로
  await page.evaluate(() => { window.__who = 'stu_a'; window.__draw(); window.__fail = true; });
  const dlgBefore = dialogs.length;
  await badge(TUE).click(); await page.waitForTimeout(300);
  const failTxt = await badge(TUE).textContent();
  check('저장 실패: "저장 실패"가 보이고 인증(○)·초록으로 바뀌지 않음', /저장 실패/.test(failTxt) && !failTxt.includes('○') && !(await badge(TUE).getAttribute('class')).includes('green') && (await page.locator(`[data-hwverify-msg="${TUE}"]`).textContent()).includes('저장 실패'), failTxt);
  check('저장 실패: 서버·화면 데이터 모두 변경 없음, 팝업 없이 칸 안에서 안내', (await store('stu_a_' + TUE)) === null && (await page.evaluate(([TUE]) => !db.submissions['stu_a_' + TUE], [TUE])) && dialogs.length === dlgBefore, JSON.stringify(dialogs));
  await page.evaluate(() => { window.__fail = false; });
  await badge(TUE).click(); await page.waitForTimeout(150);
  check('실패 뒤 다시 누르면 정상 저장(화요일 인증, 직접 확인)', (await store('stu_a_' + TUE)) && (await store('stu_a_' + TUE)).verifyMethod === 'teacher-direct' && (await badge(TUE).textContent()).includes('○'));

  // 7) 권한·보호: 학생 화면에는 클릭 칸이 없고 호출해도 쓰지 않음 / 과거(9/6 이전)·미래·최종불합격·다른 반 기록은 거부
  const g = await page.evaluate(async ({ LESSON }) => {
    const out = {};
    const snap = () => JSON.stringify(window.__store.submissions);
    session = { mode: 'student', studentId: 'stu_a' };
    window.__draw(); out.studentButtons = document.querySelectorAll('[data-hwverify]').length;
    const s0 = snap(); await toggleHomeworkVerify('cls_x', 'stu_a', '2026-10-12'); out.studentWrite = snap() !== s0;
    session = { mode: 'director' };
    // 과거(리스타트 이전) 수업: 칸이 있어도 클릭 불가
    const legacy = document.createElement('div'); legacy.innerHTML = renderClassRow(db.classes[0], db.students[0], '2026-09-02', {}, '', new Set());
    out.legacyClickable = legacy.querySelectorAll('[data-hwverify]').length;
    let s1 = snap(); await toggleHomeworkVerify('cls_x', 'stu_a', '2026-09-01'); out.legacyWrite = snap() !== s1;
    s1 = snap(); await toggleHomeworkVerify('cls_x', 'stu_a', '2099-01-01'); out.futureWrite = snap() !== s1;
    // 최종 불합격
    window.__store.submissions['stu_b_2026-10-13'] = { studentId: 'stu_b', classId: 'cls_x', date: '2026-10-13', status: '최종불합격', reviewCount: 3 };
    db.submissions['stu_b_2026-10-13'] = { ...window.__store.submissions['stu_b_2026-10-13'] };
    s1 = snap(); await toggleHomeworkVerify('cls_x', 'stu_b', '2026-10-13'); out.finalWrite = snap() !== s1;
    // 다른 반 기록이 있는 문서
    window.__store.submissions['stu_a_2026-10-06'] = { studentId: 'stu_a', classId: 'cls_other', date: '2026-10-06', status: '확인', hwPhotos: ['o.jpg'], submittedAt: 'x' };
    db.submissions['stu_a_2026-10-06'] = { ...window.__store.submissions['stu_a_2026-10-06'] };
    s1 = snap(); await toggleHomeworkVerify('cls_x', 'stu_a', '2026-10-06'); out.otherClassWrite = snap() !== s1;
    out.errShown = Object.values(hwVerifyUi).filter((v) => v.state === 'error').length;
    return out;
  }, { LESSON });
  check('학생 화면에는 클릭 칸이 없고, 학생 세션에서 호출해도 저장하지 않음', g.studentButtons === 0 && g.studentWrite === false, JSON.stringify(g));
  check('9/6 이전 과거 기록·아직 오지 않은 날짜는 칸이 잠기고 저장하지 않음', g.legacyClickable === 0 && g.legacyWrite === false && g.futureWrite === false, JSON.stringify(g));
  check('3회 검사 끝난 최종 불합격·다른 반 기록과 겹치는 문서는 저장하지 않고 이유를 표시', g.finalWrite === false && g.otherClassWrite === false && g.errShown >= 2, JSON.stringify(g));

  // 8) 기존 판정 기능(원장이 숙제확인 화면에서 쓰는 함수)이 그대로 동작
  const old = await page.evaluate(async () => {
    session = { mode: 'director' };
    db.submissions['stu_c_2026-10-12'] = window.__store.submissions['stu_c_2026-10-12'] = { studentId: 'stu_c', date: '2026-10-12', status: '대기', reviewCount: 0, hwPhotos: ['c.jpg'], submittedAt: 'x' };
    db.students.push({ id: 'stu_c', name: '가짜C', classId: 'cls_x', status: 'active' });
    await confirmSubmission('stu_c', '2026-10-12');
    return window.__store.submissions['stu_c_2026-10-12'];
  });
  check('기존 "숙제 인정" 버튼 동작 유지(대기→확인, 검사횟수 +1)', old.status === '확인' && old.reviewCount === 1, JSON.stringify(old));


  // ===== 9) 학생 상세페이지(최근 숙제 제출 현황)와 반별 페이지 학생 카드: 같은 기록을 양쪽에서 수정, 서로 일치, 새로고침 유지 =====
  const mountBoth = () => page.evaluate(() => {
    const L = mostRecentLessonDateOnOrBefore('mon-wed', todayISO());
    window.__draw2 = () => { const s = db.students.find((x) => x.id === window.__who);
      document.getElementById('mainArea').innerHTML = '<div id="classHost">' + renderClassRow(db.classes[0], s, L, {}, '', new Set()) + '</div><div id="detailHost">' + renderHomeworkGlanceForWarning(window.__who) + '</div>'; };
    window.render = window.__draw2; window.__who = 'stu_a'; window.__draw2();
    return { L, dates: homeworkDateRangeDates('mon-wed', L) };
  });
  // 시험 데이터 초기화(가짜 데이터만): B 는 D1 에 기기 제출, A 는 기록 없음
  await page.evaluate(() => { window.__store.submissions = {}; db.submissions = {}; });
  const mb = await mountBoth();
  const D1 = mb.dates[0], D2 = mb.dates[1];
  await page.evaluate(([D1]) => { const b = { studentId: 'stu_b', classId: 'cls_x', date: D1, status: '제출완료', reviewCount: 0, hwPhotos: ['photo-b.jpg'], practicePhotos: [], submittedAt: D1 + 'T10:00:00.000Z', firstSubmittedAt: D1 + 'T10:00:00.000Z' };
    window.__store.submissions['stu_b_' + D1] = JSON.parse(JSON.stringify(b)); db.submissions['stu_b_' + D1] = JSON.parse(JSON.stringify(b)); window.__bBefore9 = JSON.stringify(b); window.__draw2(); }, [D1]);
  const cBadge = (d) => page.locator(`#classHost [data-hwverify="${d}"]`), dBadge = (d) => page.locator(`#detailHost [data-hwverify-detail="${d}"]`);
  const both = async (d) => ({ c: (await cBadge(d).textContent()).trim(), dt: (await dBadge(d).textContent()).trim() });
  check('학생 상세페이지에 날짜별 숙제 상태 칸이 클릭 가능한 칸으로 나오고, 반별 카드와 날짜가 같음(미제출 ×)', mb.dates.length >= 2 && (await dBadge(D1).count()) === 1 && (await cBadge(D1).count()) === 1 && (await both(D1)).c.includes('×') && (await both(D1)).dt.includes('미제출'), JSON.stringify(await both(D1)));

  // 9-1) 학생 상세에서 수정 → 같은 문서 → 반별 카드에도 같은 상태
  await dBadge(D1).click(); await page.waitForTimeout(150);
  const t1 = await store('stu_a_' + D1), x1 = await both(D1);
  check('상세에서 클릭: 선생님 직접 확인으로 저장(teacher-direct, 사진·제출시각 없음), 상세·반별 카드 모두 인증으로 표시', t1 && t1.status === '확인' && t1.verifyMethod === 'teacher-direct' && !t1.submittedAt && !(t1.hwPhotos || []).length && x1.dt.includes('선생님 직접 확인') && x1.c.includes('○') && x1.c.includes('직접'), JSON.stringify({ t1, x1 }));
  check('상세에서 바꿔도 같은 학생의 다른 날짜·다른 학생 B 기록은 그대로', (await store('stu_a_' + D2)) === null && (await page.evaluate(() => JSON.stringify(window.__store.submissions['stu_b_' + Object.keys(window.__store.submissions).find((k) => k.startsWith('stu_b_')).slice(6)]) === window.__bBefore9)) && (await both(D2)).dt.includes('미제출'));

  // 9-2) 반별 카드에서 수정 → 상세에도 같은 상태
  await cBadge(D2).click(); await page.waitForTimeout(150);
  const x2 = await both(D2);
  check('반별 카드에서 클릭한 D2 도 상세페이지에 같은 상태(선생님 직접 확인)로 표시', x2.dt.includes('선생님 직접 확인') && x2.c.includes('○') && (await store('stu_a_' + D2)).verifyMethod === 'teacher-direct', JSON.stringify(x2));

  // 9-3) 상세에서 다시 클릭 → 미인증, 반별 카드도 미인증
  await dBadge(D1).click(); await page.waitForTimeout(150);
  const x3 = await both(D1);
  check('상세에서 다시 클릭하면 미인증(status=미인증), 양쪽 화면 모두 미인증 표시, D2 인증은 유지', (await store('stu_a_' + D1)).status === '미인증' && x3.dt.includes('미인증') && x3.c.includes('×') && (await both(D2)).c.includes('○'), JSON.stringify(x3));

  // 9-4) 기기 제출 있는 학생 B 를 상세에서 수정: 사진·제출시각 보존, 직접 확인으로 표시되지 않음, 반별 카드와 일치
  await page.evaluate(() => { window.__who = 'stu_b'; window.__draw2(); });
  await dBadge(D1).click(); await page.waitForTimeout(150);
  const b9 = await store('stu_b_' + D1), xb = await both(D1);
  check('B(기기 제출)를 상세에서 미인증으로: status=미인증, 사진·제출시각 보존, 양쪽 모두 미인증(×)', b9 && b9.status === '미인증' && b9.hwPhotos[0] === 'photo-b.jpg' && b9.submittedAt === D1 + 'T10:00:00.000Z' && !b9.verifyMethod && xb.dt.includes('미인증') && xb.c.includes('×') && !xb.c.includes('△'), JSON.stringify({ b9, xb }));
  await cBadge(D1).click(); await page.waitForTimeout(150);
  const b10 = await store('stu_b_' + D1), xb2 = await both(D1);
  check('B 를 반별 카드에서 다시 인증: 사진 보존, "선생님 직접 확인"이 아니라 일반 인정으로 양쪽 동일 표시', b10.status === '확인' && b10.hwPhotos[0] === 'photo-b.jpg' && !b10.verifyMethod && xb2.dt.includes('인정') && !xb2.dt.includes('직접') && xb2.c.includes('○') && !xb2.c.includes('직접'), JSON.stringify({ b10, xb2 }));

  // 9-5) 저장 실패(상세): 실패 안내, 성공처럼 남지 않음, 반별 카드도 그대로
  await page.evaluate(() => { window.__who = 'stu_a'; window.__draw2(); window.__fail = true; });
  const before5 = await store('stu_a_' + D1);
  await dBadge(D1).click(); await page.waitForTimeout(300);
  const x5 = await both(D1);
  check('상세 저장 실패: "저장 실패" 표시·실패 안내 문구, 서버·화면 데이터는 이전 그대로(미인증), 같은 기록이라 반별 카드에도 실패 표시', /저장 실패/.test(x5.dt) && (await page.locator(`#detailHost [data-hwverify-detail-msg="${D1}"]`).textContent()).includes('저장 실패') && /저장 실패/.test(x5.c) && !x5.c.includes('○') && !x5.dt.includes('인증') && JSON.stringify(await store('stu_a_' + D1)) === JSON.stringify(before5) && (await page.evaluate(([D1]) => db.submissions['stu_a_' + D1].status, [D1])) === '미인증', JSON.stringify(x5));
  await page.evaluate(() => { window.__fail = false; });

  // 9-6) 저장 중 표시(상세)
  await page.evaluate(() => { window.__delay = 400; window.__draw2(); });
  await dBadge(D1).click(); await page.waitForTimeout(120);
  const sv = (await dBadge(D1).textContent()).trim(), svDis = await dBadge(D1).isDisabled();
  await page.waitForTimeout(600); await page.evaluate(() => { window.__delay = 0; });
  check('상세 클릭 직후 "저장 중…" 표시와 잠금, 끝나면 ✓ 로 표시', /저장 중/.test(sv) && svDis && (await dBadge(D1).textContent()).includes('✓'), sv);

  // 9-7) 학생 세션: 상세 표에 수정 칸 없음, 호출해도 저장 안 함
  const st9 = await page.evaluate(async () => { const snap = () => JSON.stringify(window.__store.submissions); session = { mode: 'student', studentId: 'stu_a' }; window.__draw2();
    const n = document.querySelectorAll('[data-hwverify-detail],[data-hwverify]').length; const s0 = snap(); await toggleHomeworkVerify('cls_x', 'stu_a', document.querySelector('#detailHost td').textContent ? '2026-10-15' : ''); const w = snap() !== s0; session = { mode: 'director' }; window.__draw2(); return { n, w }; });
  check('학생 세션에서는 상세·반별 어디에도 수정 칸이 없고 호출해도 저장되지 않음', st9.n === 0 && st9.w === false, JSON.stringify(st9));

  // 9-8) 새로고침: 서버(가짜 Firestore) 저장값을 보관 → 페이지 실제 새로고침 → 저장값만으로 다시 그림 → 양쪽 화면 일치
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__store.submissions)));
  const strip = (o) => ({ c: o.c.replace(/\s*✓/g, ''), dt: o.dt.replace(/\s*✓/g, '') });
  const expectD = { D1: strip(await both(D1)), D2: strip(await both(D2)) };
  await page.reload(); await page.waitForTimeout(800);
  await setupApp(saved);
  await page.evaluate(async () => { db.submissions = {}; const snap = await fsdb.collection('submissions').get(); snap.docs.forEach((d) => { db.submissions[d.id] = d.data(); }); });
  await mountBoth();
  const after = { D1: strip(await both(D1)), D2: strip(await both(D2)) };
  check('실제 새로고침 후에도 저장된 상태가 유지되고 반별 카드·상세 표가 서로 일치(D1 인증 ↔ D2 인증)', JSON.stringify(after) === JSON.stringify(expectD) && after.D1.dt.includes('선생님 직접 확인') && after.D2.dt.includes('선생님 직접 확인') && after.D1.c.includes('직접'), JSON.stringify({ expectD, after }));

  // 재제출: submitHomework 는 status 를 HW_AUTO_SUBMITTED('제출완료')로 저장한다. 미인증(×)이 된 기록이 그 값으로 바뀌면 다시 인증(○)으로 보이고 완료로 집계된다(함수 수준 확인, 제출 화면 전체 흐름은 아님).
  const resub = await page.evaluate(() => { const before = { studentId: 'stu_b', date: '2026-10-19', status: '미인증', hwPhotos: ['photo-b.jpg'], submittedAt: '2026-10-19T10:00:00.000Z' }; const after = { ...before, status: HW_AUTO_SUBMITTED }; return { b: homeworkCountsAsCompleted(before, '2026-10-19'), a: homeworkCountsAsCompleted(after, '2026-10-19'), mark: homeworkReviewMark(after, '2026-10-19', 'stu_b') }; });
  check('미인증(×)이 된 기록이 재제출 상태(제출완료)로 바뀌면 다시 인증(○)·완료로 집계(함수 수준)', resub.b === false && resub.a === true && resub.mark === '○', JSON.stringify(resub));

  // 9-9) 기기로 제출한 학생 B: 반별 카드에서 O→X 저장 → 실제 새로고침 → 저장값만으로 다시 그려도 ×, 사진·제출시각 보존
  await mountBoth(); await page.evaluate(() => { window.__who = 'stu_b'; window.__draw2(); });
  const bBefore = await store('stu_b_' + D1);
  check('(준비) B 의 D1 은 인정(○) 상태', (await cBadge(D1).textContent()).includes('○') && bBefore.status === '확인');
  await cBadge(D1).click(); await page.waitForTimeout(150);
  const saved2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__store.submissions)));
  await page.reload(); await page.waitForTimeout(800);
  await setupApp(saved2);
  await page.evaluate(async () => { db.submissions = {}; const snap = await fsdb.collection('submissions').get(); snap.docs.forEach((d) => { db.submissions[d.id] = d.data(); }); });
  await mountBoth(); await page.evaluate(() => { window.__who = 'stu_b'; window.__draw2(); });
  const bAfter = await store('stu_b_' + D1), bx = await both(D1);
  const same = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !['status', 'reviewedAt', 'reviewReason'].includes(k)).sort()));
  check('새로고침 후에도 B 의 O→X 유지: 반별 카드 ×·상세 미인증, 사진·제출시각 등 제출 기록 그대로', bAfter.status === '미인증' && bx.c.includes('×') && !bx.c.includes('○') && bx.dt.includes('미인증') && bAfter.hwPhotos[0] === 'photo-b.jpg' && same(bAfter) === same(bBefore), JSON.stringify({ bBefore, bAfter, bx }));


  // 9-10) 복수 반 학생의 보조 반 일요일 제출도 학생별 숙제 현황에서 인정되어야 한다.
  const secondarySummary = await page.evaluate(() => {
    todayISO = () => '2026-10-27';
    db.students = [{ id: 'stu_multi', name: '가짜 복수반 학생', classId: 'cls_tue', status: 'active', grade: '중2' }];
    db.classes = [
      { id: 'cls_tue', name: '화목반', dayGroup: 'tue-thu', studentIds: ['stu_multi'] },
      { id: 'cls_mon', name: '월수반', dayGroup: 'mon-wed', studentIds: ['stu_multi'] },
    ];
    db.classRecords = { 'cls_mon_2026-10-26': { stu_multi: {} } };
    db.submissions = {
      'stu_multi_cls_mon_2026-10-25': { studentId: 'stu_multi', classId: 'cls_mon', date: '2026-10-25', status: '확인' },
    };
    const row = homeworkStatusRowsForStudent('stu_multi').find(r => r.date === '2026-10-25');
    return row && { submitted: row.submitted, effectiveState: row.effectiveState, clsId: row.clsId };
  });
  check('복수 반 보조 반 슬롯의 일요일 제출을 미제출로 잘못 표시하지 않음',
    secondarySummary?.submitted === true && secondarySummary.effectiveState === 'approved' && secondarySummary.clsId === 'cls_mon',
    JSON.stringify(secondarySummary));

  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close();
  const fail = results.filter((x) => !x).length;
  console.log(`HW-VERIFY SUMMARY total=${results.length} pass=${results.length - fail} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
