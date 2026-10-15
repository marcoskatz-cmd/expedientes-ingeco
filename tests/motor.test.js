const test = require('node:test');
const assert = require('node:assert');
const M = require('../backend/Motor.js');
const hoy = new Date(2026, 9, 15);
const exp = { clave: '240034/2026', nombre: 'Obra X', monto: 100, tipo: 'Contratación Directa', prioridad: 'Alta', inicio: null };

test('interpretarRespuesta válida', () => {
  const r = M.interpretarRespuesta({ expediente: { fecha: '2025-10-17T00:00:00.000Z', asunto: 'Limpieza' }, curso: { fecha: '13/02/2026', descripcion: 'Tesorería General ' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.oficina, 'Tesorería General');
  assert.strictEqual(r.oficinaNorm, 'TESORERIA GENERAL');
  assert.strictEqual(r.fechaPase.getMonth(), 1);
  assert.strictEqual(r.fechaInicio.getDate(), 17);
});
test('interpretarRespuesta vacía / sin curso / fecha inválida', () => {
  assert.strictEqual(M.interpretarRespuesta(null).ok, false);
  assert.strictEqual(M.interpretarRespuesta({}).ok, false);
  assert.strictEqual(M.interpretarRespuesta({ expediente: {}, curso: { descripcion: 'X', fecha: 'nunca' } }).ok, false);
  assert.strictEqual(M.interpretarRespuesta({ curso: { descripcion: '', fecha: '01/01/2026' } }).ok, false);
});
test('primer registro genera movimiento con origen bot y sin días previos', () => {
  const lect = { ok: true, oficina: 'Fiscalía', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 12), asunto: 'a', fechaInicio: null };
  const r = M.compararEstado(null, lect, exp, hoy);
  assert.strictEqual(r.cambio, true);
  assert.strictEqual(r.movimiento.origen, 'bot');
  assert.strictEqual(r.movimiento.dias_en_oficina_anterior, '');
  assert.strictEqual(r.estado.oficina_actual, 'Fiscalía');
  assert.strictEqual(r.estado.desde, '12/10/2026');
  assert.strictEqual(r.estado.dias_quieto, 3);
});
test('misma oficina con distinto formato → sin cambio', () => {
  const previo = { oficina_actual: 'Fiscalia', desde: '12/10/2026', alerta_enviada_en: 'x' };
  const lect = { ok: true, oficina: 'FISCALÍA ', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 12), asunto: 'a' };
  const r = M.compararEstado(previo, lect, exp, hoy);
  assert.strictEqual(r.cambio, false);
  assert.strictEqual(r.movimiento, null);
  assert.strictEqual(r.estado.alerta_enviada_en, 'x');
  assert.strictEqual(r.estado.dias_quieto, 3);
});
test('cambio de oficina genera movimiento con días en la anterior y limpia alerta', () => {
  const previo = { oficina_actual: 'Fiscalía', desde: '01/10/2026', alerta_enviada_en: 'x' };
  const lect = { ok: true, oficina: 'Tesorería', oficinaNorm: 'TESORERIA', fechaPase: new Date(2026, 9, 14), asunto: 'a' };
  const r = M.compararEstado(previo, lect, exp, hoy);
  assert.strictEqual(r.cambio, true);
  assert.strictEqual(r.movimiento.oficina, 'Tesorería');
  assert.strictEqual(r.movimiento.dias_en_oficina_anterior, 9);
  assert.strictEqual(r.estado.alerta_enviada_en, '');
  assert.strictEqual(r.estado.desde, '14/10/2026');
});
test('misma oficina pero fecha de pase nueva → movimiento (pase interno)', () => {
  const previo = { oficina_actual: 'Fiscalía', desde: '01/10/2026', alerta_enviada_en: '' };
  const lect = { ok: true, oficina: 'Fiscalía', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 14), asunto: 'a' };
  const r = M.compararEstado(previo, lect, exp, hoy);
  assert.strictEqual(r.cambio, true);
  assert.strictEqual(r.estado.desde, '14/10/2026');
});
test('nuevoId distinto cada vez', () => assert.notStrictEqual(M.nuevoId(), M.nuevoId()));
test('previoDesdeMovimientos toma el último movimiento de cada expediente', () => {
  const movs = [
    { expediente: '1/2026', fecha_pase: '01/09/2026', oficina: 'A' },
    { expediente: '1/2026', fecha_pase: '10/09/2026', oficina: 'B' },
    { expediente: '2/2026', fecha_pase: '05/09/2026', oficina: 'C' }
  ];
  const r = M.previoDesdeMovimientos(movs);
  assert.deepStrictEqual(r['1/2026'], { oficina_actual: 'B', desde: '10/09/2026', alerta_enviada_en: '' });
  assert.deepStrictEqual(r['2/2026'], { oficina_actual: 'C', desde: '05/09/2026', alerta_enviada_en: '' });
});
test('previoDesdeMovimientos acepta fecha_pase como Date (Sheets la convierte)', () => {
  const r = M.previoDesdeMovimientos([{ expediente: '1/2026', fecha_pase: new Date(2026, 8, 10), oficina: 'B' }]);
  assert.strictEqual(r['1/2026'].desde, '10/09/2026');
});
