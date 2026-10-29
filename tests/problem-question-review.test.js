/* 학생 질문 문제후보의 원장 대기열→수동 AI 분석→저장 흐름 시험.
 * Playwright와 메모리 Firestore만 사용하며 운영 Firebase에는 접속하지 않는다. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

const results = [];
const check = (name, ok, detail) => {
  results.push(Boolean(ok));
  console.log('QUESTION-REVIEW ' + (ok ? '✔ ' : '✖ ') + name + (ok ? '' : ' ← ' + (detail || '')));
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route(/gstatic\.com\/firebasejs/, route =>
    route.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, route => {
    if (/gstatic\.com\/firebasejs/.test(route.request().url())) return route.fallback();
    route.abort();
  });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    session = { mode: 'director' };
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'block';
    window.render = () => {};
    window.alert = () => {};

    const photo = { storageKey: 'questions/q-photo/photo.jpg', url: 'https://photos.invalid/photo.jpg', contentType: 'image/jpeg' };
    window.__store.problemSources = {
      src_photo: { title: '학생질문 q-photo', sourceType: 'student-question', sourceKey: 'student-question::q-photo', createdAt: '2026-10-28T00:00:00.000Z' }
    };
    window.__store.problemDrafts = {
      draft_photo: {
        id: 'draft_photo', sourceId: 'src_photo', sourceName: '학생질문',
        sourceKey: 'student-question::q-photo', problemNo: '7번', questionText: '원의 성질 문제 질문',
        problemText: '', rawText: '', grade: '중2', semester: '2학기',
        type: 'short', answer: '', cropKey: photo.storageKey, media: [photo],
        originTypes: ['student-question'], origins: [{ type: 'student-question', id: 'q-photo' }],
        analysis: { version: 'mnm-taxonomy-v1', needsVision: true, status: 'vision-pending' },
        status: 'review', createdAt: '2026-10-28T00:00:00.000Z'
      }
    };
    problemStore.ingest = { sources: [], drafts: [], loading: false, loaded: false, sourceFilter: '', statusFilter: '', aiFilter: '' };
    await loadProblemIngestQueue();

    const html = renderProblemIngest();
    const loaded = problemStore.ingest.drafts.find(d => d.id === 'draft_photo');
    const shown = html.includes('필요문항 AI 일괄분석') && html.includes('7번') &&
      html.includes('이미지분석 1') && html.includes('원본 이미지 분석 대기');

    let analyzedId = '';
    window.analyzeProblemDraftWithServer = async draft => {
      analyzedId = draft.id;
      return { problemText: '원에서 중심각을 구하는 문제' };
    };
    window.problemAiPatch = () => ({
      status: 'review',
      problemText: '원에서 중심각을 구하는 문제',
      analysis: { version: 'mnm-taxonomy-v1', needsVision: false, status: 'analyzed' }
    });
    window.fsUpdate = async (collectionName, id, patch) => {
      Object.assign(window.__store[collectionName][id], patch);
      return true;
    };
    await analyzePendingProblemDrafts();
    const analyzed = window.__store.problemDrafts.draft_photo;

    let savedId = '';
    window.problemDraftStatus = () => 'ready';
    window.confirm = () => true;
    window.saveProblemDraft = async id => { savedId = id; return { status: 'saved' }; };
    problemStore.saveRun = { active: false, done: 0, saved: 0, duplicates: 0, failed: 0, errors: [], message: '' };
    await saveAllReadyProblemDrafts();

    return {
      loaded: Boolean(loaded),
      displayedInQueue: shown,
      imageKeyPreserved: loaded?.cropKey === photo.storageKey && loaded?.media?.[0]?.storageKey === photo.storageKey,
      analyzedByExistingQueueAction: analyzedId === 'draft_photo' && analyzed.analysis.status === 'analyzed',
      sentToExistingSaveAction: savedId === 'draft_photo'
    };
  });

  check('서버가 만든 사진 질문 후보를 원장 대기열에서 불러옴', result.loaded, JSON.stringify(result));
  check('후보 번호·사진 분석 대기 상태·일괄 분석 버튼이 화면에 표시됨', result.displayedInQueue, JSON.stringify(result));
  check('저장된 사진 키가 원장 분석 흐름까지 유지됨', result.imageKeyPreserved, JSON.stringify(result));
  check('원장 AI 분석 작업이 해당 후보를 처리하고 결과를 반영함', result.analyzedByExistingQueueAction, JSON.stringify(result));
  check('저장 가능한 후보가 기존 일괄 저장 절차로 전달됨', result.sentToExistingSaveAction, JSON.stringify(result));
  check('화면 스크립트 오류 없음', errors.length === 0, errors.join(' | '));

  await browser.close();
  if (results.some(ok => !ok)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
