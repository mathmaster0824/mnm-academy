/* 문제저장소 → 문제세트 배정 → 학생 답지 제출 → 원장 채점 흐름 재현 시험.
 * 브라우저(Playwright) + 메모리 Firestore 가짜(운영 Firebase 접속 없음, 가짜 데이터만). 실행: node tests/problem-repo.test.js
 * 종료 코드: 0 = 모두 통과, 1 = 실패 있음. */
const { chromium } = require('playwright');
const path = require('path');

const STUB = `(function(){
  const store = {};                       // {collection: {id: data}}
  window.__store = store;
  const clone = (o)=>JSON.parse(JSON.stringify(o));
  const col = (c)=> (store[c] = store[c] || {});
  const snapOf = (c,id)=>{ const d=col(c)[id]; return {id, exists:d!==undefined, data:()=>d===undefined?undefined:clone(d), ref:{set:async(data,opts)=>{ const cur=col(c)[id]; col(c)[id]=(opts&&opts.merge&&cur)?{...cur,...clone(data)}:clone(data); }}}; };
  let seq = 0;
  function query(c, filters=[], order=null, lim=null, after=null){
    const q = {
      where:(f,op,v)=>query(c,[...filters,[f,op,v]],order,lim,after),
      orderBy:(f,dir)=>query(c,filters,[f,dir||'asc'],lim,after),
      limit:(n)=>query(c,filters,order,n,after),
      startAfter:(s)=>query(c,filters,order,lim,s),
      get:async()=>{
        let rows = Object.keys(col(c)).map(id=>({id,d:col(c)[id]}));
        for(const [f,op,v] of filters){
          rows = rows.filter(({d})=> op==='==' ? d[f]===v : op==='array-contains' ? Array.isArray(d[f])&&d[f].includes(v) : op==='in' ? v.includes(d[f]) : true);
        }
        if(order) rows.sort((a,b)=> (String(a.d[order[0]]??'')<String(b.d[order[0]]??'')?-1:1)*(order[1]==='desc'?-1:1));
        if(after){ const i=rows.findIndex(r=>r.id===after.id); rows=rows.slice(i+1); }
        if(lim!=null) rows=rows.slice(0,lim);
        const docs=rows.map(r=>snapOf(c,r.id));
        return {docs, size:docs.length, empty:docs.length===0, forEach:(f)=>docs.forEach(f)};
      },
      onSnapshot:()=>()=>{},
    };
    return q;
  }
  const fsdb = {
    collection:(c)=>Object.assign(query(c),{
      doc:(id)=>({
        get:async()=>snapOf(c,id),
        set:async(data,opts)=>{ const cur=col(c)[id]; col(c)[id]=(opts&&opts.merge&&cur)?{...cur,...clone(data)}:clone(data); },
        update:async(data)=>{ if(col(c)[id]===undefined) throw Object.assign(new Error('not-found'),{code:'not-found'}); col(c)[id]={...col(c)[id],...clone(data)}; },
        delete:async()=>{ delete col(c)[id]; },
        onSnapshot:()=>()=>{},
      }),
      add:async(data)=>{ const id='auto'+(++seq); col(c)[id]=clone(data); return {id}; },
    }),
    batch:()=>{ const ops=[]; return { set:(ref,data,opts)=>{ ops.push(()=>ref.set(data,opts)); }, commit:async()=>{ for(const f of ops) await f(); } }; },
    enablePersistence:()=>Promise.resolve(), settings:()=>{},
  };
  window.firebase={initializeApp:()=>{},auth:()=>({onAuthStateChanged:()=>{},signInAnonymously:()=>Promise.resolve({}),currentUser:null}),
    firestore:Object.assign(()=>fsdb,{FieldPath:{documentId:()=>'__name__'},FieldValue:{serverTimestamp:()=>({}),delete:()=>({}),arrayUnion:(...a)=>({__union:a}),arrayRemove:(...a)=>({__remove:a}),increment:(n)=>({__inc:n})}}),};
  window.firebase.auth.Auth={Persistence:{LOCAL:'local'}};
})();`;

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`PROBLEM-REPO ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  const fs = require('fs');
  const worker = { uploads: [], segment: 0, deletes: 0 };
  let pdfDir = process.env.PDFJS_DIST_DIR || '';
  if (!pdfDir) { try { const pj = require.resolve('pdfjs-dist/package.json'); if (require(pj).version === '4.10.38') pdfDir = path.join(path.dirname(pj), 'build'); } catch (e) { /* 미설치 */ } }
  if (pdfDir) {
    worker.pdfjsRequests = { main: 0, worker: 0 };
    await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/4\.10\.38\//, (r) => {
      if (/pdf\.min\.mjs/.test(r.request().url())) worker.pdfjsRequests.main++; if (/pdf\.worker\.min\.mjs/.test(r.request().url())) worker.pdfjsRequests.worker++;
      const f = path.join(pdfDir, path.basename(new URL(r.request().url()).pathname));
      r.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
    });
    // 한글 글꼴 매핑표(CMap): 앱이 요청하는 주소와 같은 주소를 로컬 파일로 응답(운영 CDN 접속 없음)
    worker.cmapRequests = 0;
    await page.route(/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@4\.10\.38\/cmaps\//, (r) => {
      worker.cmapRequests++;
      const f = path.join(pdfDir, '..', 'cmaps', path.basename(new URL(r.request().url()).pathname));
      r.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
    });
    await page.route(/mnm-photo-api\.jihagondu\.workers\.dev/, async (r) => {
      const u = new URL(r.request().url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (worker.fail) return r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":"not found"}' });
      if (u.pathname === '/upload') { worker.uploads.push(1); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ storageKey: 'problem-crop/test-' + worker.uploads.length + '.jpg', contentType: 'image/jpeg' }) }); }
      if (u.pathname === '/photo') { if (r.request().method() === 'DELETE') worker.deletes++; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' }); }
      if (u.pathname === '/segment-problem-page' && worker.segByPage) { worker.segment++; const pg = JSON.parse(r.request().postData() || '{}').page; const nos = worker.segByPage[pg] || []; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ segments: nos.map((no, i) => ({ problemNo: String(no), left: .05, top: .08 + i * .22, right: .95, bottom: .28 + i * .22 })) }) }); }
      if (u.pathname === '/segment-problem-page') { worker.segment++; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ segments: [{ problemNo: '1', left: .05, top: .08, right: .95, bottom: .30 }, { problemNo: '2', left: .05, top: .30, right: .95, bottom: .50 }, { problemNo: '3', left: .05, top: .50, right: .95, bottom: .70 }] }) }); }
      r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":"not found"}' });
    });
  }
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  // 1) 문제 등록(수동) → problems(정답 없음) + problemKeys(정답)
  const r1 = await page.evaluate(async () => {
    const answers = [['12 + 5 = ?', '중2', '1학기', '', '', 'short', '17', '3'], ['가장 큰 수는?', '중2', '1학기', '', '', 'mc', '3', '2']];
    let i = 0; window.prompt = () => answers[Math.floor(i / 8)][i++ % 8];
    session = { mode: 'director' };
    await createProblemManually(); await createProblemManually();
    const probs = window.__store.problems || {}, keys = window.__store.problemKeys || {};
    return { nProb: Object.keys(probs).length, nKey: Object.keys(keys).length,
      leak: JSON.stringify(Object.values(probs)).includes('"answer"'), keyAnswers: Object.values(keys).map((k) => k.answer).sort() };
  });
  check('수동 문제 등록 2건 → problems 2 · problemKeys 2', r1.nProb === 2 && r1.nKey === 2, JSON.stringify(r1));
  check('problems 문서에 정답이 들어가지 않음(정답은 problemKeys 에만)', !r1.leak);
  check('problemKeys 에 정답 저장', r1.keyAnswers.join() === '17,3', JSON.stringify(r1.keyAnswers));

  // 2) 저장소 목록 불러오기
  const r2 = await page.evaluate(async () => { problemStore.loaded = false; await loadProblemPage(true); return problemStore.items.length; });
  check('저장소 목록 불러오기 → 2건', r2 === 2, String(r2));

  // 3) 문제 선택 → 반 배정(정답키 미복사)
  const r3 = await page.evaluate(async () => {
    db.students = [{ id: 'stu_a', name: '가짜A', code: '1111', classId: 'cls_x', status: 'active' }];
    db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: '월수', studentIds: ['stu_a'] }];
    problemStore.items.forEach((p) => problemStore.selected.add(p.id));
    const a = ['X반', '시험세트']; let i = 0; window.prompt = () => a[i++];
    await assignSelectedProblems();
    const asg = Object.values(window.__store.assignments || {})[0];
    return asg ? { n: asg.problems.length, hasAnswer: JSON.stringify(asg).includes('"answer"'), ids: asg.problems.map((p) => !!p.problemId) } : null;
  });
  check('선택한 2문항을 반에 배정(assignments 생성)', r3 && r3.n === 2, JSON.stringify(r3));
  check('배정 문서에 정답이 복사되지 않음', r3 && !r3.hasAnswer);

  // 4) 학생 답지 제출
  const r4 = await page.evaluate(async () => {
    const aid = Object.keys(window.__store.assignments)[0];
    db.assignments = { [aid]: { id: aid, ...window.__store.assignments[aid] } };
    session = { mode: 'student', studentId: 'stu_a' };
    const html = renderOneStudentAnswerSheet(db.assignments[aid], 'stu_a');
    document.body.insertAdjacentHTML('beforeend', '<div id="sheet">' + html + '</div>');
    const ps = db.assignments[aid].problems;
    // 문제 순서(등록 순)대로 정답 입력: 첫 문항 17, 둘째 3 — 저장소 목록 순서와 무관하게 유형으로 구분
    ps.forEach((p, i) => { const el = document.getElementById(`ans_${aid}_${i}`); el.value = p.type === 'mc' ? '3' : '17'; });
    await submitAnswerSheet(aid, 'stu_a');
    const sub = window.__store.answerSubmissions[`${aid}_stu_a`];
    return { aid, states: sub.autoResults.map((r) => r.state), studentHtmlHasKey: html.includes('17') && false };
  });
  check('학생 답지 제출 → 채점 대기(grading) 상태로 저장', r4.states.every((s) => s === 'grading'), JSON.stringify(r4.states));

  // 5) 원장 채점: 정답키(problemKeys)로 채점되어야 한다
  const r5 = await page.evaluate(async ([aid]) => {
    session = { mode: 'director' };
    db.answerSubmissions = { [`${aid}_stu_a`]: { id: `${aid}_stu_a`, ...window.__store.answerSubmissions[`${aid}_stu_a`] } };
    await directorGradeAnswerSubmission(aid, 'stu_a');
    return window.__store.answerSubmissions[`${aid}_stu_a`].autoResults.map((r) => ({ s: r.state, p: r.earnedPoints }));
  }, [r4.aid]);
  check('원장 자동 채점: 정답을 입력했으므로 전 문항 정답(correct)', r5.every((r) => r.s === 'correct'), JSON.stringify(r5));
  check('원장 자동 채점 점수 = 배점 합', r5.reduce((n, r) => n + (r.p || 0), 0) === 5, JSON.stringify(r5));

  // 6) 오답은 오답, 정답키가 없으면 단정하지 않고 확인중, 정답이 배정 문서에 있는 테스트 세트는 기존 방식 그대로
  const r6 = await page.evaluate(async ([aid]) => {
    const key = `${aid}_stu_a`; const out = {};
    const sub = window.__store.answerSubmissions[key];
    sub.originalAnswers = sub.originalAnswers.map(() => '999');
    db.answerSubmissions[key] = { id: key, ...sub };
    await directorGradeAnswerSubmission(aid, 'stu_a');
    out.wrong = window.__store.answerSubmissions[key].autoResults.map((r) => r.state);
    const keyIds = Object.keys(window.__store.problemKeys), savedKey = window.__store.problemKeys[keyIds[0]]; delete window.__store.problemKeys[keyIds[0]];
    await directorGradeAnswerSubmission(aid, 'stu_a');
    out.missing = window.__store.answerSubmissions[key].autoResults.map((r) => r.state).sort();
    window.__store.problemKeys[keyIds[0]] = savedKey; // 뒤 시험을 위해 복구
    out.legacy = [localGradeProblem({ type: 'short', answer: '12', points: 3 }, ' 12 ').state, localGradeProblem({ type: 'short', answer: '12', points: 3 }, '13').state, localGradeProblem({ type: 'mc', acceptedAnswers: ['3', '③'], points: 2 }, '③').state];
    return out;
  }, [r4.aid]);
  check('오답 입력 → 전 문항 오답(wrong)', r6.wrong.every((s) => s === 'wrong'), JSON.stringify(r6.wrong));
  check('정답키가 없는 문항은 오답으로 단정하지 않고 확인중(pending)', r6.missing.includes('pending') && r6.missing.includes('wrong'), JSON.stringify(r6.missing));
  check('정답이 배정 문서에 있는 테스트 세트 채점은 기존 방식 그대로', r6.legacy.join() === 'correct,wrong,correct', JSON.stringify(r6.legacy));

  // 7) 수집 초안 → 저장소 저장(saveProblemDraft), 같은 문제 재저장 시 중복 연결, 수집 대기열 화면 렌더
  const r7 = await page.evaluate(async () => {
    const mk = (id, no) => ({ id, status: 'review', problemText: '삼각형 ABC 에서 외심은?', problemNo: no, grade: '중2', semester: '1학기', majorUnit: '삼각형의 성질', middleUnit: '삼각형의 외심과 내심', type: 'short', answer: '5', answerSourceFile: 'teacher-source.pdf', answerSourcePage: 9, answerLinkBasis: '정답표 문항번호 01', points: 2, cropKey: 'crop/' + id, cropHash: 'samehash0001', createdAt: new Date().toISOString() });
    const d1 = mk('draftA', '1'), d2 = mk('draftB', '1');
    for (const d of [d1, d2]) window.__store.problemDrafts = { ...(window.__store.problemDrafts || {}), [d.id]: d };
    problemStore.ingest.drafts = [d1, d2]; problemStore.ingest.sources = []; problemStore.ingest.loaded = true;
    const before = Object.keys(window.__store.problems).length;
    const a = await saveProblemDraft('draftA', { silent: true });
    const b = await saveProblemDraft('draftB', { silent: true });
    const after = Object.keys(window.__store.problems).length;
    const pid = a.problemId;
    let html = ''; try { session = { mode: 'director' }; problemStore.tab = 'ingest'; html = renderProblemIngest(); } catch (e) { html = 'ERR ' + e.message; }
    return { a: a.status, b: b.status, added: after - before, key: window.__store.problemKeys[pid] && window.__store.problemKeys[pid].answer, keySource: window.__store.problemKeys[pid] && [window.__store.problemKeys[pid].answerSourceFile, window.__store.problemKeys[pid].answerSourcePage, window.__store.problemKeys[pid].answerLinkBasis],
      draftSaved: window.__store.problemDrafts.draftA.status, publicHasAnswer: JSON.stringify(window.__store.problems[pid]).includes('"answer"'), htmlOk: typeof html === 'string' && !/^ERR/.test(html) && html.length > 200, html: html.slice(0, 80) };
  });
  check('수집 초안 저장 → 저장소 문제 1건 신규 + 정답키 저장', r7.a === 'saved' && r7.key === '5', JSON.stringify(r7));
  check('정식 저장 후 교사용 정답 파일명·쪽·연결 근거는 비공개 problemKeys 에 보존', JSON.stringify(r7.keySource) === JSON.stringify(['teacher-source.pdf', 9, '정답표 문항번호 01']), JSON.stringify(r7));
  check('같은 문제 초안을 다시 저장 → 중복으로 연결(문제 추가 없음)', r7.b === 'duplicate' && r7.added === 1, JSON.stringify(r7));
  check('저장소 문제 문서에 정답이 노출되지 않음', !r7.publicHasAnswer);
  check('수집 대기열 화면 렌더', r7.htmlOk, r7.html);

  // 8) 학생 질문 → 문제후보(problemDrafts) 연결, 같은 출처 질문은 한 후보로 합치고, 원장 답변은 후보의 해설로 붙는다
  const r8 = await page.evaluate(async () => {
    window.__store.problemDrafts = {}; window.__store.problemSources = window.__store.problemSources || {};
    db.courses = [{ id: 'c1', name: '중2-1', grade: '중2', semester: '1학기', steps: [] }]; db.questions = [];
    const base = { sourceType: 'TEXTBOOK', sourceCourseId: 'c1', sourceBook: '쎈', sourcePage: '10', sourceProblemNo: '5', studentId: 'stu_a', photos: [], answerText: '', answerPhotos: [], status: '대기' };
    window.__store.questions = { q1: { ...base, text: '모르겠어요 1' }, q2: { ...base, studentId: 'stu_b', text: '모르겠어요 2' } };
    const a = await syncQuestionToProblemRepo('q1', window.__store.questions.q1);
    const n1 = Object.keys(window.__store.problemDrafts).length;
    const b = await syncQuestionToProblemRepo('q2', window.__store.questions.q2);
    const n2 = Object.keys(window.__store.problemDrafts).length;
    await syncAnsweredQuestionToProblemRepo('q1', '이렇게 푸세요', []);
    const d = Object.values(window.__store.problemDrafts)[0];
    return { a: a.status, b: b.status, n1, n2, expl: d && d.explanation, origins: d && (d.origins || []).length };
  });
  check('학생 질문 → 문제후보 1건 생성', r8.n1 === 1, JSON.stringify(r8));
  check('같은 교재·쪽·문항의 다른 학생 질문 → 새 후보를 만들지 않고 합침', r8.n2 === 1 && r8.origins === 2, JSON.stringify(r8));
  check('원장 답변 → 문제후보 해설로 연결', r8.expl === '이렇게 푸세요', JSON.stringify(r8));


  // 9) 채점 결과 저장 → 학생 화면 → 원장 최종확인 → 학습 완료 (정답 노출 없음)
  const r9 = await page.evaluate(async ([aid]) => {
    const key = `${aid}_stu_a`;
    const out = {};
    // 앞 시험이 바꾼 상태를 되돌리고, 정답을 낸 답지를 원장이 채점한 뒤 학생 화면을 본다
    const ps = db.assignments[aid].problems;
    window.__store.answerSubmissions[key] = { ...window.__store.answerSubmissions[key], originalAnswers: ps.map((p) => (p.type === 'mc' ? '3' : '17')), learningCompletedAt: null, review: null, wrongReasons: {} };
    session = { mode: 'director' };
    db.answerSubmissions = { [key]: { id: key, ...window.__store.answerSubmissions[key] } };
    await directorGradeAnswerSubmission(aid, 'stu_a');
    session = { mode: 'student', studentId: 'stu_a' };
    db.answerSubmissions = { [key]: { id: key, ...window.__store.answerSubmissions[key] } };
    const html = renderOneStudentAnswerSheet(db.assignments[aid], 'stu_a');
    out.keysInStudentHtml = Object.values(window.__store.problemKeys).some((k) => html.includes('"' + k.answer + '"') || html.includes('정답: ' + k.answer));
    out.studentSeesMarks = (html.match(/○/g) || []).length;
    out.dbg = window.__store.answerSubmissions[key].autoResults.map((r) => r.state).join() + ' | ' + db.assignments[aid].problems.map((p) => p.type).join();
    out.assignmentHasKey = JSON.stringify(window.__store.assignments[aid]).match(/"(answer|acceptedAnswers)"/) !== null;
    out.hasCompleteBtn = html.includes('학습 완료');
    await completeAnswerLearning(aid, 'stu_a');
    out.completedAt = !!window.__store.answerSubmissions[key].learningCompletedAt;
    session = { mode: 'director' };
    const dir = renderDirectorAnswerReview(db.assignments[aid], 'stu_a');
    document.body.insertAdjacentHTML('beforeend', '<div id="dirReview">' + dir + '</div>');
    out.directorView = dir.includes('1번') && dir.includes('2번');
    await finalizeAnswerReview(aid, 'stu_a');
    const rv = window.__store.answerSubmissions[key].review;
    out.review = rv ? { e: rv.earnedPoints, m: rv.maxPoints } : null;
    return out;
  }, [r4.aid]);
  check('채점 후 학생 화면에 ○ 표시, 정답키·배정 문서 정답 노출 없음', r9.studentSeesMarks >= 2 && !r9.keysInStudentHtml && !r9.assignmentHasKey, JSON.stringify(r9));
  check('채점 끝난 답지에서 학습 완료 저장', r9.hasCompleteBtn && r9.completedAt, JSON.stringify(r9));
  check('원장 제출 확인 화면 표시 + 최종확인 저장(점수=배점 합)', r9.directorView && r9.review && r9.review.e === 5 && r9.review.m === 5, JSON.stringify(r9));

  // 10) PDF 수집 (pdf.js 는 npm 판 로컬 파일, 사진/분리 서버는 가짜 — 운영 서버 접속 없음)
  if (!pdfDir) {
    console.log('PROBLEM-REPO SKIP PDF 수집 시험 — pdfjs-dist@4.10.38 미설치(PDFJS_DIST_DIR 지정 또는 npm i pdfjs-dist@4.10.38)');
  } else {
    const r10 = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bin], '중2 1학기 테스트.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer(); dt.items.add(file);
      window.fauth = { currentUser: { getIdToken: async () => 'test-token-not-real' } };
      try { fauth.currentUser = window.fauth.currentUser; } catch (e) { /* 이미 정의됨 */ }
      session = { mode: 'director' };
      document.body.insertAdjacentHTML('beforeend', '<div id="problemPdfAutoStatus"></div>');
      const before = Object.keys(window.__store.problemDrafts || {}).length, srcBefore = Object.keys(window.__store.problemSources || {}).length;
      await autoIngestProblemPdf({ files: dt.files, value: '' });
      const drafts = Object.values(window.__store.problemDrafts || {});
      return { status: document.getElementById('problemPdfAutoStatus').textContent, added: drafts.length - before,
        withCrop: drafts.filter((d) => JSON.stringify(d).includes('problem-crop/')).length,
        sources: Object.keys(window.__store.problemSources || {}).length - srcBefore,
        keyInDrafts: drafts.some((d) => d.answer !== undefined && d.answer !== '') };
    }, require('fs').readFileSync(path.join(__dirname, 'fixtures', 'sample-problems.pdf')).toString('base64'));
    console.log('PROBLEM-REPO INFO PDF 수집 결과: ' + JSON.stringify({ ...r10, uploads: worker.uploads.length, segmentCalls: worker.segment }));
    check('PDF 수집(가짜 서버): 문항 3개가 수집 대기열 초안으로 저장됨', r10.added === 3, JSON.stringify(r10));
    check('PDF 수집: 각 초안에 문항 이미지 저장 키가 연결됨', r10.withCrop >= 3, JSON.stringify(r10));
    check('PDF 수집: 출처(problemSources) 1건 기록', r10.sources === 1, JSON.stringify(r10));

    // 11) 서버에 해당 경로가 없을 때(404): 조용히 실패하지 않고 중단 메시지, 초안·출처 추가 없음
    worker.fail = true;
    const r11 = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], '다른 파일.pdf', { type: 'application/pdf' }));
      const d0 = Object.keys(window.__store.problemDrafts || {}).length, s0 = Object.keys(window.__store.problemSources || {}).length;
      await autoIngestProblemPdf({ files: dt.files, value: '' });
      return { status: document.getElementById('problemPdfAutoStatus').textContent, d: Object.keys(window.__store.problemDrafts || {}).length - d0, s: Object.keys(window.__store.problemSources || {}).length - s0 };
    }, require('fs').readFileSync(path.join(__dirname, 'fixtures', 'sample-problems.pdf')).toString('base64'));
    worker.fail = false;
    check('서버 경로 없음(404): "자동분리 중단" 메시지, 초안·출처 추가 없음', /자동분리 중단/.test(r11.status) && r11.d === 0 && r11.s === 0, JSON.stringify(r11));
  }


  if (pdfDir) {
    const fsx = require('fs');
    const ingestFile = async (fixture, uploadName) => {
      const b64 = fsx.readFileSync(path.join(__dirname, 'fixtures', fixture)).toString('base64');
      const w0 = { up: worker.uploads.length, seg: worker.segment, del: worker.deletes };
      const out = await page.evaluate(async ([b64, name]) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer(); dt.items.add(new File([bin], name, { type: 'application/pdf' }));
        const before = new Set(Object.keys(window.__store.problemDrafts || {}));
        await autoIngestProblemPdf({ files: dt.files, value: '' });
        const drafts = Object.entries(window.__store.problemDrafts || {}).filter(([id]) => !before.has(id)).map(([, d]) => d);
        return { status: document.getElementById('problemPdfAutoStatus').textContent, n: drafts.length,
          answers: drafts.map((d) => ({ no: d.problemNo, a: d.answer, m: d.answerMethod, t: d.type, src: d.idSource, asp: d.answerSourcePage, asf: d.answerSourceFile||'', basis: d.answerLinkBasis, rr: d.reviewReason, pno: d.printedProblemNo, tn: d.typeNo, pg: d.page })).sort((x, y) => String(x.no).localeCompare(String(y.no))),
          texts: drafts.map((d) => ({ no: d.problemNo, t: String(d.problemText || d.rawText || '') })).sort((x, y) => String(x.no).localeCompare(String(y.no))),
          crops: drafts.filter((d) => JSON.stringify(d).includes('problem-crop/')).length };
      }, [b64, uploadName]);
      return { ...out, uploads: worker.uploads.length - w0.up, segCalls: worker.segment - w0.seg, deletes: worker.deletes - w0.del };
    };

    // 13) 한글 정답표: 객관식·단답 정답이 정답표에서 자동 연결되는지
    const r13 = await ingestFile('sample-problems-ko.pdf', 'ko-sample.pdf');
    console.log('PROBLEM-REPO INFO 한글 PDF: ' + JSON.stringify(r13));
    check('한글 합성 PDF: 문항 3개 분리', r13.n === 3 && r13.crops === 3, JSON.stringify(r13));
    check('한글 정답표 자동연결(③, 17, 36 — 뒤쪽 정답표 3개)', r13.answers.map((x) => x.a).join() === '③,17,36', JSON.stringify(r13.answers));
    check('한글 PDF: 객관식 1개 · 나머지 단답 판별', r13.answers[0].t === 'mc' && r13.answers[1].t !== 'mc', JSON.stringify(r13.answers));

    // 13-2) 글자 조각마다 text item 이 나뉘는 한글 PDF(Chromium 인쇄본): 'ㅈ ㅓㅇ 답 및 해 설' 로 쪼개져도 정답표 쪽을 알아보고 문항 쪽에 섞이지 않아야 한다
    const r13g = await ingestFile('sample-problems-ko-glyph.pdf', 'ko-glyph.pdf');
    console.log('PROBLEM-REPO INFO 한글(글자 조각) PDF: ' + JSON.stringify(r13g));
    check('글자 조각 한글 PDF: 정답표 쪽을 문항으로 오인하지 않고 문항 3개 저장', r13g.n === 3 && r13g.crops === 3 && !/중단/.test(r13g.status), JSON.stringify(r13g));
    check('글자 조각 한글 PDF: 정답표 3개 자동연결(③·17·36)', r13g.answers.map((x) => x.a).join() === '③,17,36', JSON.stringify(r13g.answers));

    // 13-3) 한글 글꼴을 PDF 에 넣지 않는 방식(CID, 글꼴 매핑표 필요) + 문제 쪽의 "정답표" 언급 문장 + ①②③ 정답표
    worker.segByPage = { 1: [1, 2], 2: [3] }; worker.cmapRequests = 0;
    const r19 = await ingestFile('sample-cid-ko.pdf', 'cid-sample.pdf');
    worker.segByPage = null;
    console.log('PROBLEM-REPO INFO CID 한글 PDF: ' + JSON.stringify({ ...r19, cmapRequests: worker.cmapRequests }));
    check('글꼴 미포함 한글 PDF: 글자를 읽어 정답표 3개(6·100·4)를 문항 1~3번에 연결', r19.answers.map((x) => x.a).join() === '6,100,4', JSON.stringify(r19));
    check('문제 쪽의 "정답표" 언급 문장 때문에 문제 쪽을 정답 쪽으로 오인하지 않음(문항 3개, 정답표 쪽은 문항에 섞이지 않음)', r19.n === 3 && r19.crops === 3, JSON.stringify(r19));
    // 번호와 본문이 한 text item("1. 12와 18의 …")인 PDF: PDF.js 텍스트 단계에서 문항 경계를 찾아야 하므로 (가짜) AI 분리 서버를 부르지 않는다
    check('번호+본문 한 덩어리 PDF: 텍스트 단계에서 문항 3개 경계 인식(AI 분리 요청 0회)', r19.segCalls === 0, JSON.stringify(r19));
    check('번호+본문 한 덩어리 PDF: 문항 본문은 보존되고 앞의 "1." 번호만 제거됨', r19.texts[0].t.startsWith('12와 18의') && r19.texts[1].t.startsWith('5의 제곱') && r19.texts[2].t.startsWith('방정식'), JSON.stringify(r19.texts));

    // 14) 이미지 전용(스캔) PDF: 텍스트가 없어 AI 페이지 분리 경로(가짜 서버)로 전환 → 임시 페이지 이미지는 처리 후 삭제 요청
    const r14 = await ingestFile('sample-scan.pdf', 'scan-sample.pdf');
    console.log('PROBLEM-REPO INFO 스캔 PDF: ' + JSON.stringify(r14));
    check('스캔 PDF: AI 페이지 분리 요청 1회, 문항 3개 초안 저장', r14.segCalls === 1 && r14.n === 3 && r14.crops === 3, JSON.stringify(r14));
    check('스캔 PDF: 임시 페이지 이미지 1장 + 문항 이미지 3장 업로드, 임시 이미지 삭제 요청 1회', r14.uploads === 4 && r14.deletes === 1, JSON.stringify(r14));

    // 14-2) 실제 PDF.js 를 거치는지: 앱이 받아 간 PDF.js 모듈·워커 요청 횟수와 버전(가짜 파싱 결과가 아니라 PDF 바이트를 PDF.js 가 읽는다)
    const pj = await page.evaluate(async () => { const m = await loadMnmPdfJs(); return { version: m.version, hasGetDocument: typeof m.getDocument === 'function' }; });
    check('PDF.js 4.10.38 모듈과 워커를 앱이 실제로 불러 파싱함(로컬 npm 사본으로 응답, 파싱 결과 대체 아님)', pj.version === '4.10.38' && pj.hasGetDocument && worker.pdfjsRequests.main >= 1 && worker.pdfjsRequests.worker >= 1, JSON.stringify({ pj, req: worker.pdfjsRequests }));

    // 14-3) 깨진 PDF: 파서가 거부 → 중단 메시지, 초안·출처 추가 없음(파싱 결과를 미리 만든 값으로 대신하지 않는다는 증거)
    const rBad = await page.evaluate(async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4\nthis is not a real pdf body\n%%EOF');
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'broken.pdf', { type: 'application/pdf' }));
      const d0 = Object.keys(window.__store.problemDrafts || {}).length, s0 = Object.keys(window.__store.problemSources || {}).length;
      await autoIngestProblemPdf({ files: dt.files, value: '' });
      return { status: document.getElementById('problemPdfAutoStatus').textContent, d: Object.keys(window.__store.problemDrafts || {}).length - d0, s: Object.keys(window.__store.problemSources || {}).length - s0 };
    });
    check('깨진 PDF: PDF.js 가 읽지 못해 "자동분리 중단", 초안·출처 추가 없음', /자동분리 중단/.test(rBad.status) && rBad.d === 0 && rBad.s === 0, JSON.stringify(rBad));

    // 14-4) 정답표 쪽이 없는 PDF: 문항은 3개 저장되지만 정답은 비어 있어야 하고(문제 문장이 정답으로 들어가면 안 됨), 검토 대상으로 남는다
    const rNo = await ingestFile('sample-cid-ko-noanswer.pdf', 'noanswer.pdf');
    console.log('PROBLEM-REPO INFO 정답표 없는 PDF: ' + JSON.stringify(rNo));
    check('정답표 없는 PDF: 문항 3개 저장, 정답은 모두 비어 있음(문제 문장을 정답으로 오인하지 않음)', rNo.n === 3 && rNo.answers.every((x) => !x.a) && rNo.segCalls === 0, JSON.stringify(rNo));

    // 14-5) 실제 파일 선택 입력(<input id=problemPdfAutoInput>)의 onchange 연결로 수집: 함수 직접 호출이 아니라 화면 요소를 통과
    const rInput = await (async () => {
      await page.evaluate(() => { session = { mode: 'director' }; problemStore.tab = 'ingest'; currentView = 'problemRepo'; document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block'; render(); });
      const w0 = { up: worker.uploads.length };
      const d0 = await page.evaluate(() => Object.keys(window.__store.problemDrafts || {}).length);
      await page.setInputFiles('#problemPdfAutoInput', path.join(__dirname, 'fixtures', 'sample-cid-ko.pdf'));
      await page.waitForFunction((d0) => Object.keys(window.__store.problemDrafts || {}).length >= d0 + 3, d0, { timeout: 60000 }); // 수집이 끝나면 화면이 다시 그려져 상태 문구가 지워지므로 저장된 초안 수로 판단
      return page.evaluate((d0) => ({ status: 'input-onchange', added: Object.keys(window.__store.problemDrafts || {}).length - d0, inputReset: document.getElementById('problemPdfAutoInput').value === '' }), d0);
    })();
    check('파일 선택 입력(onchange)으로 수집: 문항 3개 저장, 입력칸은 초기화(같은 파일을 다시 고를 수 있음)', rInput.added === 3 && rInput.inputReset, JSON.stringify(rInput));

    // 14-6) 같은 파일을 다시 수집: 이전 초안은 superseded, 이미 저장(status:saved)된 초안은 건드리지 않음
    const rRe = await page.evaluate(async (b64) => {
      const store = window.__store;
      const mine = (name) => Object.entries(store.problemSources || {}).filter(([, v]) => v.fileName === name).map(([id]) => id);
      const firstIds = mine('cid-sample.pdf'); // 13-3 에서 한 번 수집됨(+ 14-5 에서 같은 이름이 아니라 sample-cid-ko.pdf 로 별도)
      const firstDrafts = Object.entries(store.problemDrafts).filter(([, d]) => firstIds.includes(d.sourceId));
      if (firstDrafts[0]) store.problemDrafts[firstDrafts[0][0]].status = 'saved'; // 하나는 이미 문제저장소에 저장한 것으로 표시
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], 'cid-sample.pdf', { type: 'application/pdf' }));
      await autoIngestProblemPdf({ files: dt.files, value: '' });
      const ids2 = mine('cid-sample.pdf');
      const sup = Object.values(store.problemDrafts).filter((d) => firstIds.includes(d.sourceId));
      return { firstSources: firstIds.length, nowSources: ids2.length, supersededCount: sup.filter((d) => d.status === 'superseded').length, savedKept: sup.filter((d) => d.status === 'saved').length, total: sup.length,
        oldSourceMarked: firstIds.every((id) => !!store.problemSources[id].supersededBy) };
    }, require('fs').readFileSync(path.join(__dirname, 'fixtures', 'sample-cid-ko.pdf')).toString('base64'));
    check('같은 파일 재수집: 이전 출처는 대체 표시, 이전 초안은 superseded, 이미 저장(saved)한 초안은 그대로', rRe.nowSources === rRe.firstSources + 1 && rRe.oldSourceMarked && rRe.savedKept === 1 && rRe.supersededCount === rRe.total - 1, JSON.stringify(rRe));

    // 14-7) 쪽 아래쪽 안내 상자·꼬리말·쪽 번호가 마지막 문항에 섞이지 않는지 + 위첨자 정답(24cm²) 보존 (첨부 시험 PDF 와 같은 구조의 합성 파일)
    const regionsOf = async (fixture) => page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pdfjs = await loadMnmPdfJs(); const pdf = await pdfjs.getDocument({ data: bin, cMapUrl: PROBLEM_PDF_CMAP_URL, cMapPacked: true }).promise;
      const pages = [], plans = []; for (let n = 1; n <= pdf.numPages; n++) { const pg = await pdf.getPage(n); pages[n] = pg; plans.push(await problemPdfPagePlan(pg, n)); }
      const built = problemPdfBuildRegions(plans); const untrimmed = built.regions.map((r) => Math.round(r.y1));
      await problemPdfTrimTrailingRegions(pages, plans, built.regions);
      return { untrimmed, trimmed: built.regions.map((r) => Math.round(r.y1)), flags: built.regions.map((r) => !!r.trailingTrimmed) };
    }, fsx.readFileSync(path.join(__dirname, 'fixtures', fixture)).toString('base64'));
    const rF = await ingestFile('sample-footer-ko.pdf', 'footer-sample.pdf');
    const gF = await regionsOf('sample-footer-ko.pdf');
    console.log('PROBLEM-REPO INFO 꼬리말 PDF: ' + JSON.stringify({ ...rF, geo: gF }));
    check('꼬리말 PDF: 문항 3개, AI 분리 요청 0회, 정답 6·24cm²·5 연결(위첨자 ² 가 2 로 바뀌지 않음)', rF.n === 3 && rF.segCalls === 0 && rF.answers.map((x) => x.a).join() === '6,24cm²,5', JSON.stringify(rF.answers));
    check('쪽 마지막 문항(3번) 본문에 안내 문구·꼬리말·쪽 번호가 섞이지 않고 문항 글만 남음', rF.texts[2].t === '25의 20%는 얼마인지 구하세요.' && rF.texts.every((x) => !/풀이 안내|안내 문장|가상 시험 자료|1쪽/.test(x.t)), JSON.stringify(rF.texts));
    check('마지막 문항 영역만 아래쪽이 줄어듦(쪽 끝 820 → 문항 바로 아래, 최소 높이 55pt 유지), 앞 문항 영역은 그대로', gF.untrimmed[2] > 800 && gF.trimmed[2] < 340 && gF.trimmed[2] >= 285 && gF.trimmed[0] === gF.untrimmed[0] && gF.trimmed[1] === gF.untrimmed[1] && gF.flags.join() === 'false,false,true', JSON.stringify(gF));

    // 그림이 있는 마지막 문항: 그림은 남기고 그 아래 안내·꼬리말만 제외
    const rG = await ingestFile('sample-figure-ko.pdf', 'figure-sample.pdf');
    const gG = await regionsOf('sample-figure-ko.pdf');
    console.log('PROBLEM-REPO INFO 그림 PDF: ' + JSON.stringify({ n: rG.n, texts: rG.texts, geo: gG }));
    check('그림이 있는 마지막 문항: 영역이 그림 아래 끝(쪽 위에서 약 412pt)까지는 포함하고 안내 상자(약 686pt) 앞에서 끝남', gG.trimmed[2] >= 412 && gG.trimmed[2] < 680 && gG.flags[2] === true, JSON.stringify(gG));
    check('그림 PDF: 문항 3개, 3번 본문에 안내·꼬리말 없음, 정답 6·24cm²·5', rG.n === 3 && rG.texts[2].t === '25의 20%는 얼마인지 구하세요.' && rG.answers.map((x) => x.a).join() === '6,24cm²,5', JSON.stringify({ t: rG.texts, a: rG.answers }));

    // 14-8) 번호('1번')와 본문이 다른 item · 그림+음영 안내 상자 · 꼬리말 줄(왼쪽 "정답 및 해설" 언급 안내문 + 오른쪽 끝 라벨) · 쪽 번호('1 / 2') · 'x = 5'/위첨자 정답
    const rB = await ingestFile('sample-boundary-ko.pdf', 'boundary-sample.pdf');
    const gB = await regionsOf('sample-boundary-ko.pdf');
    console.log('PROBLEM-REPO INFO 경계 배치 PDF: ' + JSON.stringify({ n: rB.n, answers: rB.answers.map((x) => x.a), texts: rB.texts, segCalls: rB.segCalls, geo: gB }));
    check('꼬리말 줄에 "정답 및 해설" 안내문이 있어도 문제 쪽을 정답 쪽으로 오인하지 않음: 문항 3개, AI 분리 요청 0회', rB.n === 3 && rB.segCalls === 0 && !/중단/.test(rB.status), JSON.stringify(rB));
    check('정답표 연결: 1번 x=5, 2번 25cm²(위첨자 보존), 3번 24cm', rB.answers.map((x) => x.a).join() === 'x=5,25cm²,24cm', JSON.stringify(rB.answers));
    check('마지막 문항 본문에 꼬리말 안내·오른쪽 라벨·쪽 번호가 섞이지 않고, 그림 치수 글자·딸린 안내는 남음', !/다음 쪽|연습 자료|1\/2|1 \/ 2/.test(rB.texts[2].t) && /8cm/.test(rB.texts[2].t) && /4cm/.test(rB.texts[2].t) && /풀이 과정/.test(rB.texts[2].t), JSON.stringify(rB.texts[2]));
    check('마지막 문항 영역: 쪽 끝(820)이 아니라 그림·안내 상자 아래(약 616)까지, 꼬리말(약 790) 앞에서 끝남', gB.untrimmed[2] > 800 && gB.trimmed[2] >= 614 && gB.trimmed[2] < 700 && gB.flags[2] === true && gB.flags[0] === false && gB.flags[1] === false, JSON.stringify(gB));

    const rTy = await page.evaluate(() => ({
      proc: problemPdfInferType('직사각형의 넓이를 구하세요. ※ 풀이 과정을 식으로 쓰고, 단위도 표시하세요.', { answer: '24cm²' }),
      procOnly: problemPdfInferType('풀이 과정을 쓰시오.', { answer: '' }),
      prove: problemPdfInferType('삼각형의 합동을 증명하시오.', { answer: '' }),
      mc: problemPdfInferType('다음 중 옳은 것은?', { answer: '③', method: 'answer-table-choice' })
    }));
    check('"풀이 과정을 …쓰고" 안내만으로 서술형으로 단정하지 않음(단답형), 증명·서술 지시와 객관식은 기존대로', rTy.proc === 'short' && rTy.procOnly === 'short' && rTy.prove === 'constructed' && rTy.mc === 'mc', JSON.stringify(rTy));
    check('경계 시험 PDF 3번(풀이 과정 안내 포함)은 단답형으로 저장되고 정답 원문(25cm², 24cm)은 변경 없이 저장됨', rB.answers[2].t === 'short' && rB.answers[1].a === '25cm²' && rB.answers[2].a === '24cm', JSON.stringify(rB.answers));

    // 14-9) 2단 문제 쪽 · 앞자리 0 번호('001') · 번호 없는 대표 문항(원문자 보기) · 두 단 경계를 가로지르는 쪽 가운데 꼬리말 · 한 행에 번호 2개인 빠른 정답표(답이 여러 item, 위첨자)
    // 실제 교재에서 재현된 오류를 가상 내용으로 본뜬 시험(실제 교재 파일은 저장소에 넣지 않음).
    const rT2 = await ingestFile('sample-twocol-ko.pdf', 'twocol-sample.pdf');
    const gT2 = await regionsOf('sample-twocol-ko.pdf');
    console.log('PROBLEM-REPO INFO 2단 합성 PDF: ' + JSON.stringify({ n: rT2.n, answers: rT2.answers.map((x) => x.a), texts: rT2.texts.map((x) => x.t.slice(0, 30)), segCalls: rT2.segCalls, geo: gT2 }));
    check('2단·앞자리 0 번호: 보기 ①~⑤ 를 문항 번호로 오인하지 않고 번호 문항 8개(001~008) + 번호 없는 대표 4개, AI 분리 요청 0회', rT2.n === 12 && rT2.segCalls === 0 && !/중단/.test(rT2.status) && rT2.answers.map((x) => x.no).join() === '01,02,03,04,05,06,07,08,유형01-대표,유형02-대표,유형03-대표,유형04-대표', JSON.stringify({ n: rT2.n, s: rT2.status, no: rT2.answers.map((x) => x.no) }));
    check('문항별 본문이 맞게 나뉨(번호 글자는 빠지고 각 문항 첫 글이 해당 문제)', rT2.texts[0].t.startsWith('직선 y') && rT2.texts[2].t.startsWith('둘레의 길이가 24 cm') && rT2.texts[3].t.startsWith('점 (1, 3)') && rT2.texts[7].t.startsWith('5의 제곱') && rT2.texts.slice(0, 8).every((x) => !/대표유형|다음 중 옳은 것은/.test(x.t)) && rT2.texts.slice(8).every((x) => /다음 중 옳은 것은/.test(x.t) && !/대표유형/.test(x.t)), JSON.stringify(rT2.texts));
    check('한 행에 번호 2개인 정답표: 번호별 답 연결, 여러 칸으로 쪼개진 답 이어붙임, 작게 올린 숫자는 위첨자(²)로 보존', rT2.answers.slice(0, 8).map((x) => x.a).join('|') === 'a ≠ 2|4|36 cm²|(1, −3)|3|4|6 cm|25', JSON.stringify(rT2.answers));
    check('쪽 가운데 꼬리말이 두 단 경계를 가로질러도 오른쪽 단 마지막 문항(004, 008) 영역이 꼬리말(약 798pt) 앞에서 끝남', gT2.trimmed[2] < 790 && gT2.trimmed[5] < 790 && gT2.trimmed[8] < 790 && gT2.trimmed[11] < 790 && gT2.flags[2] === true && gT2.flags[11] === true && gT2.untrimmed[2] > 800, JSON.stringify(gT2));
    check('다음 문항 번호 글자가 앞 문항 영역에 걸치지 않음(001 영역 아래 끝이 002 번호 기준선 위 14pt 이내, 약 506pt)', gT2.untrimmed[1] <= 507 && gT2.untrimmed[4] <= 507 && gT2.untrimmed[0] <= 317, JSON.stringify(gT2));
    // 14-10) 대표 문항 식별자·정답 연결 기준: 유형 번호 있음 → '유형NN-대표', 없음 → 앱 생성 '대표NN', 모호/불일치 → 추측하지 않고 검토
    const repOf = (r) => r.answers.filter((x) => /대표/.test(x.no));
    const rep1 = repOf(rT2);
    check('대표 문항: 원본 유형 번호로 안정적 식별자(유형01-대표…)를 만들고 정답표 "유형01 대표 ④" 와 연결, 원본 인쇄 번호는 비움', rep1.map((x) => x.a).join() === '④,③,⑤,②' && rep1.every((x) => x.src === 'printed-type-number' && x.pno === '' && x.m === 'answer-table-choice' && x.t === 'mc' && !x.rr) && rep1.map((x) => x.tn).join() === '01,02,03,04', JSON.stringify(rep1));
    check('연결 근거 기록: 대표는 정답 쪽(3쪽)과 근거("정답표 \'유형01 대표\' 행"), 번호 문항은 정답 쪽과 "정답표 문항번호 NN", 문제 쪽(page)도 함께 남음', rep1[0].asp === 3 && /유형01 대표/.test(rep1[0].basis) && rep1[0].pg === 1 && rep1[2].pg === 2 && rT2.answers[0].asp === 3 && /문항번호 01/.test(rT2.answers[0].basis) && rT2.answers[0].src === 'printed-number', JSON.stringify({ r: rep1[0], n: rT2.answers[0] }));
    const rNH = await ingestFile('sample-rep-nohead-ko.pdf', 'rep-nohead.pdf');
    const repNH = repOf(rNH);
    check('유형 번호가 전혀 없으면 앱 생성 번호 대표01~04(원본 번호 아님), 정답표와 추측 연결하지 않고 검토(정답 비움)', rNH.n === 12 && repNH.map((x) => x.no).join() === '대표01,대표02,대표03,대표04' && repNH.every((x) => x.src === 'app-generated' && x.a === '' && x.m === 'needs-review' && x.rr === 'app-generated-number-no-answer-link' && x.pno === '' && x.asp === null), JSON.stringify(repNH));
    const rMM = await ingestFile('sample-rep-mismatch-ko.pdf', 'rep-mismatch.pdf');
    const repMM = repOf(rMM), mmMeta = await page.evaluate(() => { const v = Object.values(window.__store.problemSources || {}); return v[v.length - 1].segmentationMeta; });
    const mmBy = (re) => repMM.filter((x) => re.test(x.no));
    check('제목 [01, 02, 02(중복), 없음]: 01 만 연결(정답 ④), 중복 02 두 개와 제목 없는 것은 추측하지 않고 검토(사유·쪽 포함 식별자)', repMM.length === 4 && mmBy(/^유형01-대표$/)[0].a === '④' && mmBy(/^유형01-대표$/)[0].src === 'printed-type-number' && mmBy(/^유형02-대표@p/).length === 2 && mmBy(/^유형02-대표@p/).every((x) => x.a === '' && x.rr === 'type-number-duplicate' && x.src === 'unresolved') && mmBy(/^대표-p/).length === 1 && mmBy(/^대표-p/)[0].rr === 'type-number-missing' && mmBy(/^대표-p/)[0].a === '', JSON.stringify(repMM));
    check('정답표에는 있는데 문제 쪽에서 짝을 못 찾은 항목(유형02 중복, 유형09)은 연결하지 않고 쪽과 함께 기록', JSON.stringify((mmMeta.unmatchedRepresentativeAnswers || []).map((x) => x.id + '@' + x.answerPage).sort()) === JSON.stringify(['유형02-대표@3', '유형09-대표@3']), JSON.stringify(mmMeta));
    // 14-11) 단원 전체 교재 PDF(표지·개념 쪽이 문제 쪽 앞에 섞임). 실제 교재 2종(학생용·교사용)에서 재현된 실패를 가상 내용으로 본뜬 시험.
    //  (a) 표지 'PART 04'·개념 쪽 '5. …' 가 연속 번호의 시작으로 잡혀 실제 001~005 가 버려짐 (b) 교사용 쪽의 인라인 '정답/풀이' 가 문항 본문·이미지에 섞임
    //  (c) 정답표 없는 학생용 PDF 의 대표 문항이 보기 ①~⑤ 가 있는데도 단답형으로 판정됨(NFKC 가 원문자를 지움)
    const rFS = await ingestFile('sample-fullchapter-student-ko.pdf', 'fullchapter-student.pdf');
    const rFT = await ingestFile('sample-fullchapter-teacher-ko.pdf', 'fullchapter-teacher.pdf');
    const numOf = (r) => r.answers.filter((x) => !/대표/.test(x.no)).map((x) => x.no).join();
    console.log('PROBLEM-REPO INFO 전체 단원 합성 PDF: ' + JSON.stringify({ stu: { n: rFS.n, no: numOf(rFS), seg: rFS.segCalls, status: rFS.status }, tch: { n: rFT.n, no: numOf(rFT), seg: rFT.segCalls, a: rFT.answers.map((x) => x.a) } }));
    check('표지·개념 쪽이 앞에 있어도 번호 문항 001~008 이 모두 잡히고 표지(04)·개념 쪽(05)은 문항이 아님: 문항 12개(번호 8 + 대표 4), AI 분리 요청 0회', rFS.n === 12 && numOf(rFS) === '01,02,03,04,05,06,07,08' && rFS.segCalls === 0 && !/중단/.test(rFS.status), JSON.stringify({ n: rFS.n, no: numOf(rFS), seg: rFS.segCalls }));
    check('정답표가 없는 학생용: 보기 ①~⑤ 가 있는 대표 4개는 객관식, 번호 문항 8개는 단답, 정답은 비워 검토로 남김', rFS.answers.filter((x) => /대표/.test(x.no)).every((x) => x.t === 'mc') && rFS.answers.filter((x) => !/대표/.test(x.no)).every((x) => x.t === 'short') && rFS.answers.every((x) => !x.a), JSON.stringify(rFS.answers.map((x) => [x.no, x.t, x.a])));
    check('교사용(문제 아래 빨간 정답·풀이 인쇄): 문항 본문에 "정답"·"풀이" 글이 섞이지 않고 문항 12개, 정답표에서 12개 모두 연결', rFT.n === 12 && rFT.texts.every((x) => !/정답|가상 풀이|④ 라 \(/.test(x.t)) && rFT.answers.every((x) => x.a), JSON.stringify({ n: rFT.n, texts: rFT.texts.map((x) => x.t.slice(-24)), a: rFT.answers.map((x) => x.a) }));
    check('교사용 문항 본문은 문제 문장까지는 그대로 남음(001 은 "…값을 구하시오.", 대표는 보기 ⑤ 까지)', rFT.texts[0].t.endsWith('의 값을 구하시오.') && /⑤ 마$/.test(rFT.texts.find((x, i) => /대표/.test(rFT.answers[i].no)).t), JSON.stringify(rFT.texts.slice(0, 2)));
    // 14-12) 정답 값이 한글로 시작하는 문항(실제 교사용 교재 23·25·26번: '최댓값 2, 최솟값 −2', '제3사분면', '제1, 2사분면'): 공백을 지운 글로 "정답" 뒤 글자를 보면 한글이라 정답 줄로 못 알아봐 잘리지 않던 문제
    const hangulIdx = [2, 4, 5];
    check('정답이 한글로 시작하는 문항(003·005·006)도 정답 줄이 잘리고 본문은 문제 문장까지 보존, 정답표 값이 그대로 연결', hangulIdx.every((i) => !/정답|가상 풀이/.test(rFT.texts[i].t) && rFT.texts[i].t.endsWith('의 값을 구하시오.')) && rFT.answers[2].a === '최댓값 7, 최솟값 1' && rFT.answers[4].a === '제3사분면' && rFT.answers[5].a === '제1, 2사분면', JSON.stringify(hangulIdx.map((i) => [rFT.texts[i].t.slice(-30), rFT.answers[i].a])));
    // 14-11b) 학생용·교사용 파일을 함께 선택하면 문제는 학생용에서만 만들고 정답표는 교사용 파일에서 연결한다.
    const studentPairName = 'sample-fullchapter-student.pdf', teacherPairName = 'sample-fullchapter-teacher.pdf';
    const studentPairB64 = fsx.readFileSync(path.join(__dirname, 'fixtures', 'sample-fullchapter-student-ko.pdf')).toString('base64');
    const teacherPairB64 = fsx.readFileSync(path.join(__dirname, 'fixtures', 'sample-fullchapter-teacher-ko.pdf')).toString('base64');
    const pairWorker0 = { up: worker.uploads.length, seg: worker.segment };
    const rPair = await page.evaluate(async ([sb, tb, sn, tn]) => {
      const makeFile = (b64, name) => new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type: 'application/pdf' });
      const files = new DataTransfer(); files.items.add(makeFile(sb, sn)); files.items.add(makeFile(tb, tn));
      const beforeDrafts = new Set(Object.keys(window.__store.problemDrafts || {}));
      const beforeSources = new Set(Object.keys(window.__store.problemSources || {}));
      await autoIngestProblemPdf({ files: files.files, value: '' });
      const drafts = Object.entries(window.__store.problemDrafts || {}).filter(([id]) => !beforeDrafts.has(id)).map(([, d]) => d);
      const sources = Object.entries(window.__store.problemSources || {}).filter(([id]) => !beforeSources.has(id)).map(([, s]) => s);
      return {
        status: document.getElementById('problemPdfAutoStatus').textContent, n: drafts.length,
        answers: drafts.map(d => ({ no: d.problemNo, a: d.answer, asf: d.answerSourceFile || '', asp: d.answerSourcePage || null, basis: d.answerLinkBasis || '' })).sort((a,b) => String(a.no).localeCompare(String(b.no))),
        texts: drafts.map(d => String(d.problemText || d.rawText || '')),
        sourceFiles: sources.map(s => s.fileName || ''),
        cropCount: drafts.filter(d => !!d.cropKey).length
      };
    }, [studentPairB64, teacherPairB64, studentPairName, teacherPairName]);
    check('짝 PDF 업로드는 학생용 문제 12개만 수집하고 교사용 PDF의 정답표를 연결(정답 출처 파일·쪽 기록)', rPair.n === 12 && rPair.answers.every(x => x.asf === teacherPairName && x.asp === 5 && !!x.basis) && rPair.status.includes('짝 등록 완료'), JSON.stringify({ n: rPair.n, status: rPair.status, answerSources: rPair.answers.slice(0, 2) }));
    check('짝 PDF에서 학생용 문제 본문·크롭만 저장(교사용 풀이/정답 줄 및 교사용 source 미포함)', rPair.cropCount === 12 && rPair.sourceFiles.length === 1 && rPair.sourceFiles[0] === studentPairName && rPair.texts.every(t => !/정답|가상 풀이/.test(t)) && worker.uploads.length - pairWorker0.up === 12, JSON.stringify({ n: rPair.n, sources: rPair.sourceFiles, uploads: worker.uploads.length - pairWorker0.up, textTail: rPair.texts.map(t => t.slice(-18)) }));
    const mismatchWorker0 = worker.uploads.length;
    const mismatchedPairRejected = await page.evaluate(async ([sb, tb]) => {
      const make = (b64, name) => new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type: 'application/pdf' });
      const files = new DataTransfer(); files.items.add(make(sb, 'unit-a-student.pdf')); files.items.add(make(tb, 'unit-b-teacher.pdf'));
      const beforeSources = Object.keys(window.__store.problemSources || {}).length;
      const beforeDrafts = Object.keys(window.__store.problemDrafts || {}).length;
      const rejected = problemPdfFindStudentTeacherPair(Array.from(files.files)) === null;
      await autoIngestProblemPdf({ files: files.files, value: '' });
      return rejected &&
        Object.keys(window.__store.problemSources || {}).length === beforeSources &&
        Object.keys(window.__store.problemDrafts || {}).length === beforeDrafts;
    }, [studentPairB64, teacherPairB64]);
    check('짝 업로드 파일명이 서로 다른 교재·단원을 가리키면 자동으로 가져오지 않고 중단', mismatchedPairRejected && worker.uploads.length === mismatchWorker0, JSON.stringify({ rejected: mismatchedPairRejected, workerUploads: worker.uploads.length - mismatchWorker0 }));
    const rQuickAnswers = await page.evaluate(() => {
      const items = [];
      const add = (text, x, y, w = String(text).length * 6) => items.push({ text, x, y, w, h: 10 });
      [[1,48],[2,176],[3,303],[4,430]].forEach(([n,x]) => add('유형 ' + String(n).padStart(2,'0'), x, 732));
      [[48,'③'],[176,'④'],[303,'②'],[430,'⑤']].forEach(([x,a]) => add('대표 ' + a, x, 720));
      add('001 중앙값 16, 최빈값 15', 48, 706);
      add('002 평균 33.8, 중앙값 33.5', 48, 693);
      add('003 80점', 176, 706);
      add('023 Q', 430, 585, 24);
      add('₁', 454, 585, 5); add('= 5, Q', 459, 585, 24); add('₃', 483, 585, 5); add('= 13', 488, 585, 20);
      add('심화 01 :', 48, 470, 33); add('10', 87, 470, 12); add('3', 89, 464, 5);
      add('심화 05 : 3가지', 176, 470);
      const map = problemPdfExtractQuickAnswerPairsFromItems(items);
      const get = k => map.get(k)?.answer || '';
      return { size: map.size, rep1:get('유형01-대표'), rep4:get('유형04-대표'),
        q1:get('01'), q2:get('02'), q3:get('03'), q23:get('23'),
        advanced1:get('심화01'), advanced5:get('심화05') };
    });
    check('4단 빠른정답 표에서 유형 대표·앞자리 0 문항·심화 답을 각각 올바른 ID와 연결하고 분리된 수식 조각을 보존', rQuickAnswers.size === 10 && rQuickAnswers.rep1 === '③' && rQuickAnswers.rep4 === '⑤' && rQuickAnswers.q1 === '중앙값 16, 최빈값 15' && rQuickAnswers.q2 === '평균 33.8, 중앙값 33.5' && rQuickAnswers.q3 === '80점' && /Q₁\s*=\s*5,?\s*Q₃\s*=\s*13/.test(rQuickAnswers.q23) && rQuickAnswers.advanced1 === '10/3' && rQuickAnswers.advanced5 === '3가지', JSON.stringify(rQuickAnswers));
    const rAdvancedRegions = await page.evaluate(() => {
      const mk = (pageNo, labels) => {
        const height = 842, items = [];
        for (const [no, x, top] of labels) {
          items.push({ str: '심화 ' + String(no).padStart(2,'0'), transform: [1,0,0,1,x,height-top], width: 30, height: 10 });
          items.push({ str: '문제 본문 ' + String(no).padStart(2,'0'), transform: [1,0,0,1,x+63,height-top], width: 70, height: 10 });
          items.push({ str: '이어지는 설명', transform: [1,0,0,1,x,height-(top+16)], width: 60, height: 10 });
        }
        return { pageNo, width: 595, height, items, pageText: items.map(x=>x.str).join(' '), isAnswerPage: false, candidates: [] };
      };
      const plans = [
        mk(21, [[1,53,111],[2,311,111],[3,53,460],[4,311,460]]),
        mk(22, [[5,53,111],[6,311,111],[7,53,460],[8,311,460]])
      ];
      const regions = problemPdfBuildRegions(plans).regions.filter(r=>r.advanced);
      const byNo = Object.fromEntries(regions.map(r=>[r.problemNo,r]));
      return {
        ids: regions.map(r=>r.problemNo).sort(),
        sources: regions.every(r=>r.idSource==='printed-advanced-number'),
        columns: regions.filter(r=>r.page===21).map(r=>r.column).sort(),
        leftEnd: Math.round(byNo['심화01']?.y1||0),
        nextLeftStart: Math.round(byNo['심화03']?.y0||0),
        leftText: byNo['심화01'] ? problemPdfRegionText(plans[0].items,byNo['심화01'],842) : '',
        rightText: byNo['심화02'] ? problemPdfRegionText(plans[0].items,byNo['심화02'],842) : ''
      };
    });
    check('심화 01~08 라벨을 빠른정답과 같은 심화01~심화08 식별자로 8개 인식', rAdvancedRegions.ids.join() === '심화01,심화02,심화03,심화04,심화05,심화06,심화07,심화08' && rAdvancedRegions.sources, JSON.stringify(rAdvancedRegions));
    check('심화문제는 두 단을 따로 자르고, 본문에는 라벨을 중복해 넣지 않으며 다음 줄 문항을 침범하지 않음', rAdvancedRegions.columns.join() === 'L,L,R,R' && rAdvancedRegions.leftText.includes('문제 본문 01') && rAdvancedRegions.rightText.includes('문제 본문 02') && !/심화/.test(rAdvancedRegions.leftText+rAdvancedRegions.rightText) && rAdvancedRegions.leftEnd <= rAdvancedRegions.nextLeftStart, JSON.stringify(rAdvancedRegions));
    const rIA = await page.evaluate(() => {
      const mk = (rows) => ({ pageNo: 1, height: 800, width: 600, items: rows.map(([str, x, ytop]) => ({ str, transform: [1, 0, 0, 1, x, 800 - ytop] })) });
      const reg = () => ({ page: 1, x0: 0, y0: 100, x1: 600, y1: 400, markerX: 52, markerY: 120 });
      const run = (rows) => { const r = [reg()]; problemPdfCutInlineAnswers([mk(rows)], r); return r[0]; };
      const sentence = run([['1', 52, 120], ['정답을 고르시오.', 70, 150], ['보기 ①', 70, 200]]);          // 문제 문장 속 "정답을"
      const answerLine = run([['1', 52, 120], ['문제 본문', 70, 150], ['정답', 52, 260], ['③', 80, 260]]);     // 인쇄된 정답 줄
      const hangul = run([['1', 52, 120], ['문제 본문', 70, 150], ['정답 제3사분면', 52, 260]]);                 // 정답 값이 한글로 시작
      const tooHigh = run([['정답 3', 52, 130]]);                                                           // 번호 글줄 바로 밑이라 남는 본문이 없는 경우
      return { sentence: { y1: sentence.y1, cut: !!sentence.inlineAnswerCut }, answerLine: { y1: answerLine.y1, cut: !!answerLine.inlineAnswerCut }, hangul: { y1: hangul.y1, cut: !!hangul.inlineAnswerCut }, tooHigh: { y1: tooHigh.y1, cut: !!tooHigh.inlineAnswerCut, rr: tooHigh.reviewReason || '' } };
    });
    check('정답 줄 판정 단위 시험: "정답을 고르시오." 문장은 자르지 않고, 줄 맨 앞 "정답"은 그 줄 위에서 자르며, 남는 본문이 없으면 자르지 않고 검토 사유를 남김', !rIA.sentence.cut && rIA.sentence.y1 === 400 && rIA.answerLine.cut && rIA.answerLine.y1 === 246 && rIA.hangul.cut && rIA.hangul.y1 === 246 && !rIA.tooHigh.cut && rIA.tooHigh.rr === 'inline-answer-not-trimmed', JSON.stringify(rIA));
    // 기존 데이터(새 필드 없음) 호환: 새 필드가 없는 초안도 상태·완성도·공개 데이터 변환·목록 표시가 그대로 동작
    const rLeg = await page.evaluate(() => {
      const legacy = { id: 'leg1', problemNo: '07', printedProblemNo: '07', page: 3, rawText: '3x+1=7 일 때 x 를 구하시오.', answer: '2', answerMethod: 'answer-table-text', type: 'short', grade: '중3', semester: '1학기', majorUnit: '이차함수', middleUnit: '', status: 'review', sourceId: 'srcL', cropKey: 'problem-crop/legacy.jpg' };
      const out = { st: problemDraftStatus(legacy), cf: problemDraftConfidence(legacy), pub: problemDraftPublicData(legacy) };
      problemStore.ingest = { loaded: true, loading: false, sources: [], drafts: [legacy, { ...legacy, id: 'new1', problemNo: '대표01', idSource: 'app-generated', reviewReason: 'app-generated-number-no-answer-link' }], sourceFilter: '', statusFilter: '', aiFilter: '' };
      let html = ''; try { html = renderProblemIngest(); } catch (e) { html = 'ERR ' + e.message; }
      return { st: out.st, cf: out.cf, srcNo: out.pub.sourceProblemNo, srcPage: out.pub.sourcePage, htmlOk: !/^ERR/.test(html) && html.includes('07') && html.includes('대표01'), badgeNew: /앱 생성 번호/.test(html) && /번호·정답 검토/.test(html), badgeCount: (html.match(/앱 생성 번호/g) || []).length };
    });
    check('새 필드가 없는 기존 초안: 상태·완성도·공개 데이터 변환·목록 표시가 그대로 동작하고, 앱 생성 번호·검토 사유 배지는 새 필드가 있는 초안에만 붙음', ['review', 'ready'].includes(rLeg.st) && rLeg.cf > 0 && rLeg.srcNo === '07' && rLeg.srcPage === 3 && rLeg.htmlOk && rLeg.badgeNew && rLeg.badgeCount === 1, JSON.stringify(rLeg));

    const rU = await page.evaluate(() => ({
      circ: problemPdfNumberCandidate('①'), circ3: problemPdfNumberCandidate('③ 2'), zero: problemPdfNumberCandidate('001'), plain: problemPdfNumberCandidate('3'),
      sup: problemPdfJoinAnswerCells([{ text: '36 cm', x: 437, y: 363, w: 29, h: 10 }, { text: '2', x: 466, y: 366, w: 4, h: 7 }]),
      noSup: problemPdfJoinAnswerCells([{ text: '36 cm', x: 437, y: 363, w: 29, h: 10 }, { text: '2', x: 466, y: 363, w: 5, h: 10 }]),
      gapSpace: problemPdfJoinAnswerCells([{ text: 'a', x: 273, y: 710, w: 6, h: 10 }, { text: '≠ 2', x: 281, y: 710, w: 18, h: 10 }])
    }));
    check('원문자는 문항 번호 후보가 아니고 "001"·"3" 은 후보(기존 동작 유지)', rU.circ === null && rU.circ3 === null && rU.zero && rU.zero.n === 1 && rU.plain && rU.plain.n === 3, JSON.stringify(rU));
    check('답 이어붙이기: 작고 위로 올라 바짝 붙은 숫자만 위첨자, 같은 크기·같은 높이의 숫자는 그대로, 떨어진 칸은 공백', rU.sup === '36 cm²' && rU.noSup === '36 cm2' && rU.gapSpace === 'a ≠ 2', JSON.stringify(rU));

    // 같은 줄이라도 가로로 멀리 떨어진 글은 다른 덩어리: 제목 판정 단위 시험
    const rL = await page.evaluate(() => {
      const L = (arr) => problemPdfAnswerTextLines(arr.map(([text, x, y, w]) => ({ text, x, y, w })));
      const note = L([['※ 정답 및 해설은 다음 쪽에서 확인하세요.', 52, 52, 200], ['연습 자료', 509, 52, 40]]);
      const head = L([['정답 및 해설', 52, 784, 80], ['가상 시험 자료', 399, 786, 70]]);
      const glyph = L([['정', 37, 760, 12], ['답', 49, 760, 12], ['및', 62, 760, 12], ['해', 76, 760, 12], ['설', 88, 760, 12]]);
      const noW = L([['정답 및 해설', 52, 784], ['가상 시험 자료', 399, 786]]);
      const f = problemPdfIsAnswerPageText;
      return { noteLines: note.length, noteIsAnswerPage: f('x', note), headLines: head.length, headIsAnswerPage: f('x', head), glyphLines: glyph.length, glyphIsAnswerPage: f('x', glyph), noWLines: noW.length };
    });
    check('왼쪽 안내문과 오른쪽 끝 라벨은 다른 덩어리로 나뉘어 안내문이 제목으로 오인되지 않음, 제목+오른쪽 머리글은 제목 인정, 맞붙은 글자 조각은 한 줄 유지, 글 폭 정보가 없으면 종전처럼 한 줄', rL.noteLines === 2 && rL.noteIsAnswerPage === false && rL.headLines === 2 && rL.headIsAnswerPage === true && rL.glyphLines === 1 && rL.glyphIsAnswerPage === true && rL.noWLines === 1, JSON.stringify(rL));

    // 꼬리말 구역 규칙 단위 시험
    const rFt = await page.evaluate(() => {
      const H = 842, reg = { x0: 0, x1: 595, y0: 100 };
      const it = (str, yb, x = 66) => ({ str, transform: [12, 0, 0, 12, x, H - yb], height: 12 });
      const mkPlan = (pageNo, arr) => ({ pageNo, height: H, items: arr });
      const rec = problemPdfFooterRecurrence([mkPlan(1, [it('꼬리말', 790, 52)]), mkPlan(2, [it('다른 꼬리말', 790, 52)])]);
      const rec1 = problemPdfFooterRecurrence([mkPlan(1, [it('꼬리말', 790, 52)])]);
      const cut = (items, opts) => problemPdfTrailingCut(items, reg, H, opts);
      return {
        recurSame: rec(1, it('x', 790, 52), H), recurNear: rec(1, it('x', 792, 59), H), recurFar: rec(1, it('x', 796, 52), H), recurSinglePage: rec1(1, it('x', 790, 52), H),
        pageNoOnly: cut([it('3번', 700), it('본문', 700, 95), it('1 / 2', 790, 287)]),
        pageNoPlain: cut([it('본문', 700), it('- 3 -', 790, 287)]),
        recurFooter: cut([it('본문', 300), it('안내', 600), it('아래 꼬리말', 790, 52)], { recur: (i) => i.str === '아래 꼬리말' }),
        edgeBand: cut([it('본문', 500), it('안내', 600), it('맨 아래 글', 815)]),
        bodyInBand: cut([it('본문', 700), it('몇 줄 아래 본문 문장', 790)]),
        bodyNumberAbove: cut([it('본문', 600), it('12', 700)]),
      };
    });
    check('반복 위치 판정: 같은 위치·±3pt/±8pt 안은 반복, 그보다 멀면 아님, 한 쪽짜리 PDF 는 판단 안 함', rFt.recurSame === true && rFt.recurNear === true && rFt.recurFar === false && rFt.recurSinglePage === false, JSON.stringify(rFt));
    check('꼬리말 규칙: 쪽 번호 모양(1 / 2, - 3 -)·반복 위치 줄·맨 아래 4% 글은 큰 빈틈이 없어도 잘라냄', rFt.pageNoOnly && rFt.pageNoOnly.rule === 'footer' && rFt.pageNoOnly.trailLines === 1 && rFt.pageNoPlain && rFt.pageNoPlain.rule === 'footer' && rFt.recurFooter && rFt.recurFooter.rule === 'footer' && rFt.recurFooter.trailLines === 1 && rFt.recurFooter.lastBodyBottom > 600 && rFt.edgeBand && rFt.edgeBand.rule === 'footer' && rFt.edgeBand.trailLines === 1, JSON.stringify(rFt));
    check('아래 8% 구역이라도 쪽 번호 모양·반복·맨 아래 4%가 아닌 본문 문장, 쪽 중간의 숫자 줄은 자르지 않음', rFt.bodyInBand === null && rFt.bodyNumberAbove === null, JSON.stringify(rFt));

    // 정리 규칙 단위 시험: 조건이 안 맞으면 자르지 않는다
    const rT = await page.evaluate(() => {
      const H = 842, reg = { x0: 0, x1: 595, y0: 100 };
      const it = (str, topDownBaseline, x = 66) => ({ str, transform: [12, 0, 0, 12, x, H - topDownBaseline], height: 12 });
      const cut = (items) => problemPdfTrailingCut(items, reg, H);
      return {
        noteFooter: cut([it('3. 본문', 280), it('풀이 안내', 710), it('꼬리말', 810)]),
        smallGap: cut([it('3. 본문', 280), it('(1) 소문항', 360), it('(2) 소문항', 440)]),
        gapButMidPage: cut([it('3. 본문', 200), it('(1) 그림 뒤 소문항', 520)]),
        gapMidThenBottom: cut([it('3. 본문', 200), it('(1) 중간', 450), it('꼬리말', 810)]),
        footerOnlyNoBigGap: cut([it('3. 본문', 600), it('쪽 아래 문장', 790)]),
        edgeFooterNoGap: cut([it('3. 본문', 600), it('꼬리말', 810)]),
        onlyBody: cut([it('3. 본문', 280)]),
      };
    });
    check('안내·꼬리말이 큰 빈틈(25%↑) 뒤 아래 20% 구역에만 있으면 자를 위치를 찾음', rT.noteFooter && rT.noteFooter.trailLines === 2 && rT.noteFooter.trailStart > 690, JSON.stringify(rT));
    check('빈틈이 작거나, 큰 빈틈 뒤 글이 쪽 중간에 있거나, 본문만 있거나, 아래 8% 안의 평범한 문장(쪽 번호 모양·반복·맨 아래 4%가 아님)이면 자르지 않음(소문항·그림 뒤 글 보호)', rT.smallGap === null && rT.gapButMidPage === null && rT.onlyBody === null && rT.footerOnlyNoBigGap === null, JSON.stringify(rT));
    check('맨 아래 4% 안의 글은 큰 빈틈이 없어도 꼬리말로 잘림(규칙 B)', rT.edgeFooterNoGap && rT.edgeFooterNoGap.rule === 'footer' && rT.edgeFooterNoGap.trailLines === 1, JSON.stringify(rT));
    check('쪽 중간 글 뒤에 큰 빈틈이 있고 그 뒤가 아래 구역뿐이면 그 틈에서 자름(중간 글은 본문으로 유지)', rT.gapMidThenBottom && rT.gapMidThenBottom.trailLines === 1 && rT.gapMidThenBottom.lastBodyBottom > 440 && rT.gapMidThenBottom.lastBodyBottom < 470, JSON.stringify(rT));

    // 정답 글 정리 단위 시험: 위첨자·분수·동그라미 숫자는 유지, 전각 숫자·공백은 정리
    const rC = await page.evaluate(() => { const f = problemPdfCleanAnswerText; return { sq: f('24cm²'), cube: f('8 cm³'), half: f('½'), circ: f('③'), circMulti: f('① ③'), full: f('１２'), sp: f('  12    34 '), pre: f('정답: 17'), x2: f('x²+1'), sub: f('H₂O') }; });
    check('정답 글 정리: ², ³, ½, ①③, ₂ 는 그대로, 전각 숫자·공백만 정리, "정답:" 접두 제거', rC.sq === '24cm²' && rC.cube === '8 cm³' && rC.half === '½' && rC.circ === '③' && rC.circMulti === '① ③' && rC.full === '12' && rC.sp === '12 34' && rC.pre === '17' && rC.x2 === 'x²+1' && rC.sub === 'H₂O', JSON.stringify(rC));
  }

  // 15) 정답 표기 차이: PDF 정답표는 ③ 로 저장되지만 학생 답지 입력은 1~5 숫자 → 같은 답으로 채점되어야 한다
  const r15 = await page.evaluate(() => {
    const g = (p, a) => localGradeProblem(p, a).state;
    return {
      circledKeyNumericAnswer: g({ type: 'mc', answer: '③', acceptedAnswers: ['③'], points: 2 }, '3'),
      circledKeyWrongAnswer: g({ type: 'mc', answer: '③', acceptedAnswers: ['③'], points: 2 }, '4'),
      numericKeyCircledAnswer: g({ type: 'mc', answer: '3', acceptedAnswers: ['3'], points: 2 }, '③'),
      fullwidth: g({ type: 'short', answer: '17', acceptedAnswers: ['17'], points: 3 }, '１７'),
      spaces: g({ type: 'short', answer: '3/4', acceptedAnswers: ['3/4'], points: 3 }, ' 3 / 4 '),
      superscriptStaysStrict: g({ type: 'short', answer: 'x²', acceptedAnswers: ['x²'], points: 3 }, 'x2'),
      wrongShort: g({ type: 'short', answer: '17', acceptedAnswers: ['17'], points: 3 }, '18'),
    };
  });
  check('객관식 정답키 ③ ↔ 학생 입력 3 이 같은 답으로 채점됨(다른 번호는 오답)', r15.circledKeyNumericAnswer === 'correct' && r15.circledKeyWrongAnswer === 'wrong' && r15.numericKeyCircledAnswer === 'correct', JSON.stringify(r15));
  check('전각 숫자·공백 차이는 같은 답, 윗첨자 x² 와 x2 는 구분 유지, 틀린 답은 오답', r15.fullwidth === 'correct' && r15.spaces === 'correct' && r15.superscriptStaysStrict === 'wrong' && r15.wrongShort === 'wrong', JSON.stringify(r15));

  // 18) 정답 페이지 제목 판별(줄 단위): 제목 줄은 인정, 안내 문장 속 "정답표" 언급·긴 줄은 문항 쪽으로 유지(오인 방지)
  const r18 = await page.evaluate(() => {
    const f = problemPdfIsAnswerPageText;
    const L = (pairs) => problemPdfAnswerTextLines(pairs.map(([text, x, y]) => ({ text, x, y })));
    return {
      split: f('정 답   및   해 설  1   ③', L([['정', 37, 760], ['답', 49, 760], [' ', 60, 760], ['및', 62, 760], [' ', 73, 760], ['해', 76, 760], ['설', 87, 760], ['1', 49, 729], ['③', 76, 729]])),
      plain: f('정답 및 해설 1 ③ 2 17', ['정답 및 해설', '1 ③']),
      quick: f('빠른 정답 1 ③', ['빠른 정답', '1 ③']),
      withPageNo: f('수학 2-1 정답 및 해설 3', ['수학 2-1 정답 및 해설 3']),
      withRange: f('정답 및 해설 (1~3번)', ['정답 및 해설 (1~3번)']),
      noLinesCompat: f('정답표 안내', undefined),
      noteSentence: f('정답은 마지막 쪽의 정답표에서 확인하세요.', ['정답은 마지막 쪽의 정답표에서 확인하세요.']),
      noteSentence2: f('※ 이 자료는 정답표 연결을 확인하기 위해 만든 합성 자료입니다.', ['※ 이 자료는 정답표 연결을 확인하기 위해 만든 합성 자료입니다.']),
      questionSentence: f('3. 다음 식의 정답을 구하시오 x + 2 = 5', ['3. 다음 식의 정답을 구하시오 x + 2 = 5']),
      midGlue: f('1. 3x+2=11 의 x는? 정 답 표 시 는 하지 않는다', ['1.3x+2=11 의 x는?', '정답표시는 하지 않는다']),
      empty: f('', []),
      longLine: f('가나다 '.repeat(40) + '정답 및 해설', ['가나다'.repeat(40) + '정답및해설']),
    };
  });
  check('쪼개진 제목·일반 제목·"빠른 정답"·쪽번호/범위가 붙은 제목은 정답 페이지로 인정(줄 정보 없는 호출은 종전 방식 유지)', r18.split && r18.plain && r18.quick && r18.withPageNo && r18.withRange && r18.noLinesCompat, JSON.stringify(r18));
  check('안내 문장 속 "정답표", 문제 문장 속 "정답", 문장 중간에 붙은 조각, 빈 글, 긴 줄은 정답 페이지로 오인하지 않음', !r18.noteSentence && !r18.noteSentence2 && !r18.questionSentence && !r18.midGlue && !r18.empty && !r18.longLine, JSON.stringify(r18));

  // 18-2) 번호+본문이 한 덩어리인 줄의 문항 번호 후보: 인정/제외 경계 + 문항 영역 구성
  const r18b = await page.evaluate(() => {
    const c = (s) => { const r = problemPdfLeadingNumberCandidate(s); return r ? r.n : null; };
    const mk = (strs, h = 842) => ({ pageNo: 1, width: 595, height: h, isAnswerPage: false, items: [],
      candidates: problemPdfDetectNumberItems(strs.map(([str, y]) => ({ str, transform: [1, 0, 0, 1, 68, y] })), { width: 595, height: h }) });
    const seq = problemPdfBuildRegions([mk([['1. 첫째 문제', 700], ['2. 둘째 문제', 600], ['3. 셋째 문제', 500]])]);
    const noisy = problemPdfBuildRegions([mk([['7. 아무 문장', 700], ['2. 다른 문장', 600], ['9. 또 다른 문장', 500]])]);
    return {
      ok1: c('1. 18과 24의'), ok2: c('12) 다음 중'), okWide: c('３. 전각숫자'),
      decimal: c('3.14는 원주율'), year: c('2026. 10. 20 기준'), numOnly: c('1.'), noSpace: c('1.18'), zero: c('0. 가'), text: c('가. 나. 다.'),
      seqN: seq.regions.length, seqQ: seq.meta.quality, seqPrefix: seq.regions.map((r) => r.markerPrefixLen).join(),
      noisyQ: noisy.meta.quality,
    };
  });
  check('"숫자. 본문" / "숫자) 본문" 은 문항 번호로 인정(전각 숫자 포함)', r18b.ok1 === 1 && r18b.ok2 === 12 && r18b.okWide === 3, JSON.stringify(r18b));
  check('소수(3.14)·연도·번호만 있는 줄·공백 없는 붙임·0번·글자 번호는 문항 번호로 보지 않음', r18b.decimal === null && r18b.year === null && r18b.numOnly === null && r18b.noSpace === null && r18b.zero === null && r18b.text === null, JSON.stringify(r18b));
  check('연속한 1·2·3번 줄은 문항 3개·경계품질 100%, 번호 접두 길이가 영역에 기록됨', r18b.seqN === 3 && r18b.seqQ === 1 && r18b.seqPrefix === '3,3,3', JSON.stringify(r18b));
  check('번호가 연속되지 않는(7·2·9) 줄은 경계품질이 낮게 평가돼 종전처럼 AI 분리로 넘어감(.65 미만)', r18b.noisyQ < .65, JSON.stringify(r18b));


  // 12) 원장 화면: 저장소 세트도 채점 버튼이 보이고, 대기 일괄 채점이 정답/오답/미확정을 구분해 저장
  const r12 = await page.evaluate(async ([aid]) => {
    const out = {};
    session = { mode: 'director' };
    const a = db.assignments[aid];
    out.source = a.source;
    const ps = a.problems;
    const mk = (answers, extra = {}) => ({ assignmentId: aid, originalAnswers: answers, autoResults: ps.map(() => ({ state: 'grading', earnedPoints: null })), wrongReasons: {}, learningCompletedAt: null, review: null, ...extra });
    const right = ps.map((p) => (p.type === 'mc' ? '3' : '17')), wrong = ps.map(() => '999');
    const subs = { stu_a: mk(right), stu_b: mk(wrong),
      stu_c: mk(wrong, { autoResults: ps.map(() => ({ state: 'correct', earnedPoints: 9 })), review: { finalizedAt: 'x', finalResults: ps.map(() => ({ state: 'correct', earnedPoints: 9, maxPoints: 9 })) } }) };
    db.answerSubmissions = {};
    for (const [stu, v] of Object.entries(subs)) { const id = `${aid}_${stu}`; window.__store.answerSubmissions[id] = { studentId: stu, ...v }; db.answerSubmissions[id] = { id, studentId: stu, ...v }; }
    a.studentIds = ['stu_a', 'stu_b', 'stu_c'];
    window.__store.assignments[aid] = { ...window.__store.assignments[aid], studentIds: a.studentIds };
    const cls = { id: a.classId };
    const html = renderClassAnswerSheetAdmin(cls);
    out.hasGradeBtn = html.includes("directorGradeAnswerSubmission('" + aid + "','stu_a')");
    out.noWaitBadge = !html.includes('서버채점 연결 대기');
    out.pendingCount = html.includes('채점 대기 2명') && html.includes("directorGradeAllPending('" + aid + "')");
    out.pendingIds = pendingGradingStudentIds(a).join();
    await directorGradeAllPending(aid);
    const st = (stu) => window.__store.answerSubmissions[`${aid}_${stu}`].autoResults.map((r) => r.state).join();
    out.a = st('stu_a'); out.b = st('stu_b'); out.c = st('stu_c');
    out.after = pendingGradingStudentIds(a).length;
    out.cReview = window.__store.answerSubmissions[`${aid}_stu_c`].review.finalizedAt;
    // 다시 눌러도 이미 채점된 제출은 그대로(대기 없음 안내)
    await directorGradeAllPending(aid);
    out.aAgain = st('stu_a');
    return out;
  }, [r4.aid]);
  check('저장소 세트도 "○/× 채점" 버튼이 보이고 "서버채점 연결 대기" 표시는 사라짐', r12.hasGradeBtn && r12.noWaitBadge, JSON.stringify(r12));
  check('채점 대기 현황(2명)과 일괄 채점 버튼 표시, 최종확인 끝난 제출은 대기에서 제외', r12.pendingCount && r12.pendingIds === 'stu_a,stu_b', JSON.stringify(r12));
  check('대기 일괄 채점: 정답 제출=correct, 오답 제출=wrong', /^correct(,correct)*$/.test(r12.a) && /^wrong(,wrong)*$/.test(r12.b), JSON.stringify(r12));
  check('이미 최종확인한 제출은 건드리지 않음, 대기 0명, 재실행해도 결과 유지', /^correct(,correct)*$/.test(r12.c) && r12.cReview === 'x' && r12.after === 0 && r12.aAgain === r12.a, JSON.stringify(r12));

  // 13) 학습보관함 자산 → 문제저장소 연결(운영 Firestore 없이 메모리 가짜 데이터)
  const r13 = await page.evaluate(async () => {
    const keyMeta = operationalProblemMetaFromSolution({ id: 'sol_existing', courseId: 'c1', book: '쎈', page: '12', problemNo: '3' });
    window.__store.problems = { canonical1: { problemText: '기존 정식 문항', sourceKeys: [keyMeta.sourceKey], status: 'active' } };
    window.__store.problemDrafts = {};
    window.__store.problemSources = {};
    window.__store.solutionPhotos = { sol_existing: { courseId: 'c1', book: '쎈', page: '12', problemNo: '3' } };
    const linked = await syncSolutionPhotoToProblemRepo('sol_existing', window.__store.solutionPhotos.sol_existing);
    const canonicalLink = window.__store.solutionPhotos.sol_existing.problemId;
    const candidateMeta = operationalProblemMetaFromSolution({ id: 'sol_candidate', courseId: 'c1', book: '쎈', page: '13', problemNo: '4' });
    window.__store.solutionPhotos.sol_candidate = { courseId: 'c1', book: '쎈', page: '13', problemNo: '4' };
    const first = await syncSolutionPhotoToProblemRepo('sol_candidate', window.__store.solutionPhotos.sol_candidate);
    const draftId = first.problemDraftId;
    const draft1 = window.__store.problemDrafts[draftId];
    const second = await syncSolutionPhotoToProblemRepo('sol_candidate', window.__store.solutionPhotos.sol_candidate);
    const draft2 = window.__store.problemDrafts[draftId];
    // 다른 출처(학생 질문)가 먼저 만든 후보에 학습보관함 풀이 사진이 나중에 연결되는 경우
    const mixedKey = textbookSourceKey('c1', '쎈', '14', '2');
    window.__store.problemDrafts.mixedDraft = { sourceKey: mixedKey, status: 'review', origins: [{ type: 'student-question', id: 'q_mixed' }], originTypes: ['student-question'], solutionAssetIds: [] };
    window.__store.solutionPhotos.sol_mixed = { courseId: 'c1', book: '쎈', page: '14', problemNo: '2' };
    const mixed = await syncSolutionPhotoToProblemRepo('sol_mixed', window.__store.solutionPhotos.sol_mixed);
    const mixedDraft = window.__store.problemDrafts.mixedDraft;
    return {
      linkedStatus: linked.status, canonicalLink,
      candidateStatus: first.status, candidateRef: window.__store.solutionPhotos.sol_candidate.problemDraftId,
      sourceKeyMatches: draft1 && draft1.sourceKey === candidateMeta.sourceKey,
      originRecorded: draft1 && (draft1.origins || []).some(o => o.type === 'learning-library' && o.id === 'sol_candidate'),
      assetRecorded: draft1 && (draft1.solutionAssetIds || []).includes('sol_candidate'),
      noFalseProblem: Object.keys(window.__store.problems).length === 1,
      repeatSameCandidate: second.problemDraftId === draftId && Object.keys(window.__store.problemDrafts).length === 2,
      repeatOriginUnique: (draft2.origins || []).filter(o => o.type === 'learning-library' && o.id === 'sol_candidate').length === 1,
      mixedLinked: mixed.problemDraftId === 'mixedDraft' && window.__store.solutionPhotos.sol_mixed.problemDraftId === 'mixedDraft',
      mixedAssetRecorded: (mixedDraft.solutionAssetIds || []).includes('sol_mixed'),
      mixedOriginsPreserved: (mixedDraft.origins || []).some(o => o.type === 'student-question' && o.id === 'q_mixed') && (mixedDraft.origins || []).some(o => o.type === 'learning-library' && o.id === 'sol_mixed')
    };
  });
  check('학습보관함 자산의 교재·쪽·문항 키가 기존 정식 문제와 일치하면 problemId로 연결', r13.linkedStatus === 'linked' && r13.canonicalLink === 'canonical1', JSON.stringify(r13));
  check('정식 문제가 아직 없으면 학습보관함 자료는 자동 정식화하지 않고 검토 후보로 연결', r13.candidateStatus === 'candidate' && !!r13.candidateRef && r13.noFalseProblem && r13.sourceKeyMatches && r13.originRecorded && r13.assetRecorded, JSON.stringify(r13));
  check('같은 학습보관함 항목을 다시 동기화해도 후보·출처 연결이 중복 생성되지 않음', r13.repeatSameCandidate && r13.repeatOriginUnique, JSON.stringify(r13));
  check('다른 출처가 먼저 만든 후보에 학습보관함 자산을 나중에 연결해도 자산 ID와 양쪽 출처를 함께 보존', r13.mixedLinked && r13.mixedAssetRecorded && r13.mixedOriginsPreserved, JSON.stringify(r13));

  // 14) 학습보관함 풀이자료는 질문의 교재·쪽·문항이 정확히 일치할 때만 표시
  const r14 = await page.evaluate(() => {
    const q = { id: 'q_exact', sourceType: 'TEXTBOOK', sourceCourseId: 'c1', sourceBook: '쎈', sourcePage: '12', sourceProblemNo: '3' };
    db.questions = [q];
    db.solutionPhotos = [
      { id: 'sol_exact', courseId: 'c1', book: '쎈', page: '12', problemNo: '3', photo: { storageKey: 'solution/exact.jpg' } },
      { id: 'sol_wrong_page', courseId: 'c1', book: '쎈', page: '13', problemNo: '3', photo: { storageKey: 'solution/wrong-page.jpg' } },
      { id: 'sol_wrong_no', courseId: 'c1', book: '쎈', page: '12', problemNo: '4', photo: { storageKey: 'solution/wrong-no.jpg' } }
    ];
    const matches = autoSolutionMatchesForQuestion(q);
    const html = renderAutoSolutionMatches(q.id);
    return { ids: matches.map(x => x.id), htmlExact: html.includes('sol_exact'), htmlExcludesNear: !html.includes('sol_wrong_page') && !html.includes('sol_wrong_no'), directorOnly: html.includes('원장 화면에만 표시') };
  });
  check('학습보관함 자료는 교재·쪽·문항이 정확히 일치하는 질문에만 연결 후보로 나옴', r14.ids.join() === 'sol_exact' && r14.htmlExact && r14.htmlExcludesNear && r14.directorOnly, JSON.stringify(r14));

  check('페이지 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(`PROBLEM-REPO SUMMARY total=${results.length} pass=${results.length - bad} fail=${bad}`);
  process.exit(bad ? 1 : 0);
})();
