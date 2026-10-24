/* 답지 채점 코어 (순수 함수). 앱(index.html)의 normalizeAnswerValue / localGradeProblem 과 같은 규칙이어야 한다.
 * 일치 여부는 tests/grade-parity.test.js 가 같은 시험 표를 양쪽에 돌려 확인한다. */
'use strict';

function normalizeAnswerValue(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, '')
    .replace(/[①-⑩]/g, (c) => String(c.charCodeAt(0) - 0x2460 + 1))
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xFF10));
}

function gradeProblem(problem, answer) {
  if (problem.type === 'constructed') return { state: 'pending', earnedPoints: null };
  const given = normalizeAnswerValue(answer);
  const candidates = (problem.acceptedAnswers && problem.acceptedAnswers.length ? problem.acceptedAnswers : [problem.answer])
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
  if (!candidates.length) return { state: 'pending', earnedPoints: null, keyMissing: true };
  const correct = candidates.map(normalizeAnswerValue).includes(given);
  return { state: correct ? 'correct' : 'wrong', earnedPoints: correct ? Number(problem.points || 1) : 0 };
}

module.exports = { normalizeAnswerValue, gradeProblem };
