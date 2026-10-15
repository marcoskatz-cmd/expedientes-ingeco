const test = require('node:test');
const assert = require('node:assert');
const Pr = require('../backend/Proyeccion.js');
const hoy = new Date(2026, 9, 15);
const rutas = [
  { tipo_contrato: 'Contratación Directa', orden: 1, oficina: 'DIRECCION DE OBRAS VIALES', etapa: 'Preliminar', dias_default: 5 },
  { tipo_contrato: 'Contratación Directa', orden: 2, oficina: 'SECRETARIA DE OBRAS', etapa: 'Media', dias_default: 7 },
  { tipo_contrato: 'Contratación Directa', orden: 3, oficina: 'TESORERIA GENERAL', etapa: 'Cobro', dias_default: 3 }
];

test('mediana', () => {
  assert.strictEqual(Pr.mediana([3, 1, 2]), 2);
  assert.strictEqual(Pr.mediana([4, 1, 3, 2]), 2.5);
  assert.strictEqual(Pr.mediana([]), 0);
});
test('medianasPorOficina asigna días a la oficina anterior', () => {
  const movs = [
    { expediente: '1/2026', fecha_pase: '01/09/2026', oficina: 'Obras Viales', dias_en_oficina_anterior: '' },
    { expediente: '1/2026', fecha_pase: '10/09/2026', oficina: 'Secretaría de Obras', dias_en_oficina_anterior: 7 },
    { expediente: '1/2026', fecha_pase: '20/09/2026', oficina: 'Tesorería', dias_en_oficina_anterior: 8 },
    { expediente: '2/2026', fecha_pase: '01/09/2026', oficina: 'Obras Viales', dias_en_oficina_anterior: '' },
    { expediente: '2/2026', fecha_pase: '05/09/2026', oficina: 'Secretaría de Obras', dias_en_oficina_anterior: 3 }
  ];
  const canon = { 'OBRAS VIALES': 'DIRECCION DE OBRAS VIALES', 'SECRETARIA DE OBRAS': 'SECRETARIA DE OBRAS' };
  const r = Pr.medianasPorOficina(movs, canon);
  assert.deepStrictEqual(r['DIRECCION DE OBRAS VIALES'], { mediana_dias: 5, casos: 2 });
  assert.deepStrictEqual(r['SECRETARIA DE OBRAS'], { mediana_dias: 8, casos: 1 });
});
test('proyectar con historia suficiente', () => {
  const stats = { 'SECRETARIA DE OBRAS': { mediana_dias: 10, casos: 6 }, 'TESORERIA GENERAL': { mediana_dias: 4, casos: 6 } };
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Secretaria de Obras', dias_quieto: 3 };
  const r = Pr.proyectar(est, rutas, stats, hoy, 5, {});
  assert.strictEqual(r.etapa, 'Media');
  assert.strictEqual(r.paso_en_ruta, 2);
  assert.strictEqual(r.dias_restantes_est, 7 + 4);
  assert.strictEqual(r.calidad_estimacion, 'buena');
  assert.strictEqual(r.fecha_cobro_est, '30/10/2026');
});
test('proyectar sin casos usa default y marca débil; ya pasó la mediana → 0 en la actual', () => {
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Secretaria de Obras', dias_quieto: 20 };
  const r = Pr.proyectar(est, rutas, {}, hoy, 5, {});
  assert.strictEqual(r.dias_restantes_est, 0 + 3);
  assert.strictEqual(r.calidad_estimacion, 'debil');
});
test('proyectar fuera de ruta', () => {
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Intendencia', dias_quieto: 1 };
  const r = Pr.proyectar(est, rutas, {}, hoy, 5, {});
  assert.strictEqual(r.etapa, 'Fuera de ruta');
  assert.strictEqual(r.dias_restantes_est, '');
  assert.strictEqual(r.paso_en_ruta, '');
});
test('proyectar tipo sin ruta cae a Contratación Directa y es débil', () => {
  const est = { tipo_contrato: 'Reconocimiento de Servicio', oficina_actual: 'Tesorería General', dias_quieto: 0 };
  const stats = { 'TESORERIA GENERAL': { mediana_dias: 4, casos: 9 } };
  const r = Pr.proyectar(est, rutas, stats, hoy, 5, {});
  assert.strictEqual(r.etapa, 'Cobro');
  assert.strictEqual(r.calidad_estimacion, 'debil');
  assert.strictEqual(r.dias_restantes_est, 4);
});

test('proyectar compara tipo de contrato sin tildes ni mayúsculas', () => {
  const est = { tipo_contrato: 'CONTRATACION DIRECTA', oficina_actual: 'Secretaria de Obras', dias_quieto: 0 };
  const stats = { 'SECRETARIA DE OBRAS': { mediana_dias: 10, casos: 6 }, 'TESORERIA GENERAL': { mediana_dias: 4, casos: 6 } };
  const r = Pr.proyectar(est, rutas, stats, hoy, 5, {});
  assert.strictEqual(r.calidad_estimacion, 'buena');
  assert.strictEqual(r.dias_restantes_est, 14);
});
test('proyectar busca la mediana por el nombre canónico de la oficina de la ruta', () => {
  const canon = { 'SECRETARIA DE OBRAS': 'SEC OBRAS' };
  const stats = { 'SEC OBRAS': { mediana_dias: 10, casos: 6 }, 'TESORERIA GENERAL': { mediana_dias: 4, casos: 6 } };
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Secretaría de Obras', dias_quieto: 0 };
  const r = Pr.proyectar(est, rutas, stats, hoy, 5, canon);
  assert.strictEqual(r.calidad_estimacion, 'buena');
  assert.strictEqual(r.dias_restantes_est, 14);
});
test('proyectar usa la ruta general (*) sin marcar débil cuando el tipo no tiene ruta propia', () => {
  const general = [
    { tipo_contrato: '*', orden: 1, oficina: 'CONTADURIA GENERAL', etapa: 'Final', dias_default: 2 },
    { tipo_contrato: '*', orden: 2, oficina: 'TESORERIA GENERAL', etapa: 'Cobro', dias_default: 3 }
  ];
  const stats = { 'CONTADURIA GENERAL': { mediana_dias: 2, casos: 97 }, 'TESORERIA GENERAL': { mediana_dias: 9, casos: 10 } };
  const r = Pr.proyectar({ tipo_contrato: 'Provisión', oficina_actual: 'Contaduría General', dias_quieto: 1 }, general, stats, hoy, 5, {});
  assert.strictEqual(r.calidad_estimacion, 'buena');
  assert.strictEqual(r.dias_restantes_est, 1 + 9);
  assert.strictEqual(r.etapa, 'Final');
});
