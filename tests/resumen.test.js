const test = require('node:test');
const assert = require('node:assert');
const R = require('../backend/Resumen.js');
const estados = [
  { expediente: '100/2026', nombre_obra: 'Bacheo Norte', monto: 1000, oficina_actual: 'CONTADURIA GENERAL', dias_quieto: 3 },
  { expediente: '200/2026', nombre_obra: 'Calle <Sur>', monto: 500, oficina_actual: 'FISCALIA MUNICIPAL', dias_quieto: 15 },
  { expediente: '300/2026', nombre_obra: 'Sin dato', monto: 0, oficina_actual: '', dias_quieto: '' },
  { expediente: '', nombre_obra: '' }
];
const movs = [
  { expediente: '100/2026', oficina: 'CONTADURIA GENERAL', detectado_en: '19/10/2026', dias_en_oficina_anterior: 4 },
  { expediente: '200/2026', oficina: 'FISCALIA MUNICIPAL', detectado_en: '18/10/2026', dias_en_oficina_anterior: 2 },
  { expediente: '400/2026', oficina: 'COBRADO', detectado_en: '19/10/2026', dias_en_oficina_anterior: 1 }
];
test('armarResumen: solo movimientos del día, situación por oficina y quietos', () => {
  const r = R.armarResumen(estados, movs, '19/10/2026', 10);
  assert.strictEqual(r.cantMov, 2);
  assert.match(r.asunto, /2 movimiento/);
  assert.match(r.texto, /100\/2026 Bacheo Norte: Pasó a CONTADURIA GENERAL \(4 días/);
  assert.match(r.texto, /400\/2026 : Cobrado/);
  assert.match(r.texto, /3 expedientes a cobrar/);
  assert.match(r.texto, /Sin dato del municipio: 1/);
  assert.match(r.texto, /QUIETOS MÁS DE 10 DÍAS HÁBILES \(1\)/);
  assert.ok(r.html.includes('Calle &lt;Sur&gt;'));
});
test('armarResumen: día sin movimientos igual arma el mail', () => {
  const r = R.armarResumen(estados, movs, '20/10/2026', 10);
  assert.strictEqual(r.cantMov, 0);
  assert.match(r.asunto, /sin movimientos/);
  assert.match(r.texto, /Sin movimientos hoy/);
});
test('destinatariosResumen: mails_resumen, si no mails_alerta, si no el dueño', () => {
  assert.deepStrictEqual(R.destinatariosResumen({ mails_resumen: 'a@x, b@x', mails_alerta: 'c@x' }, 'd@x'), ['a@x', 'b@x']);
  assert.deepStrictEqual(R.destinatariosResumen({ mails_alerta: 'c@x' }, 'd@x'), ['c@x']);
  assert.deepStrictEqual(R.destinatariosResumen({}, 'd@x'), ['d@x']);
});
