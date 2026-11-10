/* 주요문항 표시(보관함·답변 화면). 가짜 Firestore만 사용. 실행: node tests/key-problem-mark.test.js */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(!!ok); console.log(`KEY-PROB ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; const dialogs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, r => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const o = {};
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' };
    db.students = [{ id: 'sA', name: '도준', status: 'active', grade: '초4' }];
    const src = (pg, no) => { const x = { sourceType: 'TEXTBOOK', sourceCourseId: 'course1', sourceBook: '쎈', sourcePage: pg, sourceProblemNo: no }; x.sourceKey = textbookSourceKey('course1', '쎈', pg, no); return x; };
    const P = k => ({ storageKey: k, url: 'https://x/' + k, contentType: 'image/jpeg' });
    const qs = [
      { id: 'q1', studentId: 'sA', date: '2026-11-04', text: 'a', status: '대기', answerText: '', photos: [], answerPhotos: [P('a1')], ...src('181', '741') },
      { id: 'q2', studentId: 'sA', date: '2026-11-04', text: 'b', status: '대기', answerText: '', photos: [], answerPhotos: [P('a2')], ...src('50', '2') }];
    window.__store.questions = Object.fromEntries(qs.map(q => [q.id, JSON.parse(JSON.stringify(q))])); db.questions = qs;
    const pre = { id: 'solK', photo: P('l1'), courseId: 'course1', book: '쎈', page: '50', problemNo: '2', sourceKey: src('50', '2').sourceKey, uploadedAt: '2026-11-01' };
    db.solutionPhotos = [pre]; window.__store.solutionPhotos = { solK: { ...pre } };
    currentSubState = {}; window.render = () => { document.getElementById('mainArea').innerHTML = renderQnaDirector(); }; window.render();
    o.hasKeyBox = !!document.getElementById('ansKeyLib_q1') && !document.getElementById('ansKeyLib_q1').checked;
    // q1: 주요문항 체크 후 답변 → 새 보관함 항목에 keyProblem
    document.getElementById('ansKeyLib_q1').checked = true;
    await answerQuestion('q1');
    o.saved = Object.values(window.__store.solutionPhotos).filter(x => x.fromQuestionId === 'q1').map(x => !!x.keyProblem).join();
    // q2: 이미 보관함에 있는 해설 → 체크하면 기존 항목에 표시
    document.getElementById('ansKeyLib_q2').checked = true;
    await answerQuestion('q2');
    o.existingMarked = window.__store.solutionPhotos.solK.keyProblem === true;
    window.render();
    o.badge = /⭐ 주요문항/.test(document.getElementById('mainArea').innerHTML) && document.getElementById('ansKeyLib_q2').checked;
    // 체크 해제 후 답변 → 표시 해제
    document.getElementById('ansKeyLib_q2').checked = false; await answerQuestion('q2');
    o.unmarked = !window.__store.solutionPhotos.solK.keyProblem;
    // 보관함 화면: 배지·토글·필터
    window.__store.solutionPhotos.solK.keyProblem = true; db.solutionPhotos.find(p => p.id === 'solK').keyProblem = true;
    const h = renderSolutionLibraryMatchesHtml(db.solutionPhotos);
    o.libBadge = /data-key-badge/.test(h) && /data-key-toggle="solK"/.test(h);
    await toggleSolutionKey('solK'); o.toggled = !window.__store.solutionPhotos.solK.keyProblem;
    currentSubState.solKeyOnly = true; currentSubState.solCourse = 'all'; 
    const page2 = renderSolutionLib();
    o.filterBtn = /data-key-only/.test(page2);
    o.filterHides = !/data-key-toggle="solK"/.test(page2) ;
    o.formBox = /id="spKey"/.test(page2);
    // ---- 추가 검증 ----
    // (3) 연동: 주요 켜면 저장도 켜짐 / 저장 끄면 주요 꺼지고 잠김
    window.render(); const sv = () => document.getElementById('ansSaveLib_q1'), ky = () => document.getElementById('ansKeyLib_q1');
    sv().checked = false; syncAnswerLibraryOptions('q1', 'save'); o.lockOff = ky().checked === false && ky().disabled === true;
    sv().checked = false; ky().disabled = false; ky().checked = true; syncAnswerLibraryOptions('q1', 'key'); o.keyForcesSave = sv().checked === true && ky().checked === true && !ky().disabled;
    // 저장 끈 채 등록하면 기존 표시를 건드리지 않음
    const before = JSON.stringify(window.__store.solutionPhotos.solK);
    db.solutionPhotos.find(p => p.id === 'solK').keyProblem = true; window.__store.solutionPhotos.solK.keyProblem = true;
    window.render(); document.getElementById('ansSaveLib_q2').checked = false; syncAnswerLibraryOptions('q2', 'save');
    await answerQuestion('q2'); o.saveOffKeepsMark = window.__store.solutionPhotos.solK.keyProblem === true;
    // (4) 다른 문항은 바뀌지 않음 + 8장 넘는 정확 일치도 전부 적용
    const other = { id: 'solO', photo: P('o1'), courseId: 'course1', book: '쎈', page: '50', problemNo: '3', sourceKey: src('50', '3').sourceKey, uploadedAt: '2026-11-01' };
    const many = Array.from({ length: 10 }, (_, i) => ({ id: 'solM' + i, photo: P('m' + i), courseId: 'course1', book: '쎈', page: '60', problemNo: '1', sourceKey: src('60', '1').sourceKey, uploadedAt: '2026-11-0' + (i % 9 + 1) }));
    db.solutionPhotos = [db.solutionPhotos.find(p => p.id === 'solK'), other, ...many]; 
    window.__store.solutionPhotos = Object.fromEntries(db.solutionPhotos.map(p => [p.id, { ...p }]));
    const q9 = { id: 'q9', studentId: 'sA', date: '2026-11-05', text: 'z', status: '대기', answerText: '', photos: [], answerPhotos: [], ...src('60', '1') };
    db.questions.push(q9); window.__store.questions.q9 = JSON.parse(JSON.stringify(q9));
    window.render(); document.getElementById('ansKeyLib_q9').checked = true; syncAnswerLibraryOptions('q9', 'key');
    await answerQuestion('q9');
    o.manyAll = many.every(m => window.__store.solutionPhotos[m.id].keyProblem === true);
    o.otherUntouched = !window.__store.solutionPhotos.solO.keyProblem && window.__store.solutionPhotos.solK.keyProblem === true;
    // (2) 새로고침 후 유지: 메모리 DB를 저장소 내용으로 다시 만든 뒤 화면 확인
    db.solutionPhotos = Object.values(window.__store.solutionPhotos).map(x => ({ ...x }));
    window.render();
    o.afterReload = document.getElementById('ansKeyLib_q9').checked === true;
    // (5) 필터 조합: 학년학기(course)+단원+검색+주요
    db.solutionPhotos.find(p => p.id === 'solM0').unit = '단원A'; db.solutionPhotos.find(p => p.id === 'solM1').unit = '단원B'; db.solutionPhotos.find(p => p.id === 'solM1').keyProblem = false;
    currentSubState = { solKeyOnly: true, solCourse: 'course1', solUnit: '단원A', solSearch: '' };
    let hh = renderSolutionLib(); o.combo1 = /data-key-toggle="solM0"/.test(hh) && !/data-key-toggle="solM1"/.test(hh) && !/data-key-toggle="solM2"/.test(hh);
    currentSubState = { solKeyOnly: true, solCourse: 'all', solUnit: 'all', solSearch: '60' };
    hh = renderSolutionLib(); o.combo2 = /data-key-toggle="solM2"/.test(hh) && !/data-key-toggle="solO"/.test(hh) && !/data-key-toggle="solK"/.test(hh);
    currentSubState = { solKeyOnly: false, solCourse: 'course1', solUnit: 'all', solSearch: '' };
    hh = renderSolutionLib(); o.combo3 = /data-key-toggle="solO"/.test(hh) && /data-key-toggle="solM1"/.test(hh);
    return o;
  });
  check('답변 화면에 ⭐ 주요문항 체크박스(기본 꺼짐)', r.hasKeyBox);
  check('주요문항 체크하고 답변 → 보관함 새 항목에 주요문항 저장', r.saved === 'true', r.saved);
  check('보관함에 이미 있는 해설도 주요문항으로 표시됨', r.existingMarked);
  check('다시 열면 ⭐ 배지와 체크 상태 유지', r.badge);
  check('체크 해제 후 답변하면 표시 해제', r.unmarked);
  check('보관함 목록에 ⭐ 배지와 토글 버튼', r.libBadge);
  check('토글 버튼으로 표시/해제', r.toggled);
  check('"⭐ 주요문항만" 필터 버튼과 등록 폼 체크박스', r.filterBtn && r.formBox);
  check('필터 켜면 주요 아닌 항목은 숨김', r.filterHides);
  check('(3) 보관함 저장을 끄면 주요문항 체크는 꺼지고 잠김', r.lockOff);
  check('(3) 주요문항을 켜면 보관함 저장도 자동으로 켜짐', r.keyForcesSave);
  check('(3) 저장을 끄고 등록하면 기존 주요 표시를 건드리지 않음', r.saveOffKeepsMark);
  check('(4) 같은 문제 10장 모두 표시, 다른 문항(50쪽 3번)은 그대로', r.manyAll && r.otherUntouched);
  check('(2) 새로고침(저장소에서 다시 읽기) 후에도 표시 유지', r.afterReload);
  check('(5) 주요문항 필터 + 학년학기 + 단원 조합', r.combo1);
  check('(5) 주요문항 필터 + 검색 조합', r.combo2);
  check('(5) 필터 끄면 주요 아닌 항목도 다시 보임', r.combo3);
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length;
  console.log(f ? `KEY-PROB FAIL ${f}/${results.length}` : `KEY-PROB OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
