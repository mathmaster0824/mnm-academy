/* 기존 해설 보관 자료의 문제저장소 연결 회귀 시험.
 * 메모리 Firestore만 사용하며 실제 운영 데이터에 접속하지 않는다.
 * 실행: node tests/solution-library-problemrepo-backfill.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route(/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await page.route(/^https?:/, r => {
      if (r.request().url().includes('firebasejs')) return r.fallback();
      r.abort();
    });
    await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      session = { mode: 'director' };
      currentSubState = {};
      const base = { courseId: 'course-5-2', book: '쎈', page: '18', problemNo: '3', photo: 'fixture-photo', sourceKey: 'course-5-2|쎈|18|3' };
      const rows = [
        { id: 'archive-a', ...base },
        { id: 'archive-b', ...base, photo: 'fixture-photo-2' },
        { id: 'archive-incomplete', courseId: 'course-5-2', book: '쎈', photo: 'fixture-photo-3' },
      ];
      db.solutionPhotos = rows.map(x => ({ ...x }));
      window.__store.solutionPhotos = Object.fromEntries(rows.map(x => [x.id, { ...x }]));
      window.confirm = () => true;
      const before = solutionLibraryProblemRepoSummary();
      const preview = renderSolutionLib();
      await syncExistingSolutionPhotosToProblemRepo();
      const afterFirst = solutionLibraryProblemRepoSummary();
      const drafts = Object.entries(window.__store.problemDrafts || {}).map(([id, data]) => ({ id, ...data }));
      const sources = Object.values(window.__store.problemSources || {});
      const draft = drafts[0] || {};
      const archiveA = window.__store.solutionPhotos['archive-a'];
      const archiveB = window.__store.solutionPhotos['archive-b'];
      const archiveIncomplete = window.__store.solutionPhotos['archive-incomplete'];
      const checks = {
        oneDraftAndSource: drafts.length === 1 && sources.length === 1,
        bothArchivesLinkedToSameDraft: archiveA.problemDraftId === draft.id && archiveB.problemDraftId === draft.id,
        incompleteArchiveSkipped: !archiveIncomplete.problemDraftId,
        duplicateAssetsPreserved: (draft.solutionAssetIds || []).length === 2,
        duplicateOriginsPreserved: (draft.origins || []).filter(x => x.type === 'learning-library').length === 2,
        summaryUpdated: afterFirst.linked === 2 && afterFirst.eligible === 0,
      };
      await syncExistingSolutionPhotosToProblemRepo();
      const secondPassOk = Object.keys(window.__store.problemDrafts || {}).length === 1 && Object.keys(window.__store.problemSources || {}).length === 1;
      return {
        previewShowsCounts: preview.includes('2개를 문제저장소에 연결') && preview.includes('1개입니다.'),
        previewShowsNonDestructiveNote: preview.includes('원본 자료는 삭제되거나 덮어써지지 않습니다.'),
        countsBefore: before,
        countsAfter: afterFirst,
        ...checks,
        secondPassOk,
        assetIds: draft.solutionAssetIds,
        originCount: (draft.origins || []).length,
      };
    });

    Object.entries(result).forEach(([name, value]) => {
      const ok = typeof value === 'boolean' ? value : true;
      console.log(`LIBRARY-BACKFILL ${ok ? '✔' : '✖'} ${name}${ok ? '' : ` ← ${JSON.stringify(value)}`}`);
    });
    if (errors.length) console.error('PAGE ERRORS:', errors);
    if (Object.values(result).some(v => typeof v === 'boolean' && !v) || errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
