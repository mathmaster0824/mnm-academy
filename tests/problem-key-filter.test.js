/* 문제저장소 "주요 문항" 표시·복합 필터 시험.
 * 브라우저(Playwright) + 메모리 Firestore 가짜(운영 Firebase 접속 없음, 가짜 문제 데이터만). 실행: node tests/problem-key-filter.test.js
 * 종료 코드: 0 = 모두 통과, 1 = 실패 있음. 운영 데이터 동작은 이 시험으로 확인되지 않는다. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`KEY-FILTER ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };
const pad = (n) => 'p' + String(n).padStart(3, '0');

// ---- 가짜 문제 200개. 전부 합성 데이터. 조건을 하나씩만 빼먹는 "근접 오답"을 섞어 교집합을 정확히 시험한다. ----
// 목표 조건: 중1 · 1학기 · 3단원(대단원 "3. 문자와 식") · 주제(중단원 "문자와 식") · 주요 문항 · 기출. 결과는 첫 60개 밖(131 이후)에 있다.
const TARGET = { grade: '중1', semester: '1학기', majorUnit: '3. 문자와 식', middleUnit: '문자와 식' };
function buildDocs() {
  const docs = {};
  for (let i = 1; i <= 200; i++) docs[pad(i)] = { problemText: `가상 문제 ${pad(i)}`, type: 'short', points: 1, grade: ['중1', '중2', '중3'][i % 3], semester: i % 2 ? '1학기' : '2학기', majorUnit: '2. 정수와 유리수', middleUnit: '정수', status: 'active', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', answerKeyNote: undefined };
  const put = (n, o) => { docs[pad(n)] = { ...docs[pad(n)], ...o }; };
  const T = (o = {}) => ({ ...TARGET, ...o });
  [131, 151, 191].forEach((n) => put(n, T({ isKeyProblem: true, isPastExam: true })));         // 정답 3개
  put(131, { problemText: '가상 문제 계수를 구하시오' });                                        // 검색어 시험용
  put(140, T({ middleUnit: '일차방정식', isKeyProblem: true, isPastExam: true }));              // 주제만 다름
  put(141, T({ majorUnit: '4. 좌표', isKeyProblem: true, isPastExam: true }));                  // 단원만 다름
  put(142, T({ semester: '2학기', isKeyProblem: true, isPastExam: true }));                     // 학기만 다름
  put(143, T({ grade: '중2', isKeyProblem: true, isPastExam: true }));                          // 학년만 다름
  [144, 160].forEach((n) => put(n, T({ isKeyProblem: true })));                                 // 주요 문항이지만 기출 아님(필드 없음)
  put(165, T({ isKeyProblem: true, isPastExam: false }));                                       // 기출 false 명시
  [145, 161].forEach((n) => put(n, T({ isPastExam: true })));                                   // 기출이지만 주요 문항 아님
  put(146, T());                                                                                 // 표시 없음
  put(147, T({ isKeyProblem: false, isPastExam: true }));                                       // 해제된 주요 문항(false)
  [10, 20, 30, 190, 199].forEach((n) => put(n, { isKeyProblem: true }));                        // 다른 단원의 주요 문항(60개 안·밖)
  return docs;
}
// 주요 문항 전체(=isKeyProblem true)
const KEY_IDS = [10, 20, 30, 131, 140, 141, 142, 143, 144, 151, 160, 165, 190, 191, 199].map(pad);
const PAST_IDS = [131, 140, 141, 142, 143, 145, 147, 151, 161, 191].map(pad);
const EXPECT_ALL = [131, 151, 191].map(pad);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  const setup = async (docs) => {
    await page.evaluate((docs) => {
      session = { mode: 'director' };
      document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
      Object.keys(docs).forEach((k) => { Object.keys(docs[k]).forEach((f) => { if (docs[k][f] === null) delete docs[k][f]; }); });
      window.__store.problems = {};
      for (const [id, d] of Object.entries(docs)) { d.searchTokens = problemSafeSearchTokens(problemSearchTokens(d)); window.__store.problems[id] = d; }
      window.__before = JSON.stringify(window.__store.problems);
      window.__reads = 0; window.__updates = []; window.__getDelay = 0; window.__failUpdate = null; window.__updDelay = 0;
      if (!window.__wrapped) {
        window.__wrapped = true;
        const oc = fsdb.collection.bind(fsdb);
        const wrapQ = (q) => { const w = Object.create(q); ['where', 'orderBy', 'limit', 'startAfter'].forEach((m) => { w[m] = (...a) => wrapQ(q[m](...a)); });
          w.get = async () => { window.__reads++; if (window.__getDelay) await new Promise((r) => setTimeout(r, window.__getDelay)); return q.get(); };
          w.doc = (id) => { const d = q.doc(id), u = d.update; return Object.assign(Object.create(d), { update: async (data) => { window.__updates.push({ id, data: JSON.parse(JSON.stringify(data)) }); if (window.__updDelay) await new Promise((r) => setTimeout(r, window.__updDelay)); if (window.__failUpdate) throw Object.assign(new Error(window.__failUpdate.message), { code: window.__failUpdate.code }); return u(data); } }); };
          return w; };
        fsdb.collection = (c) => c === 'problems' ? wrapQ(oc(c)) : oc(c);
      }
      problemStore.items = []; problemStore.selected = new Set(); problemStore.lastDoc = null; problemStore.loaded = false; problemStore.loading = false; problemStore.queryToken = '';
      problemStore.exhausted = false; problemStore.hasMore = false; problemStore.fallback = false; problemStore.keySave = {}; problemStore.tab = 'library';
      problemStore.filter = { q: '', grade: '', semester: '', major: '', middle: '', concept: '', geometry: '', ask: '', skill: '', key: false, past: false };
      window.render = () => { document.getElementById('mainArea').innerHTML = renderProblemRepository(); };
      window.render();
    }, docs);
    await page.waitForFunction(() => problemStore.loaded && !problemStore.loading);
  };
  const settle = async () => { await page.waitForTimeout(320); await page.waitForFunction(() => !problemStore.loading && !problemStore.pendingReset && !problemStore.pendingMore, null, { timeout: 8000 }); await page.waitForTimeout(60); };
  const shown = () => page.$$eval('[data-pkey]', (els) => els.map((e) => e.getAttribute('data-pkey')));
  const chip = (k) => page.locator(`[data-pf="${k}"]`);
  const storeDoc = (id) => page.evaluate((id) => window.__store.problems[id] ? JSON.parse(JSON.stringify(window.__store.problems[id])) : null, id);
  const setSel = async (label, value) => { await page.locator(`label:has-text("${label}") select`).selectOption(value); };
  const setTxt = async (label, value) => { await page.locator(`label:has-text("${label}") input`).fill(value); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rowBadge = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-pkey="${id}"]`); return b ? b.closest('div[style*="padding:12px"]').querySelectorAll('.badge.key').length : -1; }, id);

  // ───────── 1) 기존 문제에 주요 문항 표시·해제 ─────────
  await setup(buildDocs());
  const baseline = await storeDoc(pad(2));
  check('표시 값이 없는 기존 문제는 일반 문항으로 보임(별표 꺼짐·배지 없음)', baseline.isKeyProblem === undefined && (await page.locator(`[data-pkey="${pad(2)}"]`).getAttribute('aria-pressed')) === 'false' && (await rowBadge(pad(2))) === 0);
  await page.evaluate(() => { window.__updDelay = 400; });
  await page.locator(`[data-pkey="${pad(2)}"]`).click();
  await page.waitForTimeout(120);
  const savingTxt = await page.locator(`[data-pkey="${pad(2)}"]`).textContent(), savingDis = await page.locator(`[data-pkey="${pad(2)}"]`).isDisabled();
  await page.locator(`[data-pkey="${pad(2)}"]`).click({ force: true, timeout: 500 }).catch(() => {});   // 저장 중 연속 클릭
  await page.evaluate(() => toggleProblemKey('p002'));                                                    // 코드로도 한 번 더
  await page.waitForTimeout(700);
  const upd1 = await page.evaluate(() => window.__updates.slice());
  const after1 = await storeDoc(pad(2));
  check('눌린 직후 "저장 중…" 표시와 버튼 잠금, 연속 클릭에도 저장은 정확히 1번', /저장 중/.test(savingTxt) && savingDis && upd1.length === 1, JSON.stringify({ savingTxt, savingDis, n: upd1.length }));
  check('저장 성공 후 별표·"★ 주요 문항" 배지·성공 안내 표시, 저장된 값 isKeyProblem=true', after1.isKeyProblem === true && (await page.locator(`[data-pkey="${pad(2)}"]`).getAttribute('aria-pressed')) === 'true' && /저장했어요/.test(await page.locator('.pkey-msg.ok').first().textContent()) && (await rowBadge(pad(2))) === 1);
  const onlyTwo = Object.keys(upd1[0].data).sort().join() === 'isKeyProblem,keyProblemUpdatedAt';
  const { isKeyProblem: _a, keyProblemUpdatedAt: _b, ...rest1 } = after1, { ...restBase } = baseline;
  check('부분 업데이트: 보낸 필드는 isKeyProblem·keyProblemUpdatedAt 둘뿐이고 나머지 문서 내용(본문·정답 관련·출처·검색토큰)은 그대로', onlyTwo && same(rest1, restBase), JSON.stringify(upd1[0].data));
  await page.evaluate(() => { window.__updDelay = 0; });
  await page.locator(`[data-pkey="${pad(2)}"]`).click(); await page.waitForTimeout(150);
  const off = await storeDoc(pad(2));
  check('다시 누르면 해제(isKeyProblem=false), 배지 사라짐, 해제 안내', off.isKeyProblem === false && (await rowBadge(pad(2))) === 0 && /해제했어요/.test(await page.locator('.pkey-msg.ok').first().textContent()));
  // 저장 실패: 화면과 저장소 모두 바뀌지 않고 실패가 표시되며, 재시도하면 성공
  await page.evaluate(() => { window.__failUpdate = { code: 'permission-denied', message: 'Missing or insufficient permissions.' }; });
  await page.locator(`[data-pkey="${pad(3)}"]`).click(); await page.waitForTimeout(200);
  const f3 = await storeDoc(pad(3));
  const failMsg = await page.locator('.pkey-msg.err').first().textContent();
  check('저장 실패: 실패 사유 표시, 별표는 켜지지 않음, 저장소 문서 불변, 성공 안내 없음', /저장 실패/.test(failMsg) && /permission-denied/.test(failMsg) && f3.isKeyProblem === undefined && (await page.locator(`[data-pkey="${pad(3)}"]`).getAttribute('aria-pressed')) === 'false' && (await page.locator('[data-pkey="p003"]').locator('xpath=..').locator('.pkey-msg.ok').count()) === 0, failMsg);
  await page.evaluate(() => { window.__failUpdate = null; });
  await page.locator(`[data-pkey="${pad(3)}"]`).click(); await page.waitForTimeout(150);
  check('실패 뒤 다시 누르면 저장되고 실패 문구는 사라짐', (await storeDoc(pad(3))).isKeyProblem === true && (await page.locator(`.pkey-msg.err`).count()) === 0);
  // 없는 문서 ID: 새 문서를 만들지 않음
  await page.evaluate(() => { problemStore.items.unshift({ id: 'ghost_id', problemText: '유령', type: 'short' }); window.render(); });
  const countBefore = await page.evaluate(() => Object.keys(window.__store.problems).length);
  await page.locator('[data-pkey="ghost_id"]').click(); await page.waitForTimeout(200);
  check('존재하지 않는 문제 ID에는 표시를 만들지 않음(문서 수 불변, 실패 표시)', (await page.evaluate(() => Object.keys(window.__store.problems).length)) === countBefore && (await page.evaluate(() => window.__store.problems.ghost_id)) === undefined && (await page.locator('.pkey-msg.err').count()) === 1);
  await page.evaluate(() => { problemStore.items = problemStore.items.filter((x) => x.id !== 'ghost_id'); });

  // ───────── 2) 주요 문항 필터 단독(저장소 전체, 첫 60개 밖 포함) ─────────
  await setup(buildDocs());
  const firstPageIds = await shown();
  await chip('key').click(); await settle();
  const keyShown = await shown();
  check('주요 문항 단독 필터: 저장소 전체(200개 중 첫 60개 밖 포함)에서 주요 문항만 모두 표시', same(keyShown.slice().sort(), KEY_IDS.slice().sort()) && firstPageIds.length === 60, JSON.stringify({ keyShown }));
  check('요약: 조건에 맞는 문제 15개 · 저장소 전체 검사 완료, 칩은 눌림 상태', /\b15\b/.test(await page.locator('[role=status]').first().textContent()) && /전체 검사 완료/.test(await page.locator('[role=status]').first().textContent()) && (await chip('key').getAttribute('aria-pressed')) === 'true');
  await chip('key').click(); await settle();
  check('같은 칩을 다시 누르면 개별 해제되어 전체 목록(첫 60개)으로 돌아옴', (await shown()).length === 60 && (await chip('key').getAttribute('aria-pressed')) === 'false');

  // ───────── 3) 학년·학기·단원·주제 + 주요 문항 ─────────
  await chip('key').click(); await settle();
  await setSel('학년', '중1'); await settle();
  await setSel('학기', '1학기'); await settle();
  await setTxt('대단원', '3. 문자와 식'); await settle();
  await setTxt('중단원', '문자와 식'); await settle();
  const combo = await shown();
  check('중1+1학기+3단원+문자와 식+주요 문항: 모든 조건을 만족하는 문제만(131·144·151·160·165·191)', same(combo.slice().sort(), [131, 144, 151, 160, 165, 191].map(pad)), JSON.stringify(combo));
  check('조건 하나를 빼먹는 근접 문제(학년·학기·단원·주제만 다름, 주요 문항 아님)는 결과에 없음', ![140, 141, 142, 143, 146, 145, 161, 147].map(pad).some((x) => combo.includes(x)));
  await setSel('학기', ''); await settle();
  check('학기 조건만 해제하면 2학기 문제(142)가 추가됨 — 각 필터가 개별 해제됨', (await shown()).includes(pad(142)) && (await shown()).length === combo.length + 1);
  await setSel('학기', '1학기'); await settle();

  // ───────── 4) 주요 문항 + 기출 ─────────
  await chip('past').click(); await settle();
  const all6 = await shown();
  check('중1+1학기+3단원+문자와 식+주요 문항+기출: 모든 조건의 교집합(131·151·191)', same(all6.slice().sort(), EXPECT_ALL), JSON.stringify(all6));
  check('결과 3건은 첫 60개 밖에 있는 문서이고(131 이후) 기출 false·필드 없음·주요 문항 아님은 제외', all6.every((id) => Number(id.slice(1)) > 60) && !all6.includes(pad(165)) && !all6.includes(pad(144)) && !all6.includes(pad(145)));
  await page.evaluate(() => { problemStore.filter = { ...problemStore.filter, key: false, grade: '', semester: '', major: '', middle: '' }; loadProblemPage(true); }); await settle();
  check('기출 단독 필터: isPastExam=true 인 문서만(필드 없는 문서를 기출로 간주하지 않음)', same((await shown()).slice().sort(), PAST_IDS.slice().sort()), JSON.stringify(await shown()));

  // ───────── 5) 검색어·더 보기(페이지)·정렬과 필터 ─────────
  await page.evaluate(() => { problemStore.filter = { q: '', grade: '', semester: '', major: '', middle: '', concept: '', geometry: '', ask: '', skill: '', key: false, past: false }; loadProblemPage(true); }); await settle();
  await chip('key').click(); await settle();
  await chip('past').click(); await settle();
  await setSel('학년', '중1'); await settle();
  await setTxt('검색', '계수'); await settle();
  check('검색어("계수")+중1+주요 문항+기출: 본문에 검색어가 있는 131 한 건만', same(await shown(), [pad(131)]), JSON.stringify(await shown()));
  await setTxt('검색', ''); await chip('past').click(); await settle();
  // 많은 주요 문항: 페이지 이동(더 찾기)
  const many = buildDocs();
  for (let i = 1; i <= 200; i++) if (i % 3 !== 0) many[pad(i)].isKeyProblem = true;          // 대부분이 주요 문항(60개 초과)
  await setup(many);
  const manyKey = Object.keys(many).filter((k) => many[k].isKeyProblem === true);
  await chip('key').click(); await settle();
  const pageA = await shown();
  const btn = page.locator('button:has-text("조건에 맞는 문제 더 찾기")');
  check(`주요 문항이 ${manyKey.length}개일 때 첫 화면은 60개 이상, "더 찾기" 버튼 표시, 아직 전체 검사 아님`, pageA.length >= 60 && pageA.length < manyKey.length && (await btn.count()) === 1 && !/전체 검사 완료/.test(await page.locator('[role=status]').first().textContent()), String(pageA.length));
  let guard = 0; while ((await btn.count()) && guard++ < 6) { await btn.click(); await settle(); }
  const pageAll = await shown();
  check(`"더 찾기"를 이어가면 ${manyKey.length}개 전부(중복·누락 없음) 표시되고 버튼이 사라지며 전체 검사 완료`, pageAll.length === manyKey.length && new Set(pageAll).size === manyKey.length && same(pageAll.slice().sort(), manyKey.slice().sort()) && (await btn.count()) === 0 && /전체 검사 완료/.test(await page.locator('[role=status]').first().textContent()), String(pageAll.length));
  check('정렬: 표시 순서는 저장소 순서(문서 ID 오름차순) 그대로 유지(필터를 켜도 뒤섞이지 않음)', same(pageAll, pageAll.slice().sort()));
  // 주요 문항 134여 개 중 앞쪽 60개에는 단원 조건에 맞는 문제가 없을 때: 버튼을 누르지 않아도 서버 페이지를 이어 읽어 저장소 끝까지 찾는다
  await setup(many);
  await chip('key').click(); await settle();
  await setTxt('대단원', '3. 문자와 식'); await settle();
  const deep = await shown(), expDeep = manyKey.filter((k) => String(many[k].majorUnit).includes('3. 문자와 식')).sort();
  check('주요 문항 + 대단원(3. 문자와 식): 앞쪽 60개 주요 문항에 일치가 없어도 자동으로 이어 검사해 뒤쪽 일치 문제를 모두 찾음', expDeep.length >= 6 && same(deep.slice().sort(), expDeep) && Math.min(...deep.map((x) => Number(x.slice(1)))) > 100, JSON.stringify({ n: deep.length, exp: expDeep.length }));
  await setTxt('대단원', ''); await settle();
  // 더 보기 중 조건 추가: 서버 조건은 그대로이고 화면 조건만 바뀜 → 일치 문제가 모자라면 이어서 검사
  await setSel('학년', '중1'); await settle();
  const g1 = await shown();
  const exp1 = manyKey.filter((k) => many[k].grade === '중1').sort();
  check('주요 문항 + 학년(중1) 추가: 저장소 전체에서 두 조건 모두 만족하는 문제만', same(g1.slice().sort(), exp1) && g1.length === exp1.length, `${g1.length}/${exp1.length}`);
  // 빠른 연속 변경(저장소 읽기 지연 중): 마지막 선택이 최종 결과
  await page.evaluate(() => { window.__getDelay = 150; });
  await chip('key').click(); await chip('key').click(); await chip('key').click();    // 해제→설정→해제
  await settle(); await page.evaluate(() => { window.__getDelay = 0; });
  check('읽기 지연 중 필터를 빠르게 바꿔도 마지막 선택(주요 문항 해제 + 중1)의 결과와 일치', (await chip('key').getAttribute('aria-pressed')) === 'false' && same((await shown()).slice().sort(), many && Object.keys(many).filter((k) => many[k].grade === '중1').sort().slice(0, (await shown()).length)), String((await shown()).length));
  // 조건 모두 해제
  await page.locator('button:has-text("조건 모두 해제")').click(); await settle();
  check('"조건 모두 해제": 모든 필터·칩이 꺼지고 전체 목록으로 돌아옴', (await chip('key').getAttribute('aria-pressed')) === 'false' && (await shown()).length === 60 && (await page.locator('button:has-text("조건 모두 해제")').count()) === 0);

  // 기출 데이터가 저장소에 전혀 없을 때: 임의로 기출 처리하지 않고 안내
  const noPast = buildDocs(); Object.values(noPast).forEach((d) => delete d.isPastExam);
  await setup(noPast); await chip('past').click(); await settle();
  check('기출 표시 데이터가 없으면 기출 필터 결과 0건 + 데이터 미등록 안내(어떤 문제도 기출로 간주하지 않음)', (await shown()).length === 0 && /기출로 표시된 문제가 저장소에 없어요/.test(await page.locator('.empty').textContent()));
  // 서버 검색 실패 시: 전체 검색이 아니라고 화면에 표시
  await setup(buildDocs());
  await page.evaluate(() => { const o = fsdb.collection; fsdb.collection = (c) => { const q = o(c); if (c !== 'problems') return q; const w = Object.create(q); w.where = () => { throw new Error('index required'); }; return w; }; });
  await chip('key').click(); await settle();
  check('서버 검색이 실패하면 "전체 검색 아님"을 표시(일부만 검사한 결과를 전체 결과처럼 보이지 않음)', /전체 검색 아님/.test(await page.locator('[role=status]').first().textContent()));
  await page.evaluate(() => { fsdb.collection = window.__origCol || fsdb.collection; });

  // ───────── 6) 학생 과제 출제·기존 기능 회귀 ─────────
  await page.reload(); await page.waitForTimeout(800);
  const docs6 = buildDocs(); docs6[pad(131)].isKeyProblem = true;
  await page.evaluate((docs) => {
    session = { mode: 'director' };
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    window.__store.problems = docs;
    db.students = [{ id: 'stu_a', name: '가짜A', code: '1111', classId: 'cls_x', status: 'active', grade: '중1' }];
    db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: ['stu_a'] }];
    problemStore.items = [{ id: 'p131', ...docs.p131 }, { id: 'p151', ...docs.p151 }]; problemStore.selected = new Set(['p131', 'p151']);
    window.render = () => {}; window.prompt = (m, d) => (/반 이름/.test(m) ? 'X반' : 'TEST'); window.alert = () => {};
  }, docs6);
  await page.evaluate(() => assignSelectedProblems()); await page.waitForTimeout(150);
  const asg = await page.evaluate(() => Object.values(window.__store.assignments || {})[0]);
  check('과제 출제는 기존대로 동작: 문제 2개 배정, 반 학생에게 연결', asg && asg.problems.length === 2 && asg.studentIds.join() === 'stu_a' && asg.source === 'problem-repository', JSON.stringify(asg));
  check('배정 데이터(학생에게 내려가는 문서)에는 주요 문항·기출 표시, 정답·풀이가 들어가지 않음(problemId·no·type·points만)', asg.problems.every((p) => Object.keys(p).sort().join() === 'no,points,problemId,type') && !/isKeyProblem|isPastExam|answer|explanation/.test(JSON.stringify(asg)), JSON.stringify(asg.problems[0]));
  const stuHtml = await page.evaluate(() => { const a = Object.values(window.__store.assignments)[0]; db.assignments = { [Object.keys(window.__store.assignments)[0]]: { id: Object.keys(window.__store.assignments)[0], ...a } }; return renderOneStudentAnswerSheet(db.assignments[Object.keys(db.assignments)[0]], 'stu_a'); });
  check('학생 답지 화면에는 주요 문항·기출·정답 표시가 없음', !/주요 문항|기출|isKeyProblem|정답키/.test(stuHtml));
  check('시험 중 페이지 오류 없음', errs.length === 0, errs.join(' | '));

  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(`KEY-FILTER SUMMARY total=${results.length} pass=${results.length - bad} fail=${bad}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('KEY-FILTER SCRIPT ERROR', e); process.exit(1); });
