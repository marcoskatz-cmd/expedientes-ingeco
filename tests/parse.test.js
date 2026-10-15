const test = require('node:test');
const assert = require('node:assert');
const P = require('../backend/Parse.js');

test('parseExpediente formatos válidos', () => {
  assert.deepStrictEqual(P.parseExpediente('240034/2026'), { nro: '240034', anio: '2026', clave: '240034/2026' });
  assert.deepStrictEqual(P.parseExpediente(' 1278/25 '), { nro: '1278', anio: '2025', clave: '1278/2025' });
  assert.deepStrictEqual(P.parseExpediente('241197/2025'), { nro: '241197', anio: '2025', clave: '241197/2025' });
});
test('parseExpediente inválidos → null', () => {
  for (const x of ['s/e', '', null, undefined, '242028 - expediente madre', 'mayo-13', 240034]) {
    assert.strictEqual(P.parseExpediente(x), null, String(x));
  }
});
test('parseFecha', () => {
  assert.strictEqual(P.parseFecha('04/09/2025').toISOString().slice(0, 10), '2025-09-04');
  assert.strictEqual(P.parseFecha('11/3/25').toISOString().slice(0, 10), '2025-03-11');
  assert.strictEqual(P.parseFecha('2026-02-13T00:00:00.000Z').toISOString().slice(0, 10), '2026-02-13');
  assert.strictEqual(P.parseFecha(new Date(2026, 0, 5)).getDate(), 5);
  assert.strictEqual(P.parseFecha('31/02/2025'), null);
  assert.strictEqual(P.parseFecha(''), null);
  assert.strictEqual(P.parseFecha('ayer'), null);
});
test('fmtFecha', () => assert.strictEqual(P.fmtFecha(new Date(2026, 9, 15)), '15/10/2026'));
test('normOficina', () => {
  assert.strictEqual(P.normOficina(' Tesorería  General '), 'TESORERIA GENERAL');
  assert.strictEqual(P.normOficina('Dirección de Obras Viales'), 'DIRECCION DE OBRAS VIALES');
  assert.strictEqual(P.normOficina(null), '');
});
test('diasHabiles', () => {
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 6), new Date(2025, 9, 20)), 10);
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 6), new Date(2025, 9, 6)), 0);
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 10), new Date(2025, 9, 13)), 1);
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 20), new Date(2025, 9, 6)), 0);
});
test('sumarDiasHabiles', () => {
  assert.strictEqual(P.fmtFecha(P.sumarDiasHabiles(new Date(2025, 9, 10), 1)), '13/10/2025');
  assert.strictEqual(P.fmtFecha(P.sumarDiasHabiles(new Date(2025, 9, 6), 10)), '20/10/2025');
});
