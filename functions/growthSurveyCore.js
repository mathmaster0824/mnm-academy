/* Monthly student growth survey core.
 * Pure validation and bounded recommendation helpers. No Firestore calls here.
 * Keep this module independent so callable handlers can be reviewed separately.
 */
'use strict';

const SCALE = Object.freeze({
  1: '아직 어려움',
  2: '많은 도움 필요',
  3: '도움받아 수행',
  4: '대체로 스스로',
  5: '안정적으로 수행',
  NO: '관찰 기회 없음'
});

const ITEMS = Object.freeze([
  { id: 'routine_01', domain: '학습 루틴', label: '정해진 시간에 학습을 시작한다.' },
  { id: 'routine_02', domain: '학습 루틴', label: '정해진 과제와 준비물을 확인한다.' },
  { id: 'routine_03', domain: '학습 루틴', label: '정한 분량을 끝까지 마무리한다.' },
  { id: 'concept_01', domain: '개념 이해', label: '배운 개념을 자기 말로 설명한다.' },
  { id: 'concept_02', domain: '개념 이해', label: '개념이 문제에 쓰이는 이유를 찾는다.' },
  { id: 'concept_03', domain: '개념 이해', label: '비슷한 개념의 차이를 구분한다.' },
  { id: 'problem_01', domain: '문제 해결', label: '문제를 읽고 필요한 조건을 표시한다.' },
  { id: 'problem_02', domain: '문제 해결', label: '풀이 순서를 세워 한 단계씩 해결한다.' },
  { id: 'problem_03', domain: '문제 해결', label: '막혔을 때 배운 방법이나 자료를 다시 찾는다.' },
  { id: 'error_01', domain: '오답 점검', label: '틀린 문제에서 처음 막힌 지점을 찾는다.' },
  { id: 'error_02', domain: '오답 점검', label: '틀린 이유를 계산·개념·조건 중에서 구분한다.' },
  { id: 'error_03', domain: '오답 점검', label: '오답을 고친 뒤 다시 풀어 확인한다.' },
  { id: 'independence_01', domain: '학습 독립성', label: '도움이 필요할 때 어디에서 막혔는지 말한다.' },
  { id: 'independence_02', domain: '학습 독립성', label: '힌트를 받은 뒤 다음 풀이를 이어 간다.' },
  { id: 'independence_03', domain: '학습 독립성', label: '익숙한 문제는 스스로 풀이를 점검한다.' },
  { id: 'expression_01', domain: '수학적 표현', label: '풀이 과정을 식과 글로 순서 있게 남긴다.' },
  { id: 'expression_02', domain: '수학적 표현', label: '기호와 단위를 알맞게 사용한다.' },
  { id: 'expression_03', domain: '수학적 표현', label: '답을 구한 뒤 풀이를 설명하거나 검산한다.' }
]);

const ITEM_IDS = Object.freeze(ITEMS.map(x => x.id));
const ID_SET = new Set(ITEM_IDS);
const MAX_REFLECTION = 500;
const MAX_GOAL = 180;
const MAX_MEMO = 500;
const MAX_SUPPORT = 300;

function isMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function normalizeText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r/g, '').trim().slice(0, max);
}
function validateRatings(value, { allowPartial = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '평가 응답 형식이 올바르지 않습니다.' };
  }
  const keys = Object.keys(value);
  if (keys.some(key => !ID_SET.has(key))) return { ok: false, error: '설문 문항에 없는 평가 항목이 있습니다.' };
  if (!allowPartial && ITEM_IDS.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    return { ok: false, error: '모든 문항에 응답하거나 관찰 기회 없음을 선택해주세요.' };
  }
  const clean = {};
  for (const key of keys) {
    const answer = value[key];
    if (!(Number.isInteger(answer) && answer >= 1 && answer <= 5) && answer !== 'NO') {
      return { ok: false, error: '평가 단계는 1~5 또는 관찰 기회 없음으로 선택해주세요.' };
    }
    clean[key] = answer;
  }
  return { ok: true, value: clean };
}
function validateStudentSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '응답 형식이 올바르지 않습니다.' };
  }
  const ratings = validateRatings(input.ratings);
  if (!ratings.ok) return ratings;
  const goal = normalizeText(input.smallGoal, MAX_GOAL);
  if (goal.length < 3) return { ok: false, error: '다음 달에 해볼 작은 목표를 적어주세요.' };
  return {
    ok: true,
    value: {
      ratings: ratings.value,
      reflection: normalizeText(input.reflection, MAX_REFLECTION),
      smallGoal: goal
    }
  };
}
function validateTeacherFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '교사 기록 형식이 올바르지 않습니다.' };
  }
  const ratings = validateRatings(input.ratings, { allowPartial: true });
  if (!ratings.ok) return ratings;
  return {
    ok: true,
    value: {
      ratings: ratings.value,
      studentMemo: normalizeText(input.studentMemo, MAX_MEMO),
      supportCommitment: normalizeText(input.supportCommitment, MAX_SUPPORT),
      parentMemo: normalizeText(input.parentMemo, MAX_MEMO)
    }
  };
}
function recommendDraft(previousDoc, monthlyReport, month) {
  const old = previousDoc && previousDoc.teacher && previousDoc.teacher.ratings;
  const ratings = {};
  const provenance = {};
  for (const item of ITEMS) {
    if (old && Object.prototype.hasOwnProperty.call(old, item.id) &&
        ((Number.isInteger(old[item.id]) && old[item.id] >= 1 && old[item.id] <= 5) || old[item.id] === 'NO')) {
      ratings[item.id] = old[item.id];
      provenance[item.id] = { kind: 'previous-observation', month: previousDoc.month || '' };
    } else {
      ratings[item.id] = 'NO';
      provenance[item.id] = { kind: 'needs-observation', note: '이번 달 자료에서 직접 판단할 근거가 없어 원장 확인이 필요합니다.' };
    }
  }
  const data = monthlyReport && monthlyReport.generated && monthlyReport.generated.data;
  const evidence = [];
  if (data) {
    const homework = data.homework && data.homework.totals;
    if (homework && Number(homework.planned) > 0) {
      evidence.push({
        source: 'monthlyReport.homework',
        text: '이번 달 숙제 제출 기록 ' + Number(homework.submitted || 0) + '/' + Number(homework.planned) + '회'
      });
    }
    const completeness = data.completeness;
    if (completeness) {
      evidence.push({
        source: 'monthlyReport.completeness',
        text: '수업 중 숙제 완성도 기록: 상 ' + Number(completeness['상'] || 0) +
          ' · 중 ' + Number(completeness['중'] || 0) + ' · 하 ' + Number(completeness['하'] || 0)
      });
    }
    const average = data.scores && data.scores.average;
    if (average !== null && average !== undefined) {
      evidence.push({ source: 'monthlyReport.scores', text: '일일테스트 평균 ' + Number(average) + '점' });
    }
  }
  return {
    month,
    ratings,
    provenance,
    evidence,
    suggestedNextDirection: data && Array.isArray(data.nextDirection) ? data.nextDirection.slice(0, 3) : [],
    previousMonth: previousDoc && previousDoc.month || null
  };
}

module.exports = {
  SCALE, ITEMS, ITEM_IDS, isMonth, validateRatings,
  validateStudentSubmission, validateTeacherFields, recommendDraft
};
