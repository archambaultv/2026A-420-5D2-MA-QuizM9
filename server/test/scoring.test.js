/**
 * Tests UNITAIRES de calculateScore : une fonction pure, pas de serveur, pas
 * de base. Lancez-les avec `npm test` depuis la racine.
 *
 * Les cinq premiers sont ceux du harnais, réécrits avec node:test. À vous
 * d'ajouter les cas limites (jalon 1) : chaque test.todo est un test à écrire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore } from '../src/scoring.js';

// Un raccourci : les valeurs par défaut d'une réponse, à surcharger.
function score(overrides) {
  return calculateScore({
    isCorrect: true,
    responseTimeMs: 0,
    questionDurationMs: 20000,
    isFirstCorrectAnswer: false,
    ...overrides,
  });
}

test('bonne réponse instantanée = 8 (5 + bonus rapidité 3)', () => {
  assert.equal(score({}), 8);
});

test('première bonne réponse instantanée = 10 (maximum)', () => {
  assert.equal(score({ isFirstCorrectAnswer: true }), 10);
});

test('bonne réponse à mi-parcours = 6 (5 + bonus rapidité 1)', () => {
  assert.equal(score({ responseTimeMs: 10000 }), 6);
});

test('mauvaise réponse = 0', () => {
  assert.equal(score({ isCorrect: false }), 0);
});

test('bonne réponse après l’échéance = 0', () => {
  assert.equal(score({ responseTimeMs: 25000 }), 0);
});

// ── Jalon 1 : les cas limites ─────────────────────────────────────────────
//
// Remplacez chaque test.todo par un vrai test.

test('réponse exactement à l’échéance = 5 (acceptée, bonus rapidité 0)', () => {
  assert.equal(score({ responseTimeMs: 20000 }), 5);
});

test('mauvaise réponse, même première et instantanée = 0', () => {
  assert.equal(score({ isCorrect: false, isFirstCorrectAnswer: true }), 0);
});

test('première bonne réponse hors délai = 0 (pas de bonus)', () => {
  assert.equal(score({ responseTimeMs: 20001, isFirstCorrectAnswer: true }), 0);
});

test('le bonus de rapidité ne dépasse jamais 3', () => {
  for (const responseTimeMs of [0, 1, 1000, 6666, 6667, 13333, 19999]) {
    assert.ok(score({ responseTimeMs }) - 5 <= 3, `temps ${responseTimeMs}`);
  }
});

test('le résultat est toujours un entier de 0 à 10', () => {
  for (let responseTimeMs = 0; responseTimeMs <= 25000; responseTimeMs += 500) {
    for (const isFirstCorrectAnswer of [false, true]) {
      const points = score({ responseTimeMs, isFirstCorrectAnswer });
      assert.ok(Number.isInteger(points), `temps ${responseTimeMs}`);
      assert.ok(points >= 0 && points <= 10, `temps ${responseTimeMs} : ${points}`);
    }
  }
});
