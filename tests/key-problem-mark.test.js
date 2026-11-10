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
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length;
  console.log(f ? `KEY-PROB FAIL ${f}/${results.length}` : `KEY-PROB OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
