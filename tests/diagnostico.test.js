const test = require('node:test');
const assert = require('node:assert');
const D = require('../backend/Diagnostico.js');
const { CFG } = require('../backend/Config.js');

test('diagnosticarEncabezados detecta faltantes', () => {
  assert.deepStrictEqual(D.diagnosticarEncabezados(['Nombre Obra', 'Expediente'], CFG.COLS_MAESTRO_OBLIGATORIAS),
    { ok: false, faltan: ['Estado $', 'Monto', 'Tipo de contrato'] });
  assert.deepStrictEqual(D.diagnosticarEncabezados(CFG.COLS_MAESTRO_OBLIGATORIAS.concat(['x']), CFG.COLS_MAESTRO_OBLIGATORIAS), { ok: true, faltan: [] });
});
test('filasAObjetos usa encabezados con trim y salta filas vacías', () => {
  const r = D.filasAObjetos([[' Expediente ', 'Monto'], ['1/2026', 5], ['', '']]);
  assert.deepStrictEqual(r, [{ Expediente: '1/2026', Monto: 5, __fila: 2 }]);
});
test('maestroAExpedientes separa activos, sin expediente y cobrados', () => {
  const objs = [
    { 'Nombre Obra': 'A', Expediente: '240034/2026', 'Estado $': 'A Cobrar', Monto: ' $235.718.068,87 ', 'Tipo de contrato': 'Contratación Directa', __fila: 2 },
    { 'Nombre Obra': 'B', Expediente: 's/e', 'Estado $': 'A Cobrar', Monto: '', 'Tipo de contrato': '', __fila: 3 },
    { 'Nombre Obra': 'C', Expediente: '1278/2025', 'Estado $': 'Cobrada ', Monto: 1, 'Tipo de contrato': '', __fila: 4 },
    { 'Nombre Obra': '', Expediente: '', 'Estado $': '', Monto: '', 'Tipo de contrato': '', __fila: 5 }
  ];
  const r = D.maestroAExpedientes(objs, CFG.COLS_MAESTRO);
  assert.strictEqual(r.activos.length, 1);
  assert.strictEqual(r.activos[0].clave, '240034/2026');
  assert.strictEqual(r.activos[0].monto, 235718068.87);
  assert.strictEqual(r.activos[0].prioridad, 'Normal');
  assert.deepStrictEqual(r.sinExpediente, [{ nombre: 'B', texto: 's/e', fila: 3 }]);
  assert.strictEqual(r.cobrados, 1);
});
test('parseMonto', () => {
  assert.strictEqual(D.parseMonto(' $352.350.310,00 '), 352350310);
  assert.strictEqual(D.parseMonto(1234.5), 1234.5);
  assert.strictEqual(D.parseMonto(''), 0);
});
