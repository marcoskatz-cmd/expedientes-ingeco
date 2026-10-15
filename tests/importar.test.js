const test = require('node:test');
const assert = require('node:assert');
const I = require('../backend/Importar.js');

test('trazabilidadAMovimientos dedup, orden y días', () => {
  const filas = [
    { Expediente: '241096/2025', 'Ultimo Movimiento': '28/08/2025', Oficina: 'Fiscalía Municipal' },
    { Expediente: '241096/2025', 'Ultimo Movimiento': '28/08/2025', Oficina: 'Fiscalia Municipal ' },
    { Expediente: '241096/2025', 'Ultimo Movimiento': '15/08/2025', Oficina: 'Dirección de Obras Viales' },
    { Expediente: 's/e', 'Ultimo Movimiento': '01/01/2025', Oficina: 'X' },
    { Expediente: '1/2025', 'Ultimo Movimiento': '', Oficina: 'X' },
    { Expediente: '1/2025', 'Ultimo Movimiento': '01/01/2025', Oficina: '' }
  ];
  const r = I.trazabilidadAMovimientos(filas, new Date(2026, 9, 15));
  assert.strictEqual(r.descartadas, 4);
  assert.strictEqual(r.movimientos.length, 2);
  assert.strictEqual(r.movimientos[0].oficina, 'Dirección de Obras Viales');
  assert.strictEqual(r.movimientos[0].dias_en_oficina_anterior, '');
  assert.strictEqual(r.movimientos[1].dias_en_oficina_anterior, 9);
  assert.strictEqual(r.movimientos[1].origen, 'importado');
  assert.strictEqual(r.movimientos[1].detectado_en, '15/10/2026');
});
test('rutaContratosARutas', () => {
  const raw = [
    ['', '', ''],
    ['', 'Contratacion directa', ''],
    ['', 'Se genera expediente en Obras Viales', ''],
    ['', 'Secretaria de Obras ', 'Para autorizar el tramite'],
    ['', 'Secretaria de Economia y Hacienda ', 'Autoriza el tramite'],
    ['', 'Tesorería General', 'Paga'],
    ['', '', ''],
    ['', 'Reconocimiento de Servicio', ''],
    ['', 'Secretaria de Obras', 'inicio']
  ];
  const r = I.rutaContratosARutas(raw);
  assert.deepStrictEqual(r.map(x => [x.tipo_contrato, x.orden, x.oficina]), [
    ['Contratación Directa', 1, 'DIRECCION DE OBRAS VIALES'],
    ['Contratación Directa', 2, 'SECRETARIA DE OBRAS'],
    ['Contratación Directa', 3, 'SECRETARIA DE ECONOMIA Y HACIENDA'],
    ['Contratación Directa', 4, 'TESORERIA GENERAL'],
    ['Reconocimiento de Servicio', 1, 'SECRETARIA DE OBRAS']
  ]);
  assert.strictEqual(r[3].etapa, 'Cobro');
  assert.strictEqual(r[0].etapa, 'Preliminar');
  assert.strictEqual(r[0].dias_default, 10);
});
