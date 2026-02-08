import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateJaccardSimilarity,
  calculateOverlapPercentage,
  calculateComplexityScore,
  setIntersection,
  setDifference,
} from '../../../src/lib/metrics.js';

describe('calculateJaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['Account.Create::true', 'ManageUsers::true']);
    assert.equal(calculateJaccardSimilarity(setA, setB), 1.0);
  });

  it('returns 0.0 for disjoint sets', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['Contact.Read::true', 'ViewSetup::true']);
    assert.equal(calculateJaccardSimilarity(setA, setB), 0.0);
  });

  it('returns correct ratio for partial overlap', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['ManageUsers::true', 'Contact.Read::true']);
    const result = calculateJaccardSimilarity(setA, setB);
    assert.equal(result, 1 / 3);
  });

  it('returns 0.0 for empty sets', () => {
    const setA = new Set();
    const setB = new Set();
    assert.equal(calculateJaccardSimilarity(setA, setB), 0.0);
  });

  it('accepts Set inputs', () => {
    const setA = new Set(['Account.Create::true']);
    const setB = new Set(['Account.Create::true']);
    assert.equal(calculateJaccardSimilarity(setA, setB), 1.0);
  });

  it('accepts Array inputs', () => {
    const arrA = ['Account.Create::true', 'ManageUsers::true'];
    const arrB = ['Account.Create::true', 'ManageUsers::true'];
    assert.equal(calculateJaccardSimilarity(arrA, arrB), 1.0);
  });
});

describe('calculateOverlapPercentage', () => {
  it('returns 1.0 when smaller set is complete subset', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['Account.Create::true', 'ManageUsers::true', 'ViewSetup::true']);
    assert.equal(calculateOverlapPercentage(setA, setB), 1.0);
  });

  it('returns 0.0 for empty set', () => {
    const setA = new Set();
    const setB = new Set(['Account.Create::true']);
    assert.equal(calculateOverlapPercentage(setA, setB), 0.0);
  });

  it('returns correct ratio for partial overlap', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['ManageUsers::true', 'Contact.Read::true']);
    const result = calculateOverlapPercentage(setA, setB);
    assert.equal(result, 0.5);
  });

  it('handles disjoint sets', () => {
    const setA = new Set(['Account.Create::true']);
    const setB = new Set(['Contact.Read::true']);
    assert.equal(calculateOverlapPercentage(setA, setB), 0.0);
  });
});

describe('calculateComplexityScore', () => {
  it('returns 0 for zero users', () => {
    assert.equal(calculateComplexityScore(10, 0), 0);
  });

  it('computes ratio for non-zero users', () => {
    assert.equal(calculateComplexityScore(100, 20), 5);
  });

  it('handles fractional results', () => {
    assert.equal(calculateComplexityScore(10, 3), 10 / 3);
  });
});

describe('setIntersection', () => {
  it('returns common elements only', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['ManageUsers::true', 'Contact.Read::true']);
    const result = setIntersection(setA, setB);
    assert.equal(result.size, 1);
    assert.ok(result.has('ManageUsers::true'));
  });

  it('returns empty set for disjoint inputs', () => {
    const setA = new Set(['Account.Create::true']);
    const setB = new Set(['Contact.Read::true']);
    const result = setIntersection(setA, setB);
    assert.equal(result.size, 0);
  });

  it('returns empty set for empty inputs', () => {
    const setA = new Set();
    const setB = new Set();
    const result = setIntersection(setA, setB);
    assert.equal(result.size, 0);
  });

  it('accepts Array inputs', () => {
    const arrA = ['Account.Create::true', 'ManageUsers::true'];
    const arrB = ['ManageUsers::true'];
    const result = setIntersection(arrA, arrB);
    assert.equal(result.size, 1);
    assert.ok(result.has('ManageUsers::true'));
  });
});

describe('setDifference', () => {
  it('returns elements in A not in B', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['ManageUsers::true', 'Contact.Read::true']);
    const result = setDifference(setA, setB);
    assert.equal(result.size, 1);
    assert.ok(result.has('Account.Create::true'));
  });

  it('returns empty set for identical sets', () => {
    const setA = new Set(['Account.Create::true', 'ManageUsers::true']);
    const setB = new Set(['Account.Create::true', 'ManageUsers::true']);
    const result = setDifference(setA, setB);
    assert.equal(result.size, 0);
  });

  it('returns all elements when sets are disjoint', () => {
    const setA = new Set(['Account.Create::true']);
    const setB = new Set(['Contact.Read::true']);
    const result = setDifference(setA, setB);
    assert.equal(result.size, 1);
    assert.ok(result.has('Account.Create::true'));
  });
});
