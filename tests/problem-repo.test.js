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
    const mk = (id, no) => ({ id, status: 'review', problemText: '삼각형 ABC 에서 외심은?', problemNo: no, grade: '중2', semester: '1학기', majorUnit: '삼각형의 성질', middleUnit: '삼각형의 외심과 내심', type: 'short', answer: '5', points: 2, cropKey: 'crop/' + id, cropHash: 'samehash0001', createdAt: new Date().toISOString() });
    const d1 = mk('draftA', '1'), d2 = mk('draftB', '1');
    for (const d of [d1, d2]) window.__store.problemDrafts = { ...(window.__store.problemDrafts || {}), [d.id]: d };
    problemStore.ingest.drafts = [d1, d2]; problemStore.ingest.sources = []; problemStore.ingest.loaded = true;
    const before = Object.keys(window.__store.problems).length;
    const a = await saveProblemDraft('draftA', { silent: true });
    const b = await saveProblemDraft('draftB', { silent: true });
    const after = Object.keys(window.__store.problems).length;
    const pid = a.problemId;
    let html = ''; try { session = { mode: 'director' }; problemStore.tab = 'ingest'; html = renderProblemIngest(); } catch (e) { html = 'ERR ' + e.message; }
    return { a: a.status, b: b.status, added: after - before, key: window.__store.problemKeys[pid] && window.__store.problemKeys[pid].answer,
      draftSaved: window.__store.problemDrafts.draftA.status, publicHasAnswer: JSON.stringify(window.__store.problems[pid]).includes('"answer"'), htmlOk: typeof html === 'string' && !/^ERR/.test(html) && html.length > 200, html: html.slice(0, 80) };
  });
  check('수집 초안 저장 → 저장소 문제 1건 신규 + 정답키 저장', r7.a === 'saved' && r7.key === '5', JSON.stringify(r7));
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
          answers: drafts.map((d) => ({ no: d.problemNo, a: d.answer, m: d.answerMethod, t: d.type })).sort((x, y) => String(x.no).localeCompare(String(y.no))),
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

  check('페이지 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(`PROBLEM-REPO SUMMARY total=${results.length} pass=${results.length - bad} fail=${bad}`);
  process.exit(bad ? 1 : 0);
})();
