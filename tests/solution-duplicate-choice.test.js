/* 해설보관함: 같은 문제를 또 등록하면 기존 사진을 보여 주고 추가/바꾸기/그대로 두기 선택. Playwright + 메모리 Firestore 가짜. 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`SOL-DUP ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' };
    let n = 0; window.storePhotoFile = async () => ({ storageKey: 'new' + (++n), url: 'https://x/new' + n + '.jpg' });
    window.syncSolutionPhotoToProblemRepo = async () => {};
    const key = textbookSourceKey('course1', '쎈', '41', '7');
    const mk = (id, k) => ({ id, photo: { storageKey: k, url: 'https://x/' + k + '.jpg' }, courseId: 'course1', book: '쎈', page: '41', problemNo: '7', sourceKey: key });
    db.solutionPhotos = [mk('s1', 'old1'), mk('s2', 'old2'), { ...mk('s9', 'other'), page: '50', sourceKey: textbookSourceKey('course1', '쎈', '50', '1') }];
    window.__store.solutionPhotos = Object.fromEntries(db.solutionPhotos.map((p) => [p.id, JSON.parse(JSON.stringify(p))]));
    window.render = () => {};
    document.getElementById('mainArea').innerHTML = '<input type="file" id="spPhoto"><select id="spCourse"><option value="course1">c</option></select><input id="spBook"><input id="spUnit"><input id="spPage"><input id="spProblem">';
    document.getElementById('spCourse').value = 'course1';
    window.fill = (pg, no) => { document.getElementById('spBook').value = '쎈'; document.getElementById('spPage').value = pg; document.getElementById('spProblem').value = no; };
  });
  const fill = async (pg, no) => { await page.evaluate(([a, b]) => window.fill(a, b), [pg, no]); await page.setInputFiles('#spPhoto', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); };
  const same = () => page.evaluate(() => Object.values(window.__store.solutionPhotos || {}).filter((p) => p.sourceKey === textbookSourceKey('course1', '쎈', '41', '7')).map((p) => p.photo.storageKey).sort());
  // 1) 처음 등록하는 문제: 확인창 없이 바로 등록
  await fill('60', '3'); await page.evaluate(() => addSolutionPhoto()); await page.waitForTimeout(400);
  check('같은 문제가 없으면 묻지 않고 바로 등록', (await page.locator('#solDupModal').count()) === 0 && (await page.evaluate(() => Object.values(window.__store.solutionPhotos).some((p) => p.page === '60'))));
  // 2) 이미 있는 문제: 기존 2장 + 새 사진 미리보기와 3가지 선택
  await fill('41', '7'); const run = page.evaluate(() => addSolutionPhoto()); await page.waitForSelector('#solDupModal');
  const modal = await page.locator('#solDupModal').innerText();
  check('이미 있는 문제면 안내창: "이미 이 문제의 해설이 2장" + 기존 사진 2장 + 새 사진 1장 미리보기', modal.includes('이미 이 문제의 해설이 2장') && (await page.locator('[data-sol-dup-existing] img').count()) === 2 && (await page.locator('[data-sol-dup-new] img').count()) === 1 && modal.includes('쎈 41쪽 7번'), modal);
  check('선택지 3개: 추가로 등록 / 선택한 사진 바꾸기 / 그대로 두기', (await page.locator('[data-sol-dup]').count()) === 3 && modal.includes('추가로 등록') && modal.includes('바꾸기') && modal.includes('그대로 두기'));
  await page.locator('[data-sol-dup="keep"]').click(); await run;
  check('"그대로 두기": 등록 안 함, 기존 2장 유지, 입력한 사진·칸 내용은 그대로 남음', JSON.stringify(await same()) === JSON.stringify(['old1', 'old2']) && (await page.evaluate(() => document.getElementById('spPage').value)) === '41' && (await page.evaluate(() => document.getElementById('spPhoto').files.length)) === 1);
  // 3) 추가
  const run2 = page.evaluate(() => addSolutionPhoto()); await page.waitForSelector('#solDupModal'); await page.locator('[data-sol-dup="add"]').click(); await run2; await page.waitForTimeout(300);
  let ids = await same();
  check('"추가로 등록": 기존 2장은 그대로 + 새 사진 1장 = 3장', ids.length === 3 && ids.includes('old1') && ids.includes('old2') && ids.some((x) => x.startsWith('new')), JSON.stringify(ids));
  // 4) 여러 장 중 한 장만 바꾸기: 기존 3장(old1·old2·new?) 중 두 번째만 선택
  await fill('41', '7'); const run3 = page.evaluate(() => addSolutionPhoto()); await page.waitForSelector('#solDupModal');
  check('세 번째 등록 때는 기존 3장을 보여 주고, 아무것도 안 고르면 "바꾸기" 버튼이 꺼져 있음', (await page.locator('[data-sol-dup-existing] img').count()) === 3 && (await page.locator('[data-sol-dup-pick]').count()) === 3 && (await page.locator('[data-sol-dup-replace-btn]').isDisabled()));
  const secondId = await page.locator('[data-sol-dup-pick]').nth(1).getAttribute('data-sol-dup-pick');
  const beforeIds = await same();
  await page.locator('[data-sol-dup-pick]').nth(1).check();
  check('한 장 체크하면 버튼이 켜지고 "선택한 1장 삭제, 나머지 2장은 유지"', !(await page.locator('[data-sol-dup-replace-btn]').isDisabled()) && (await page.locator('[data-sol-dup-count]').innerText()).includes('선택한 1장 삭제, 나머지 2장은 유지'));
  await page.locator('[data-sol-dup="replace"]').click(); await run3; await page.waitForTimeout(400);
  ids = await same();
  const pickedKey = await page.evaluate((id) => (window.__pickedKey = null, null), secondId);
  check('선택한 1장만 삭제되고 나머지 2장은 유지 + 새 사진 1장 추가(총 3장)', ids.length === 3 && (await page.evaluate((id) => !window.__store.solutionPhotos[id], secondId)) && (await page.evaluate(() => Object.keys(window.__store.solutionPhotos).filter((k) => window.__store.solutionPhotos[k].sourceKey === textbookSourceKey('course1', '쎈', '41', '7')).length)) === 3 && (await page.evaluate((b) => b.filter((x) => x).length, beforeIds)) === 3, JSON.stringify(ids));
  // 5) 전부 선택해서 바꾸기
  await fill('41', '7'); const run4 = page.evaluate(() => addSolutionPhoto()); await page.waitForSelector('#solDupModal');
  await page.locator('[data-sol-dup-all]').click();
  check('"전부 선택"으로 기존 3장 모두 체크', (await page.locator('[data-sol-dup-pick]:checked').count()) === 3 && (await page.locator('[data-sol-dup-count]').innerText()).includes('선택한 3장 삭제'));
  await page.locator('[data-sol-dup-none]').click();
  check('"선택 해제"로 다시 모두 해제, 버튼 꺼짐', (await page.locator('[data-sol-dup-pick]:checked').count()) === 0 && (await page.locator('[data-sol-dup-replace-btn]').isDisabled()));
  await page.locator('[data-sol-dup-all]').click(); await page.locator('[data-sol-dup="replace"]').click(); await run4; await page.waitForTimeout(400);
  ids = await same();
  check('전부 바꾸기: 기존 3장 삭제 + 새 사진 1장만 남음(다른 문제 해설은 그대로)', ids.length === 1 && ids[0].startsWith('new') && (await page.evaluate(() => !!window.__store.solutionPhotos.s9)), JSON.stringify(ids));
  // 6) 기존이 1장뿐이면 처음부터 체크돼 있음
  await fill('41', '7'); const run5 = page.evaluate(() => addSolutionPhoto()); await page.waitForSelector('#solDupModal');
  check('기존이 1장뿐이면 그 사진이 미리 체크돼 있어 바로 바꿀 수 있음(전체선택 링크 없음)', (await page.locator('[data-sol-dup-pick]:checked').count()) === 1 && !(await page.locator('[data-sol-dup-replace-btn]').isDisabled()) && (await page.locator('[data-sol-dup-all]').count()) === 0);
  await page.locator('[data-sol-dup="keep"]').click(); await run5;
  // 7) 바꾸기인데 새 사진 저장 실패 → 기존 것은 지우지 않음
  await page.evaluate(() => { window.storePhotoFile = async () => { throw new Error('upload fail'); }; window.alert = () => {}; });
  await fill('41', '7'); const before = await same(); const run6 = page.evaluate(() => addSolutionPhoto()); await page.waitForSelector('#solDupModal'); await page.locator('[data-sol-dup="replace"]').click(); await run6; await page.waitForTimeout(300);
  check('바꾸기 중 새 사진 업로드가 실패하면 기존 해설은 삭제하지 않음', JSON.stringify(await same()) === JSON.stringify(before), JSON.stringify(await same()));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `SOL-DUP FAIL ${f}/${results.length}` : `SOL-DUP OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
