import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFabricName, resolveFabricClass } from './fabric-class.ts';

test('only Microfiber, Michael Angelo, and Diamond Ripstop are Class B', () => {
  assert.equal(resolveFabricClass('Microfiber'), 'B');
  assert.equal(resolveFabricClass('Michael Angelo'), 'B');
  assert.equal(resolveFabricClass('Diamond Ripstop'), 'B');
});

test('every other listed fabric is Class A', () => {
  for (const fabric of ['Twill', 'Brush Cotton', 'Marks & Spencer', 'Stellini', 'Vellini', 'Dri-Fit', 'Cotton Fleece', 'Scrub Suit Poly-Cotton']) {
    assert.equal(resolveFabricClass(fabric), 'A', fabric);
  }
});

test('custom and unlisted fabrics default to Class A', () => {
  assert.equal(resolveFabricClass('Some Custom Blend'), 'A');
  assert.equal(resolveFabricClass('Microfiber Blend'), 'A');
});

test('blank, missing, and non-string input is Class A', () => {
  assert.equal(resolveFabricClass(''), 'A');
  assert.equal(resolveFabricClass('   '), 'A');
  assert.equal(resolveFabricClass(undefined), 'A');
  assert.equal(resolveFabricClass(null), 'A');
  assert.equal(resolveFabricClass(42), 'A');
});

test('matching ignores case, outer whitespace, and repeated inner spaces', () => {
  assert.equal(resolveFabricClass('  MICHAEL   angelo '), 'B');
  assert.equal(resolveFabricClass('  MICROFIBER  '), 'B');
  assert.equal(resolveFabricClass('diamond    ripstop'), 'B');
  assert.equal(resolveFabricClass('diamond ripstop'), 'B');
});

test('normalizeFabricName trims, collapses spaces, and lowercases', () => {
  assert.equal(normalizeFabricName('  Diamond   Ripstop '), 'diamond ripstop');
  assert.equal(normalizeFabricName(undefined), '');
});
