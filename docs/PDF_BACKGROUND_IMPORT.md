# PDF background imports

## What continues when the browser closes

The browser uploads the original PDF and renders/uploads PNG pages before the server accepts the job. Keep the screen open until **업로드 완료 · 서버에서 처리합니다**. Once queued, a scheduled Worker performs segmentation, creates real cropped PNGs and stores each page's result in R2 without a browser session. Closing the page, signing out, or token expiration after upload does not stop that work. No Firebase token is stored with a job.

When the director returns to the workshop, completed R2 results are imported into Firestore using deterministic source/draft IDs. Import runs in transactions that create only missing drafts, preserving edits and surviving interruption. Official problem DB approval is still manual. During an unfinished upload, the original PDF and completed pages remain in R2; **업로드 이어하기** resumes preparation from the stored original.

Jobs with failed pages remain in error and are not silently imported as complete. The retry button preserves successful pages and reruns failures only. The model may still misidentify boundaries; all generated drafts require review.

## Required deployment (GitHub Pages alone is insufficient)

1. Publish `index.html` and `pdf-background-import.js` together on GitHub Pages.
2. Replace the **existing** `mnm-photo-api` Worker's code with `worker/mnm-photo-api.js` and deploy. Retain `PHOTOS`, `AI` and any existing Firebase project binding. No new bucket, permission relaxation or secret is required.
3. Add a **Cron Trigger** to that Worker: `* * * * *` (once per minute). The trigger must remain configured; `ctx.waitUntil` alone is not used as a persistent queue.
4. Confirm the account's Worker CPU allowance supports image decoding/cropping. This implementation should use a Workers Paid CPU allowance; the Free plan's small CPU budget is not an appropriate target for full-page PNG processing. Do not change the user's subscription automatically. Actual usage and AI/R2 limits must be verified on the account.
5. Open `https://mnm-photo-api.jihagondu.workers.dev/health`. Require `workerVersion: "2026-11-12-background-v2-large-pdf"`, `pdfMultipartSupported: true`, `pdfBackgroundSupported: true`, and `pdfSchedulerReady: true`. A stale/missing scheduler heartbeat blocks starting new jobs while preserving uploads. Allow the configured trigger to run before checking readiness.
6. Upload a small real PDF. Verify queued/processing, close the app, then return and confirm page progress advanced, cropped images exist and drafts import once. Test failed-page retry on the live account. **Local tests and a successful Pages deployment do not prove this live behavior.**

## Reliability and limits

- The scheduler uses an R2 conditional-write lease. Overlapping invocations cannot claim the same worker lease. Lease expiry recovers an abruptly terminated invocation.
- Processing checkpoints and crop names are deterministic per job/page/ordinal. A recovered page uses the stored result instead of calling AI again.
- Attempts are persisted before model processing. Each page has at most two scheduler attempts, each containing at most one model JSON retry. Persistent runtime failures eventually mark the page failed after the lease expires.
- Up to 600 pages per PDF; original up to 512 MB (configured limit; actual tablet memory remains a constraint); PNG page up to 8 MB, at most 1800 pixels on the long edge from the app. Result responses are paginated in ten-page blocks.
- Internal job metadata is blocked from the existing public photo endpoint. Job APIs require authenticated director access and are scoped to the UID. Existing photo access behavior is unchanged.
- Scheduling scans job metadata in pages. Most processing starts at the next scheduled tick; it is not an immediate, hard-time SLA. No jobs are processed when the trigger is absent.
- Original PDFs/pages/results persist in R2 for resumability; this version does not delete existing or completed data automatically. Monitor storage as the DB grows.

## Checks

`node --test tests/pdf-background-client.test.cjs tests/pdf-background-jobs.test.cjs`

Covered: browser-independent processing after discarding client state; PNG decoding and crop pixels for filters 0–4; malformed JSON retry; bounded failure/retry preserving successful crops; competing scheduler lease; director isolation; private job metadata; interrupted Firestore import and duplicate prevention preserving teacher edits. Cloudflare execution/quotas, actual AI accuracy and a real tablet upload still require the live checks above.

## Large original uploads

Original PDFs use R2 multipart upload with fixed 8 MiB parts (last part may be smaller). The server persists completed part numbers/ETags and checks all parts and the final object size before marking the original uploaded. Re-selecting the same file resumes saved parts; completed originals survive an interrupted completion acknowledgment. Part data is bounded in Worker memory, and the PDF is never assembled into one Worker buffer. Existing 15 MiB photo uploads and the legacy small-source endpoint are unchanged.

The browser identifies large files by hashing each bounded slice and then hashing a versioned manifest of the hashes and total size. PDF.js still needs memory to open/render the PDF in the tablet, so the configured 512 MiB/600-page limit is not a guarantee that every large or malformed PDF can render on every device. A real large PDF must be tested after deployment. Incomplete multipart sessions older than six days are restarted on re-selection to avoid expired R2 sessions.

Tests include byte-exact reconstruction of a synthetic 20 MiB PDF payload, resume after losing client state, a lost completion acknowledgment, incorrect part lengths, oversized declarations, director isolation, bounded client hashing, and resuming after a lost part response. This verifies transport behavior, not AI accuracy or real-PDF rendering. The existing Cron schedule and bindings do not need to be changed for this upgrade.
