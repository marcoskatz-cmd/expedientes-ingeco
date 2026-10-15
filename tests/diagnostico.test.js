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
test('maestroAExpedientes usa Monto Total cuando Monto está vacío o en 0', () => {
  const objs = [
    { 'Nombre Obra': 'A', Expediente: '1/2026', 'Estado $': 'A Cobrar', Monto: '', 'Monto Total': ' $1.500,50 ', 'Tipo de contrato': 'x', __fila: 2 },
    { 'Nombre Obra': 'B', Expediente: '2/2026', 'Estado $': 'A Cobrar', Monto: 0, 'Monto Total': 800, 'Tipo de contrato': 'x', __fila: 3 },
    { 'Nombre Obra': 'C', Expediente: '3/2026', 'Estado $': 'A Cobrar', Monto: 10, 'Monto Total': 999, 'Tipo de contrato': 'x', __fila: 4 }
  ];
  const r = D.maestroAExpedientes(objs, CFG.COLS_MAESTRO);
  assert.deepStrictEqual(r.activos.map(a => a.monto), [1500.5, 800, 10]);
});
test('maestroAExpedientes solo toma Estado $ "A Cobrar"; TOTAL, vacío y otros quedan afuera', () => {
  const base = { 'Nombre Obra': 'X', 'Tipo de contrato': 'x', Monto: 1 };
  const objs = [
    Object.assign({}, base, { Expediente: '1/2026', 'Estado $': 'A Cobrar', __fila: 2 }),
    Object.assign({}, base, { Expediente: '2/2026', 'Estado $': ' a cobrar ', __fila: 3 }),
    Object.assign({}, base, { Expediente: '3/2026', 'Estado $': 'TOTAL', __fila: 4 }),
    Object.assign({}, base, { Expediente: '4/2026', 'Estado $': '', __fila: 5 }),
    Object.assign({}, base, { Expediente: '5/2026', 'Estado $': 'Cobrada', __fila: 6 })
  ];
  const r = D.maestroAExpedientes(objs, CFG.COLS_MAESTRO);
  assert.deepStrictEqual(r.activos.map(a => a.clave), ['1/2026', '2/2026']);
  assert.strictEqual(r.cobrados, 1);
  assert.strictEqual(r.otros, 2);
  assert.strictEqual(r.sinExpediente.length, 0);
});
test('maestroAExpedientes devuelve las claves de los cobrados', () => {
  const r = D.maestroAExpedientes([{ 'Nombre Obra': 'A', Expediente: '7/2026', 'Estado $': 'Cobrada', Monto: 1, 'Tipo de contrato': '', __fila: 2 }], CFG.COLS_MAESTRO);
  assert.deepStrictEqual(r.cobradosClaves, ['7/2026']);
});
test('maestroAExpedientes excluye expedientes madre (en nombre u observaciones, incluso mal escrito)', () => {
  const base = { 'Estado $': 'A Cobrar', Monto: 1, 'Tipo de contrato': 'x' };
  const objs = [
    Object.assign({}, base, { 'Nombre Obra': 'Compra de mezcla asfaltica, EXPTE MADRE', Expediente: '1/2026', __fila: 2 }),
    Object.assign({}, base, { 'Nombre Obra': 'Obra X', Expediente: '2/2026', Observaciones: '242028 - expediente masdre', __fila: 3 }),
    Object.assign({}, base, { 'Nombre Obra': 'Obra Y (Expediente Madre)', Expediente: '3/2026', __fila: 4 }),
    Object.assign({}, base, { 'Nombre Obra': 'Cert 1 - hijo del madre 1/2026', Expediente: '4/2026', __fila: 5 })
  ];
  const r = D.maestroAExpedientes(objs, CFG.COLS_MAESTRO);
  assert.deepStrictEqual(r.activos.map(a => a.clave), ['4/2026']);
  assert.strictEqual(r.madres, 3);
});
test('maestroAExpedientes excluye al expediente que otra fila nombra como madre', () => {
  const base = { 'Estado $': 'A Cobrar', Monto: 1, 'Tipo de contrato': 'x' };
  const objs = [
    Object.assign({}, base, { 'Nombre Obra': 'Compra de 400 m3 de hormigón', Expediente: '90101/2026', __fila: 2 }),
    Object.assign({}, base, { 'Nombre Obra': 'cert. 1 prov hormigon - expte 90101/2026(madre)', Expediente: '90202/2026', __fila: 3 }),
    Object.assign({}, base, { 'Nombre Obra': 'Otra obra', Expediente: '5/2026', __fila: 4 })
  ];
  const r = D.maestroAExpedientes(objs, CFG.COLS_MAESTRO);
  assert.deepStrictEqual(r.activos.map(a => a.clave), ['90202/2026', '5/2026']);
  assert.strictEqual(r.madres, 1);
});
