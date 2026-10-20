/* 실제 index.html 을 브라우저(Playwright)로 열고 Auth + Firestore Emulator 에 연결해 보는 시험.
 * 운영 Firebase 에는 접속하지 않는다: 시험 때만 메모리에서 HTML 을 바꿔 (1) 프로젝트 ID 를 demo-* 로,
 * (2) Firebase SDK 를 에뮬레이터로, (3) 원장 로그인 방식을 시험용 값으로 돌린다. 저장소의 index.html 파일은 그대로다.
 * 계정·비밀번호·학생 정보는 모두 가짜(자리표시자)다. 실행: tests/README.md */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const F = require('firebase/firestore');

const INDEX = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const rules = (n, uid) => fs.readFileSync(path.join(__dirname, '..', '..', 'security', n), 'utf8').split('REPLACE_WITH_DIRECTOR_UID').join(uid || 'unused-uid');
const P1 = 'demo-e2e-p1', CUR = 'demo-e2e-cur';
const TEST_PW = 'Test-Password-123';              // 시험 전용 가짜 비밀번호
const DIR_EMAIL = 'director@test.invalid', OTHER_EMAIL = 'notdirector@test.invalid';
const A = 'stu_aaaaaaaaaa', B = 'stu_bbbbbbbbbb', CLS = 'cls_fakeclass1';
const AUTH = 'http://127.0.0.1:9099';

let currentHtml = '';
const server = require('http').createServer((q, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(currentHtml); });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`E2E ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };

async function signUp(project, email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: TEST_PW, returnSecureToken: true }) });
  // 프로젝트는 요청 경로로 구분되지 않으므로 에뮬레이터는 --project 기본값을 쓴다. 앱도 같은 에뮬레이터를 쓰므로 계정은 공유된다.
  return (await r.json()).localId;
}

async function seedEnv(project, rulesFile, directorUid) {
  const env = await initializeTestEnvironment({ projectId: project, firestore: { rules: rules(rulesFile, directorUid) } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const S = (p, v) => F.setDoc(F.doc(d, p), v);
    await S('meta/settings', { adminPassword: 'FAKE-PW-NOT-REAL', isDefaultPassword: false });
    await S(`students/${A}`, { name: '가짜A', code: '1111', classId: CLS, status: 'active', grade: '중2' });
    await S(`students/${B}`, { name: '가짜B', code: '2222', classId: CLS, status: 'active', grade: '중2' });
    await S(`classes/${CLS}`, { name: '가짜반1', dayGroup: '월목', studentIds: [A, B] });
    await S('courses/course1', { name: '가짜과정', steps: [] });
    await S(`monthlyReports/2026-09_${A}`, { month: '2026-09', studentId: A, generated: { text: 'FAKE-REPORT' } });
    await S('questions/qB', { studentId: B, status: '대기', text: 'FAKE', photos: [], answerText: '', answerPhotos: [] });
  });
  return env;
}

function patchedHtml(project, mode, email) {
  let h = INDEX, n = 0;
  const rep = (a, b) => { if (!h.includes(a)) throw new Error('패치 대상 문자열을 찾지 못함: ' + a.slice(0, 40)); h = h.replace(a, b); n++; };
  rep('projectId: "math-master-6a888"', `projectId: "${project}"`);
  rep("const DIRECTOR_AUTH = { mode:'legacy', email:'director@REPLACE-ME.invalid' };", `const DIRECTOR_AUTH = { mode:'${mode}', email:'${email}' };`);
  rep('const fauth = firebase.auth();', `const fauth = firebase.auth(); fauth.useEmulator('${AUTH}', {disableWarnings:true}); fsdb.useEmulator('127.0.0.1', 8080);`);
  return h;
}

async function openApp(browser, { project, mode, email, storage }) {
  const ctx = await browser.newContext();
  if (storage) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); for (const k in s) localStorage.setItem(k, s[k]); } } catch (e) {} }, storage);
  const page = await ctx.newPage();
  const diag = []; page.on('pageerror', (e) => diag.push('PAGEERROR ' + e.message.slice(0, 200)));
  page.on('requestfailed', (r) => diag.push('REQFAILED ' + r.url().slice(0, 100) + ' ' + (r.failure() && r.failure().errorText)));
  page.on('console', (m) => { if (diag.length < 25) diag.push('CONSOLE.' + m.type() + ' ' + m.text().slice(0, 200)); });
  const perm = []; page.on('console', (m) => { if (m.type() === 'error' && /permission|insufficient/i.test(m.text())) perm.push(m.text().slice(0, 160)); });
  page.dialogs = []; page.on('dialog', (d) => { page.dialogs.push(d.message().slice(0, 120)); d.accept(); });
  const html = patchedHtml(project, mode, email);
  // 패치한 HTML 은 로컬 서버(127.0.0.1:5173)가 내주고, 에뮬레이터 요청은 건드리지 않는다(CORS 사전 요청을 브라우저가 직접 처리).
  currentHtml = html;
  await page.route((u) => !/^http:\/\/127\.0\.0\.1[:/]/.test(u.toString()) && !/gstatic\.com\/firebasejs/.test(u.toString()), (r) => r.abort());
  await page.goto('http://127.0.0.1:5173/index.html');
  const stuck = async (e) => { const st = await page.evaluate(() => ({ ls: document.getElementById('loadingScreen') && document.getElementById('loadingScreen').style.display, ready: typeof listenersReady !== 'undefined' ? JSON.stringify(listenersReady) : 'n/a', user: typeof fauth !== 'undefined' && fauth.currentUser ? 'user' : 'nouser' })).catch(() => ({})); console.log('E2E DIAG ' + JSON.stringify(st) + '\n' + diag.join('\n')); throw e; };
  await page.waitForFunction(() => { const e = document.getElementById('loginScreen'); const a = document.getElementById('appShell'); return (e && e.style.display === 'flex') || (a && a.style.display !== 'none' && a.style.display !== ''); }, null, { timeout: 40000 }).catch(stuck);
  return { ctx, page, perm };
}
const waitAnon = (page) => page.waitForFunction(() => fauth.currentUser && fauth.currentUser.isAnonymous, null, { timeout: 20000 });
// 앱의 현재 세션으로 Firestore 에 직접 연산을 던져 결과(허용/거부)만 돌려준다
const tryOp = (page, kind, p, data) => page.evaluate(async ([kind, p, data]) => {
  try {
    const ref = fsdb.doc(p);
    if (kind === 'get') await ref.get(); else if (kind === 'set') await ref.set(data); else if (kind === 'update') await ref.update(data); else if (kind === 'delete') await ref.delete();
    return 'ok';
  } catch (e) { return e.code || String(e); }
}, [kind, p, data]);

async function studentFlow(page, label, expectCode) {
  await page.evaluate(() => setLoginMode('student'));
  await page.fill('#codeInput', expectCode);
  await page.evaluate(() => tryStudentLogin());
  const ok = await page.evaluate(([A]) => !!(session && session.mode === 'student' && session.studentId === A), [A]);
  check(`${label}: 학생 코드 로그인 → 학생 화면 입장`, ok);
  return ok;
}

(async () => {
  await new Promise((ok) => server.listen(5173, '127.0.0.1', ok));
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    // ── 1단계 규칙 + 서버 검증 원장 로그인(firebase 모드) ─────────────────────
    const dirUid = await signUp(P1, DIR_EMAIL);
    const otherUid = await signUp(P1, OTHER_EMAIL);
    const env1 = await seedEnv(P1, 'firestore.rules.phase1.proposed', dirUid);

    {
      const { ctx, page, perm } = await openApp(browser, { project: P1, mode: 'firebase', email: DIR_EMAIL });
      check('1단계 규칙: 앱이 로그인 화면까지 로딩됨(meta/settings 를 읽지 않음)', await page.evaluate(() => document.getElementById('loginScreen').style.display === 'flex'));
      check('1단계 규칙: 로딩 중 권한 오류 콘솔 로그 없음', perm.length === 0, perm.join(' | '));
      check('앱 메모리에 원장 비밀번호 값이 없음', await page.evaluate(() => !('adminPassword' in (db.settings || {}))));
      await waitAnon(page);
      check('학생용 익명 세션 생성됨', await page.evaluate(() => fauth.currentUser.isAnonymous));

      // 학생 기능
      if (await studentFlow(page, '1단계 규칙', '1111')) {
        check('1단계 규칙: 학생 목록(students) 구독이 동작', await page.evaluate(() => (db.students || []).length >= 2));
        const sub = await page.evaluate(async ([A, CLS]) => {
          const date = '2026-10-20'; // 화요일
          db.weeklyPlans = { [CLS + '_2026-10-19']: { [A]: { tue: '시험용 숙제' } } };
          currentView = 'home'; currentSubState = { subDate: date };
          renderSubmissionCard(A, false, false);
          if (currentSubState._draftSub) { currentSubState._draftSub.hwPhotos = []; currentSubState._draftSub.memo = '시험'; }
          const keyInfo = JSON.stringify({ draftKey: currentSubState._draftSubKey, hasDraft: !!currentSubState._draftSub, subClassId: currentSubState.subClassId });
          try { await submitHomework(A, date); } catch (e) { return 'ERR ' + e.message; }
          return 'done ' + keyInfo;
        }, [A, CLS]);
        check('1단계 규칙: 학생 숙제 제출 함수 실행', /^done/.test(sub), sub);
        console.log('E2E INFO submit ' + sub + ' dialogs=' + JSON.stringify(page.dialogs));
        let saved, allIds;
        await env1.withSecurityRulesDisabled(async (c) => { const fs2 = c.firestore(); saved = (await F.getDoc(F.doc(fs2, `submissions/${A}_2026-10-20`))).data(); allIds = (await F.getDocs(F.collection(fs2, 'submissions'))).docs.map((d) => d.id); });
        check('1단계 규칙: 숙제 제출이 Firestore 에 저장됨(status=제출완료)', saved && saved.status === '제출완료' && saved.studentId === A, JSON.stringify(saved) + ' all=' + JSON.stringify(allIds));
        check('1단계 규칙: 학생이 질문 올리기', (await tryOp(page, 'set', 'questions/qNew', { studentId: A, status: '대기', text: '시험', photos: [], answerText: '', answerPhotos: [] })) === 'ok');
        check('1단계 규칙: 학생이 공부 타이머 저장', (await tryOp(page, 'set', `timerState/${A}_2026-10-20`, { baseSeconds: 5 })) === 'ok');
        // 차단
        check('1단계 규칙: 학생 세션이 meta/settings 읽기 → 거부', (await tryOp(page, 'get', 'meta/settings')) === 'permission-denied');
        check('1단계 규칙: 학생 세션이 meta/directors 읽기 → 거부', (await tryOp(page, 'get', 'meta/directors')) === 'permission-denied');
        check('1단계 규칙: 학생 세션이 meta/directors 에 자기 uid 추가 → 거부', (await tryOp(page, 'set', 'meta/directors', { uids: ['x'] })) === 'permission-denied');
        check('1단계 규칙: 학생 세션이 monthlyReports 읽기 → 거부', (await tryOp(page, 'get', `monthlyReports/2026-09_${A}`)) === 'permission-denied');
        check('1단계 규칙: 학생 세션이 학생 코드 수정 → 거부', (await tryOp(page, 'update', `students/${B}`, { code: '9999' })) === 'permission-denied');
        check('1단계 규칙: 학생 세션이 질문 답변 쓰기 → 거부', (await tryOp(page, 'update', 'questions/qB', { answerText: '조작', status: '답변완료' })) === 'permission-denied');
        // 1단계 한계(그대로 기록): 다른 학생 자료를 읽을 수 있다
        check('[알려진 한계] 1단계 규칙: 학생 A 세션이 학생 B 의 질문을 읽을 수 있음(2단계에서 해결)', (await tryOp(page, 'get', 'questions/qB')) === 'ok');
        check('[알려진 한계] 1단계 규칙: 학생 세션이 문제저장소(problemKeys)에 쓸 수 있음', (await tryOp(page, 'set', 'problemKeys/pX', { answer: 'FAKE' })) === 'ok');
      }
      await ctx.close();
    }

    // 원장 로그인 — 틀린 비밀번호 / 정상 / 허용 목록 밖 계정
    {
      const { ctx, page } = await openApp(browser, { project: P1, mode: 'firebase', email: DIR_EMAIL });
      await waitAnon(page);
      await page.fill('#pwInput', 'wrong-password-xx');
      await page.evaluate(() => tryDirectorLogin());
      await page.waitForFunction(() => document.getElementById('pwErr').textContent.length > 0, null, { timeout: 15000 });
      check('원장 로그인: 틀린 비밀번호 → 거부 메시지, 입장 안 됨', await page.evaluate(() => !session && /올바르지/.test(document.getElementById('pwErr').textContent)));

      await page.fill('#pwInput', TEST_PW);
      await page.evaluate(() => tryDirectorLogin());
      await page.waitForFunction(() => session && session.mode === 'director', null, { timeout: 20000 }).catch(() => {});
      check('원장 로그인: 올바른 시험 비밀번호 + 규칙의 원장 UID 일치 → 원장 화면 입장', await page.evaluate(() => !!(session && session.mode === 'director')));
      check('원장 세션: meta/settings 읽기 허용', (await tryOp(page, 'get', 'meta/settings')) === 'ok');
      check('원장 세션: monthlyReports 읽기 허용', (await tryOp(page, 'get', `monthlyReports/2026-09_${A}`)) === 'ok');
      check('원장 세션: 규칙에 없는 경로(settings/main, 전체 백업용) 읽기 허용', (await tryOp(page, 'get', 'settings/main')) === 'ok');

      // 새로고침해도 서버 세션이 유지되어 원장 화면이 복원됨
      await page.reload();
      await page.waitForFunction(() => session && session.mode === 'director', null, { timeout: 30000 }).catch(() => {});
      check('원장 세션: 새로고침 후 복원(서버 세션 기반)', await page.evaluate(() => !!(session && session.mode === 'director')));

      // 로그아웃 → 익명 세션 → 학생 로그인 가능 & 원장 데이터 차단
      await page.evaluate(() => logout());
      await waitAnon(page);
      check('원장 로그아웃 → 익명(학생용) 세션으로 전환', await page.evaluate(() => fauth.currentUser.isAnonymous));
      check('원장 로그아웃 뒤 meta/settings 읽기 → 거부', (await tryOp(page, 'get', 'meta/settings')) === 'permission-denied');
      await studentFlow(page, '원장 로그아웃 뒤', '1111');
      await ctx.close();
    }
    {
      const { ctx, page } = await openApp(browser, { project: P1, mode: 'firebase', email: OTHER_EMAIL });
      await waitAnon(page);
      await page.fill('#pwInput', TEST_PW);
      await page.evaluate(() => tryDirectorLogin());
      await page.waitForFunction(() => /원장 권한이 없/.test(document.getElementById('pwErr').textContent), null, { timeout: 20000 }).catch(() => {});
      check('다른 이메일/비밀번호 계정(규칙에 적은 원장 UID 와 다름, 비밀번호는 맞음) → 원장 입장 거부', await page.evaluate(() => !session && /원장 권한이 없/.test(document.getElementById('pwErr').textContent)));
      await waitAnon(page);
      check('UID 불일치 계정 거부 뒤 익명 세션으로 돌아감', await page.evaluate(() => fauth.currentUser.isAnonymous));
      check('UID 불일치 계정이 meta/settings 읽기 → 거부', (await tryOp(page, 'get', 'meta/settings')) === 'permission-denied');
      check('UID 불일치 계정이 meta/directors 에 자기 UID 쓰기 → 거부(1단계 규칙)', (await tryOp(page, 'set', 'meta/directors', { uids: ['x'] })) === 'permission-denied');
      // 옛 규칙 구간에서 목록이 변조됐다고 가정(문서를 직접 시드): 원장 판정에 쓰이지 않으므로 여전히 거부여야 한다
      await env1.withSecurityRulesDisabled(async (c) => { await F.setDoc(F.doc(c.firestore(), 'meta/directors'), { uids: [otherUid] }); });
      await page.fill('#pwInput', TEST_PW);
      await page.evaluate(() => tryDirectorLogin());
      await page.waitForTimeout(1500);
      check('허용 목록 문서가 변조돼 있어도(다른 계정 UID 기재) 원장 입장 거부', await page.evaluate(() => !session));
      await ctx.close();
    }
    {
      // localStorage 에 원장 세션을 위조해 넣어도 복원되지 않는다
      const { ctx, page } = await openApp(browser, { project: P1, mode: 'firebase', email: DIR_EMAIL, storage: { mnm_session: JSON.stringify({ mode: 'director' }) } });
      check('localStorage 에 원장 세션을 위조해도 복원되지 않음(firebase 모드)', await page.evaluate(() => !session && document.getElementById('loginScreen').style.display === 'flex'));
      await ctx.close();
    }
    await env1.cleanup();

    // ── 현재 운영 규칙 + 기존 방식(legacy 모드): 지금 동작이 그대로인지(회귀) 및 문제점 확인 ──
    const envC = await seedEnv(CUR, 'firestore.rules.current', null);
    {
      const { ctx, page } = await openApp(browser, { project: CUR, mode: 'legacy', email: 'director@REPLACE-ME.invalid' });
      check('현재 규칙·legacy 모드: 앱 로딩', await page.evaluate(() => document.getElementById('loginScreen').style.display === 'flex'));
      await page.fill('#pwInput', 'wrong');
      await page.evaluate(() => tryDirectorLogin());
      check('현재 규칙·legacy 모드: 틀린 비밀번호 거부', await page.evaluate(() => !session && /올바르지/.test(document.getElementById('pwErr').textContent)));
      await page.fill('#pwInput', 'FAKE-PW-NOT-REAL');
      await page.evaluate(() => tryDirectorLogin());
      await page.waitForTimeout(500);
      check('현재 규칙·legacy 모드: 기존 방식 원장 로그인 그대로 동작', await page.evaluate(() => !!(session && session.mode === 'director')), await page.evaluate(() => JSON.stringify({ s: session, pw: !!(db.settings && db.settings.adminPassword), len: db.settings && db.settings.adminPassword && db.settings.adminPassword.length, err: document.getElementById('pwErr').textContent, val: document.getElementById('pwInput').value.length })));
      await page.evaluate(() => logout());
      await studentFlow(page, '현재 규칙·legacy 모드', '1111');
      check('[현재 문제점 확인] 현재 규칙: 학생 세션이 meta/settings(원장 비밀번호) 읽기 가능', (await tryOp(page, 'get', 'meta/settings')) === 'ok');
      check('[현재 문제점 확인] 현재 규칙: 학생 세션이 월말 리포트 읽기 가능', (await tryOp(page, 'get', `monthlyReports/2026-09_${A}`)) === 'ok');
      await ctx.close();
    }
    await envC.cleanup();
  } catch (e) {
    check('E2E 실행 중 예외 없음', false, e.stack || e.message);
  } finally {
    await browser.close(); server.close();
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`E2E SUMMARY total=${results.length} pass=${results.length - bad.length} fail=${bad.length}`);
  process.exit(bad.length ? 1 : 0);
})();
