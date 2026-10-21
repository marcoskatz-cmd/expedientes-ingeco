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
test('interpretarRespuesta acepta curso sin fecha y guarda los comentarios', () => {
  const r = M.interpretarRespuesta({ expediente: { fecha: '2025-07-11T03:00:00.000Z', asunto: 'x' }, curso: { fecha: null, descripcion: 'TESORERIA GENERAL', comentarios: 'C/LBTO 06553 \r\n\r\n' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fechaPase, null);
  assert.strictEqual(r.comentarios, 'C/LBTO 06553');
});
test('compararEstado sin fecha: misma oficina → sin cambio; otra oficina → movimiento fechado hoy', () => {
  const previo = { oficina_actual: 'Tesorería General', desde: '12/02/2026', alerta_enviada_en: '' };
  const sinFecha = { ok: true, oficina: 'TESORERIA GENERAL', oficinaNorm: 'TESORERIA GENERAL', fechaPase: null, asunto: 'a', comentarios: '' };
  const r1 = M.compararEstado(previo, sinFecha, exp, hoy);
  assert.strictEqual(r1.cambio, false);
  assert.strictEqual(r1.estado.desde, '12/02/2026');
  const otra = Object.assign({}, sinFecha, { oficina: 'Contaduría', oficinaNorm: 'CONTADURIA' });
  const r2 = M.compararEstado(previo, otra, exp, hoy);
  assert.strictEqual(r2.cambio, true);
  assert.strictEqual(r2.movimiento.fecha_pase, '15/10/2026');
  assert.strictEqual(r2.estado.desde, '15/10/2026');
  const r3 = M.compararEstado(null, sinFecha, exp, hoy);
  assert.strictEqual(r3.movimiento.fecha_pase, '15/10/2026');
});
test('cerrarCobrados: el expediente que pasó a Cobrada cierra su estadía con un movimiento COBRADO', () => {
  const previos = { '1/2026': { oficina_actual: 'Tesorería General', desde: '01/10/2026' }, '2/2026': { oficina_actual: 'Contaduría', desde: '05/10/2026' }, '3/2026': { oficina_actual: '', desde: '' } };
  const r = M.cerrarCobrados(previos, ['1/2026', '3/2026', '9/2026'], hoy);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].expediente, '1/2026');
  assert.strictEqual(r[0].oficina, 'COBRADO');
  assert.strictEqual(r[0].fecha_pase, '15/10/2026');
  assert.strictEqual(r[0].dias_en_oficina_anterior, 10);
  assert.strictEqual(r[0].origen, 'bot');
});

test('hora del pase: HH:MM sin fracción; vacía si el pase no tiene fecha', () => {
  const r = M.interpretarRespuesta({ expediente: {}, curso: { descripcion: 'Tesorería', fecha: '2026-02-05T03:00:00.000Z', hora: '9:16:18.2306', idestado: 2, idcurso: 77 } });
  assert.strictEqual(r.hora, '09:16');
  assert.strictEqual(r.estadoPase, 2);
  assert.strictEqual(r.idCurso, 77);
  const s = M.interpretarRespuesta({ expediente: {}, curso: { descripcion: 'Tesorería', fecha: null, hora: null, idestado: 1 } });
  assert.strictEqual(s.hora, '');
  assert.strictEqual(s.estadoPase, 1);
});
test('hora del pase va al movimiento y al estado; sin cambio conserva la anterior', () => {
  const lect = { ok: true, oficina: 'Fiscalía', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 12), asunto: 'a', hora: '13:03', estadoPase: 2, idCurso: 5 };
  const r = M.compararEstado(null, lect, exp, hoy);
  assert.strictEqual(r.movimiento.hora_pase, '13:03');
  assert.strictEqual(r.estado.hora_pase, '13:03');
  assert.strictEqual(r.estado.estado_pase, 2);
  const previo = { oficina_actual: 'Fiscalía', desde: '12/10/2026', hora_pase: '13:03' };
  const r2 = M.compararEstado(previo, Object.assign({}, lect, { hora: '' }), exp, hoy);
  assert.strictEqual(r2.cambio, false);
  assert.strictEqual(r2.estado.hora_pase, '13:03');
});
