import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/assets/js/scoring.js';

// ---------------------------------------------------------------------------
// 1. stoplicht() — boundaries
// ---------------------------------------------------------------------------
test('stoplicht() boundaries', () => {
  assert.equal(S.stoplicht(74), 'Oranje');
  assert.equal(S.stoplicht(75), 'Groen');
  assert.equal(S.stoplicht(54), 'Rood');
  assert.equal(S.stoplicht(55), 'Oranje');
  assert.equal(S.stoplicht(100), 'Groen');
  assert.equal(S.stoplicht(0), 'Rood');
});

// ---------------------------------------------------------------------------
// 2. avgForTheme() — N.v.t. (null) and unanswered excluded from denominator
// ---------------------------------------------------------------------------
test('avgForTheme() excludes N.v.t. (null) and unanswered from the denominator', () => {
  const questions = [
    { id: 'q1', theme: 'A', phase: 'Quickscan' },
    { id: 'q2', theme: 'A', phase: 'Quickscan' },
    { id: 'q3', theme: 'A', phase: 'Quickscan' }, // N.v.t. -> excluded
    { id: 'q4', theme: 'A', phase: 'Quickscan' }, // unanswered -> excluded
    { id: 'q5', theme: 'B', phase: 'Quickscan' }, // other theme
  ];
  const answers = {
    q1: { label: 'Ja volledig', score: 100 },
    q2: { label: 'Deels', score: 50 },
    q3: { label: 'N.v.t.', score: null },
    // q4 intentionally absent (unanswered)
    q5: { label: 'Nee', score: 0 },
  };
  // Only q1 (100) and q2 (50) count -> avg 75
  assert.equal(S.avgForTheme(answers, questions, 'A'), 75);
});

test('avgForTheme() returns 0 when all answers in a theme are N.v.t.', () => {
  const questions = [
    { id: 'q1', theme: 'A', phase: 'Quickscan' },
    { id: 'q2', theme: 'A', phase: 'Quickscan' },
  ];
  const answers = {
    q1: { label: 'N.v.t.', score: null },
    q2: { label: 'N.v.t.', score: null },
  };
  assert.equal(S.avgForTheme(answers, questions, 'A'), 0);
});

test('avgForTheme() respects the phase filter', () => {
  const questions = [
    { id: 'q1', theme: 'A', phase: 'Quickscan' },
    { id: 'q2', theme: 'A', phase: 'Verdieping' },
  ];
  const answers = {
    q1: { label: 'Ja volledig', score: 100 },
    q2: { label: 'Nee', score: 0 },
  };
  assert.equal(S.avgForTheme(answers, questions, 'A', 'Quickscan'), 100);
  assert.equal(S.avgForTheme(answers, questions, 'A', 'Verdieping'), 0);
  // null phase = both -> avg of 100 and 0 = 50
  assert.equal(S.avgForTheme(answers, questions, 'A', null), 50);
});

// ---------------------------------------------------------------------------
// 3. profileRoute(data, regie) — all five routes + boundaries
// ---------------------------------------------------------------------------
test('profileRoute() — R1 when overall < 55', () => {
  assert.equal(S.profileRoute(40, 50), 'R1'); // overall 45
  assert.equal(S.profileRoute(50, 50), 'R1'); // overall 50
});

test('profileRoute() — R2 when data>=75 & regie<55', () => {
  assert.equal(S.profileRoute(80, 40), 'R2'); // overall 60
});

test('profileRoute() — R3 when data<55 & regie>=75', () => {
  assert.equal(S.profileRoute(40, 80), 'R3'); // overall 60
});

test('profileRoute() — R5 when data>=75 & regie>=75', () => {
  assert.equal(S.profileRoute(80, 90), 'R5'); // overall 85
});

test('profileRoute() — R4 is the rest', () => {
  assert.equal(S.profileRoute(60, 60), 'R4'); // overall 60
});

test('profileRoute() — boundary 75,75 -> R5', () => {
  assert.equal(S.profileRoute(75, 75), 'R5');
});

test('profileRoute() — boundary 74,74 -> R4 (overall 74 >= 55, not R1/R2/R3/R5)', () => {
  assert.equal(S.profileRoute(74, 74), 'R4');
});

// ---------------------------------------------------------------------------
// 4. rubricScores() + topPriorities()
// ---------------------------------------------------------------------------
test('rubricScores() computes aandachtsscore = max(0, norm - score) and filters score 0', () => {
  const questions = [
    { id: 'a1', theme: 'A', phase: 'Quickscan' },
    { id: 'b1', theme: 'B', phase: 'Quickscan' },
    { id: 'c1', theme: 'C', phase: 'Quickscan' }, // all N.v.t. -> score 0 -> filtered
    { id: 'd1', theme: 'D', phase: 'Quickscan' }, // score above norm -> clamped to 0
  ];
  const answers = {
    a1: { label: 'Deels', score: 50 },        // theme A -> score 50
    b1: { label: 'Nauwelijks', score: 25 },   // theme B -> score 25
    c1: { label: 'N.v.t.', score: null },     // theme C -> score 0 (filtered out)
    d1: { label: 'Ja volledig', score: 100 }, // theme D -> score 100 (> norm 80)
  };
  const rubrics = [
    { theme: 'A', norm: 80 },
    { theme: 'B', norm: 80 },
    { theme: 'C', norm: 80 },
    { theme: 'D', norm: 80 },
  ];
  const result = S.rubricScores(answers, questions, rubrics);

  // Theme C (score 0) must be filtered out.
  assert.equal(result.find((r) => r.theme === 'C'), undefined);
  assert.equal(result.length, 3);

  const a = result.find((r) => r.theme === 'A');
  const b = result.find((r) => r.theme === 'B');
  const d = result.find((r) => r.theme === 'D');

  assert.equal(a.score, 50);
  assert.equal(a.aandachtsscore, 30); // max(0, 80-50)
  assert.equal(b.score, 25);
  assert.equal(b.aandachtsscore, 55); // max(0, 80-25)
  assert.equal(d.score, 100);
  assert.equal(d.aandachtsscore, 0);  // max(0, 80-100) -> clamped

  // Stoplicht labels come along.
  assert.equal(a.stoplicht, 'Rood');  // 50 < 55
  assert.equal(d.stoplicht, 'Groen'); // 100 >= 75
});

test('topPriorities() returns the N largest aandachtsscores, descending', () => {
  const rubrics = [
    { theme: 'A', aandachtsscore: 30 },
    { theme: 'B', aandachtsscore: 55 },
    { theme: 'C', aandachtsscore: 10 },
    { theme: 'D', aandachtsscore: 45 },
    { theme: 'E', aandachtsscore: 5 },
  ];
  const top = S.topPriorities(rubrics, 3);
  assert.equal(top.length, 3);
  assert.deepEqual(top.map((r) => r.theme), ['B', 'D', 'A']);
  // Verify descending order of the aandachtsscores themselves.
  assert.deepEqual(top.map((r) => r.aandachtsscore), [55, 45, 30]);
  // Source array is not mutated.
  assert.equal(rubrics[0].theme, 'A');
});

// ---------------------------------------------------------------------------
// 5. answeredList()
// ---------------------------------------------------------------------------
test('answeredList() returns rapport-ready items for answered questions only, with phase filter', () => {
  const questions = [
    { id: 'q1', code: 'Q1', theme: 'A', sub: 'sub-a', text: 'Vraag 1?', phase: 'Quickscan' },
    { id: 'q2', code: 'Q2', theme: 'B', sub: 'sub-b', text: 'Vraag 2?', phase: 'Quickscan' }, // unanswered
    { id: 'q3', code: 'Q3', theme: 'C', sub: 'sub-c', text: 'Vraag 3?', phase: 'Verdieping' },
  ];
  const answers = {
    q1: { label: 'Ja volledig', score: 100 },
    q3: { label: 'N.v.t.', score: null },
  };

  // All phases: q1 + q3 answered, q2 unanswered -> excluded.
  const all = S.answeredList(answers, questions);
  assert.equal(all.length, 2);
  assert.deepEqual(all[0], {
    code: 'Q1',
    thema: 'A',
    sub: 'sub-a',
    vraag: 'Vraag 1?',
    antwoord_label: 'Ja volledig',
    score: 100,
  });
  // An answered N.v.t. (score null) is still included in the list.
  assert.deepEqual(all[1], {
    code: 'Q3',
    thema: 'C',
    sub: 'sub-c',
    vraag: 'Vraag 3?',
    antwoord_label: 'N.v.t.',
    score: null,
  });

  // Phase filter: only Quickscan -> just q1.
  const quick = S.answeredList(answers, questions, 'Quickscan');
  assert.equal(quick.length, 1);
  assert.equal(quick[0].code, 'Q1');
});
