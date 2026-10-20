#!/usr/bin/env node
/* Firestore 규칙 정적 점검 — Emulator 없이 실행된다.
 * 목적: "넓은 허용 규칙이 새 제한을 무력화"하는 실수를 규칙 파일 단계에서 잡는다.
 * 규칙의 허용 조건은 여러 match 사이에서 OR 로 합쳐지므로, 넓은 allow 하나가 다른 곳의 제한을 전부 풀어 버린다.
 * 사용: node scripts/rules-lint.js security/firestore.rules.phase1.proposed */
const fs = require('fs');

// 1단계 규칙에서 "학생(익명) 세션이 조건 없이 쓸 수 있는" 곳. 이 목록은 계획서 §6, §0 에 사유가 적혀 있다.
// 새 항목이 생기면 의도한 것인지 사람이 확인하도록 점검이 실패한다.
const EXPECTED_UNCONSTRAINED_STUDENT_WRITES = [
  'problemDrafts:*',            // 문제저장소 연동(질문→저장소 연결을 학생 세션이 씀) — 문제저장소 작업에서 서버로 이전
  'problemKeys:*',              // 〃 (정답키 포함)
  'problemSources:*',           // 〃
  'problems:*',                 // 〃
  'timerState:*',               // 학생 공부 타이머(저장·삭제)
  'weekendSubmissions:delete',  // 학생의 주말학습 사진 삭제
  'answerSubmissions:create',   // 학생의 답지 최초 제출(문서 ID 가 과제ID_학생ID 형식이라 1단계에서는 소유 확인 불가)
];
const DIRECTOR_ONLY_COLLECTIONS = ['meta', 'monthlyReports'];

function stripComments(t) { return t.replace(/\/\/[^\n]*/g, ''); }

// match 블록 파서: { path, body, children } — 중괄호 균형으로 본문을 잘라낸다.
function parseMatches(text) {
  const out = [];
  const re = /match\s+(\/[^\s{]*(?:\{[^}]*\}[^\s{]*)*)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex;
    while (i < text.length && depth > 0) { const c = text[i++]; if (c === '{') depth++; else if (c === '}') depth--; }
    out.push({ path: m[1], body: text.slice(re.lastIndex, i - 1), start: m.index });
    // 중첩 match 도 별도로 찾도록 lastIndex 는 본문 시작 직후 유지
  }
  return out;
}
function allows(body) {
  const res = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([^;]+);/g;
  let m;
  while ((m = re.exec(body))) res.push({ methods: m[1].split(',').map(x => x.trim()), cond: m[2].replace(/\s+/g, ' ').trim() });
  return res;
}
const WRITE = new Set(['write', 'create', 'update', 'delete']);
// 조건이 "로그인만 하면 참"인가: signedIn() 단독, 또는 `|| signedIn()` 으로 끝나는 OR 대안이 있는 경우
function unconstrainedForSession(cond) {
  const parts = cond.split('||').map(s => s.trim());
  return parts.some(p => p === 'signedIn()' || p === 'request.auth != null');
}

function lintRules(raw) {
  const text = stripComments(raw);
  const violations = [];
  // 1) 함수 정의 밖의 `request.auth != null` 금지
  const noFn = text.replace(/function\s+signedIn\s*\(\)\s*\{[^}]*\}/, '');
  if (/request\.auth\s*!=\s*null/.test(noFn)) violations.push('signedIn() 밖에 `request.auth != null` 조건이 있다(넓은 허용).');

  const blocks = parseMatches(text).filter(b => b.path !== '/databases/{database}/documents');
  const seen = new Map();
  for (const b of blocks) {
    const isWildcard = /\{document=\*\*\}/.test(b.path) && !/^\/[A-Za-z]/.test(b.path) || /^\/\{[A-Za-z]+\}\/\{document=\*\*\}$/.test(b.path) || b.path === '/{document=**}';
    const col = (b.path.match(/^\/([A-Za-z][A-Za-z0-9]*)\//) || [])[1];
    for (const a of allows(b.body)) {
      // 2) 와일드카드 블록은 원장 전용이어야 한다(그렇지 않으면 모든 컬렉션의 제한이 풀린다)
      if (isWildcard && (!/isDirector\(\)/.test(a.cond) || unconstrainedForSession(a.cond)))
        violations.push(`와일드카드 블록 ${b.path} 의 allow(${a.methods.join(',')}) 가 원장 전용이 아니다: ${a.cond}`);
      // 3) meta / monthlyReports 는 원장 전용
      if (col && DIRECTOR_ONLY_COLLECTIONS.includes(col) && a.cond !== 'isDirector()')
        violations.push(`${col} 는 원장 전용이어야 한다: allow(${a.methods.join(',')}) if ${a.cond}`);
      // 4) 학생 세션이 조건 없이 쓸 수 있는 곳 수집
      if (col && !isWildcard && a.methods.some(x => WRITE.has(x)) && unconstrainedForSession(a.cond)) {
        for (const x of a.methods) {
          if (!WRITE.has(x)) continue;
          const keys = x === 'write' ? ['*'] : [x];
          keys.forEach(k => seen.set(`${col}:${k}`, true));
        }
      }
    }
  }
  const got = [...seen.keys()].sort();
  const want = [...EXPECTED_UNCONSTRAINED_STUDENT_WRITES].sort();
  const extra = got.filter(x => !want.includes(x)), missing = want.filter(x => !got.includes(x));
  if (extra.length) violations.push('예상하지 못한 "학생 세션 무제한 쓰기": ' + extra.join(', '));
  if (missing.length) violations.push('예상 목록에 있는데 규칙에서 사라짐(목록 갱신 필요): ' + missing.join(', '));
  return { violations, unconstrainedStudentWrites: got };
}

module.exports = { lintRules, EXPECTED_UNCONSTRAINED_STUDENT_WRITES };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('사용: node scripts/rules-lint.js <규칙파일>...'); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    const r = lintRules(fs.readFileSync(f, 'utf8'));
    console.log(`${f}\n  학생 세션이 조건 없이 쓸 수 있는 곳: ${r.unconstrainedStudentWrites.join(', ') || '(없음)'}`);
    if (r.violations.length) { bad++; r.violations.forEach(v => console.log('  ✖ ' + v)); } else console.log('  ✔ 위반 없음');
  }
  process.exit(bad ? 1 : 0);
}
