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

  // 가짜 데이터 + 저장 지연/실패 주입 + 해당 학생 행만 그리는 render 대체(실제 renderClassRow 를 그대로 사용)
  await page.evaluate(({ LESSON, MON, TUE }) => {
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
    window.__store.submissions = { ['stu_b_' + MON]: JSON.parse(JSON.stringify(bSub)) };
    db.submissions = JSON.parse(JSON.stringify(window.__store.submissions));
    window.__bSubBefore = JSON.stringify(bSub);
    homeworkRecentLoadState = 'ready'; homeworkRecentStart = '2026-10-01'; // 기록 조회가 끝난 상태(없는 날은 '미제출')
    const oc = fsdb.collection;
    fsdb.collection = (c) => { const q = oc(c); const od = q.doc; q.doc = (id) => { const d = od(id); const os = d.set; d.set = async (...a) => { if (window.__delay) await new Promise((r) => setTimeout(r, window.__delay)); if (window.__fail) throw Object.assign(new Error('boom'), { code: 'unavailable' }); return os(...a); }; return d; }; return q; };
    window.__who = 'stu_a';
    window.__draw = () => { const s = db.students.find((x) => x.id === window.__who); document.getElementById('mainArea').innerHTML = '<div id="rowHost">' + renderClassRow(db.classes[0], s, LESSON, {}, '', new Set()) + '</div>'; };
    window.render = window.__draw; window.__draw();
  }, { LESSON, MON, TUE });

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
  await badge(MON).click(); await page.waitForTimeout(150);
  const b1 = await store('stu_b_' + MON);
  check('B(기기 제출 있음) 인증→미인증: status=대기, 사진·제출시각 그대로, verifyMethod 없음', b1 && b1.status === '대기' && b1.hwPhotos[0] === 'photo-b.jpg' && b1.submittedAt === '2026-10-12T10:00:00.000Z' && !b1.verifyMethod, JSON.stringify(b1));
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

  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close();
  const fail = results.filter((x) => !x).length;
  console.log(`HW-VERIFY SUMMARY total=${results.length} pass=${results.length - fail} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
