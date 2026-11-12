const test = require('node:test');
const assert = require('node:assert');
const Pr = require('../backend/Proyeccion.js');
const hoy = new Date(2026, 9, 15);

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

// Circuito real (hoja RUTAS, 12-nov-2026): las oficinas se repiten.
const OF = { DOV: 'DIRECCION DE OBRAS VIALES', SOP: 'SECRETARIA DE OBRAS PUBLICAS', PLA: 'DIRECCION DE PLANEAMIENTO Y PRESUPUESTO', ECO: 'SECRETARIA DE ECONOMIA Y HACIENDA', CON: 'CONTADURIA GENERAL', FIS: 'FISCALIA MUNICIPAL', GOB: 'SECRETARIA DE GOBIERNO', TES: 'TESORERIA GENERAL' };
const CIRC = [['DOV', 'Preliminar'], ['SOP', 'Preliminar'], ['PLA', 'Preliminar'], ['ECO', 'Preliminar'], ['SOP', 'Preliminar'], ['CON', 'Media'], ['FIS', 'Media'], ['SOP', 'Media'], ['GOB', 'Media'], ['SOP', 'Media'], ['DOV', 'Final'], ['CON', 'Final'], ['TES', 'Cobro']];
const circuito = CIRC.map(([o, et], i) => ({ tipo_contrato: '*', orden: i + 1, oficina: OF[o], etapa: et, dias_default: 2 }));
const ofsCirc = CIRC.map(([o]) => OF[o]);
const sec = t => t.split(' ').map(o => OF[o]);
// Movimientos de un expediente a partir de una secuencia de oficinas, un día de por medio.
const movsDe = (exp, t, dias) => sec(t).map((of, i) => ({ expediente: exp, fecha_pase: String(i + 1).padStart(2, '0') + '/09/2026', oficina: of, dias_en_oficina_anterior: i ? (dias ? dias[i - 1] : 1) : '' }));
const pasoDe = (t, ini) => Pr.ubicar(sec(t), ofsCirc, ini || 0).map(i => i + 1);

test('ubicar: Obras Públicas, Obras Viales y Contaduría se cuentan por vez, no por oficina', () => {
  // 242278/2025, recorrido completo
  assert.deepStrictEqual(pasoDe('DOV SOP PLA ECO SOP CON FIS SOP GOB DOV CON'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]);
  // 241237/2026: está en Contaduría por PRIMERA vez (antes de Fiscalía), no en la liquidación final
  assert.deepStrictEqual(pasoDe('DOV PLA SOP CON'), [1, 3, 5, 6]);
});
test('ubicar: Presupuesto y Economía en cualquier orden, idas y vueltas y pasos salteados', () => {
  assert.deepStrictEqual(pasoDe('DOV ECO PLA SOP CON FIS SOP DOV CON TES'), [1, 4, 3, 5, 6, 7, 8, 11, 12, 13]); // 240691
  // 242336: vuelve a Obras Viales al principio y repite Gobierno
  assert.deepStrictEqual(pasoDe('DOV SOP ECO PLA DOV PLA SOP GOB SOP CON FIS SOP GOB SOP DOV CON TES'), [1, 2, 4, 3, 1, 3, 5, 9, 10, 12, 7, 8, 9, 10, 11, 12, 13]);
  // 241821/2026: historia que empieza a mitad de camino; termina en la Contaduría final
  assert.strictEqual(pasoDe('CON DOV SOP GOB SOP DOV SOP CON').pop(), 12);
  // 241622/2026: después del decreto vuelve a Obras Viales (paso 11), no al inicio
  assert.strictEqual(pasoDe('FIS SOP GOB SOP GOB DOV').pop(), 11);
});
test('ubicar: certificados arrancan en el tramo final', () => {
  const ini = Pr.inicioCertificados(circuito);
  assert.strictEqual(ini, 10);
  assert.deepStrictEqual(pasoDe('DOV CON TES', ini), [11, 12, 13]);
  assert.deepStrictEqual(pasoDe('DOV CON DOV CON TES', ini), [11, 12, 11, 12, 13]);
});
test('ubicar: oficina fuera del circuito da -1 y no mueve la posición', () => {
  assert.deepStrictEqual(Pr.ubicar([OF.DOV, 'DIRECCION DE PROYECTOS', OF.SOP], ofsCirc, 0), [0, -1, 1]);
});
test('esCertificado: por nombre, salvo que haya pasado por Fiscalía o Gobierno', () => {
  assert.strictEqual(Pr.esCertificado('certificado nro 2 - obra n° 82037*A', [OF.DOV]), true);
  assert.strictEqual(Pr.esCertificado('FONDO DE REPARO CERT. NRO 1 -82017-C', [OF.DOV]), true);
  assert.strictEqual(Pr.esCertificado('Obra Nº 82060 C, "Bacheo integral en zona sureste"', [OF.DOV]), false);
  assert.strictEqual(Pr.esCertificado('Certificado algo', [OF.FIS, OF.SOP]), false);
  // sin nombre: por la historia
  assert.strictEqual(Pr.esCertificado('', [OF.DOV, OF.CON, OF.TES]), true);
  assert.strictEqual(Pr.esCertificado('', [OF.DOV, OF.SOP]), false);
});
test('historiaDe junta pases internos y anota los días al salir (también al cobrarse)', () => {
  const movs = [
    { fecha_pase: '01/09/2026', oficina: 'Contaduría General', dias_en_oficina_anterior: '' },
    { fecha_pase: '03/09/2026', oficina: 'CONTADURIA GENERAL', dias_en_oficina_anterior: 2 },
    { fecha_pase: '08/09/2026', oficina: 'Tesorería General', dias_en_oficina_anterior: 5 },
    { fecha_pase: '10/09/2026', oficina: 'COBRADO', dias_en_oficina_anterior: 2 }
  ];
  assert.deepStrictEqual(Pr.historiaDe(movs, {}), [{ of: OF.CON, dias: 5 }, { of: OF.TES, dias: 2 }]);
});
test('medianasPorPaso separa la 1ª y la 2ª vez en la misma oficina', () => {
  const movs = [];
  for (let k = 0; k < 5; k++) movs.push(...movsDe('L' + k, 'DOV SOP PLA ECO SOP CON FIS SOP GOB SOP DOV CON TES', [1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 9]));
  const st = Pr.medianasPorPaso(movs, circuito, {});
  assert.deepStrictEqual(st[5], { mediana_dias: 3, casos: 5 });  // 1ª Contaduría
  assert.deepStrictEqual(st[11], { mediana_dias: 9, casos: 5 }); // 2ª Contaduría
  assert.deepStrictEqual(st[12], { mediana_dias: 0, casos: 0 }); // Tesorería: nunca salió
});
test('proyectar ubica por la historia y suma los pasos que faltan', () => {
  const statsPaso = circuito.map(() => ({ mediana_dias: 2, casos: 9 }));
  const est = { nombre_obra: 'reconocimiento de servicio - bacheo', oficina_actual: 'Contaduría General', dias_quieto: 1 };
  const r = Pr.proyectar(est, circuito, statsPaso, {}, hoy, 5, {}, movsDe('X', 'DOV PLA SOP CON'));
  assert.strictEqual(r.paso_en_ruta, 6);
  assert.strictEqual(r.etapa, 'Media');
  assert.strictEqual(r.circuito, 'Con decreto');
  assert.strictEqual(r.dias_restantes_est, 1 + 7 * 2);
  assert.strictEqual(r.calidad_estimacion, 'buena');
  // el mismo expediente ya en la Contaduría final
  const r2 = Pr.proyectar(est, circuito, statsPaso, {}, hoy, 5, {}, movsDe('X', 'DOV PLA SOP CON FIS SOP GOB DOV CON'));
  assert.strictEqual(r2.paso_en_ruta, 12);
  assert.strictEqual(r2.etapa, 'Final');
  assert.strictEqual(r2.dias_restantes_est, 1 + 2);
});
test('proyectar: certificado en Obras Viales va directo al tramo final', () => {
  const statsPaso = circuito.map(() => ({ mediana_dias: 2, casos: 9 }));
  const r = Pr.proyectar({ nombre_obra: 'certificado nro 1 - obra n° 82053-C', oficina_actual: 'Dirección de Obras Viales', dias_quieto: 0 }, circuito, statsPaso, {}, hoy, 5, {}, []);
  assert.strictEqual(r.paso_en_ruta, 11);
  assert.strictEqual(r.circuito, 'Certificado');
  assert.strictEqual(r.dias_restantes_est, 6);
});
test('proyectar: sin casos del paso usa la mediana de la oficina; sin eso, el default y queda débil', () => {
  const statsOf = { [OF.DOV]: { mediana_dias: 3, casos: 9 }, [OF.CON]: { mediana_dias: 3, casos: 9 }, [OF.TES]: { mediana_dias: 4, casos: 9 } };
  const est = { nombre_obra: 'x', oficina_actual: 'Tesorería General', dias_quieto: 0 };
  const r = Pr.proyectar(est, circuito, [], statsOf, hoy, 5, {}, movsDe('X', 'DOV CON TES'));
  assert.strictEqual(r.paso_en_ruta, 13);
  assert.strictEqual(r.dias_restantes_est, 4);
  assert.strictEqual(r.calidad_estimacion, 'buena');
  const r2 = Pr.proyectar(est, circuito, [], {}, hoy, 5, {}, movsDe('X', 'DOV CON TES'));
  assert.strictEqual(r2.dias_restantes_est, 2);
  assert.strictEqual(r2.calidad_estimacion, 'debil');
  assert.strictEqual(r2.fecha_cobro_est, '19/10/2026');
});
test('proyectar fuera de ruta', () => {
  const r = Pr.proyectar({ oficina_actual: 'Intendencia', dias_quieto: 1 }, circuito, [], {}, hoy, 5, {}, []);
  assert.strictEqual(r.etapa, 'Fuera de ruta');
  assert.strictEqual(r.paso_en_ruta, '');
  assert.strictEqual(r.dias_restantes_est, '');
});
test('proyectar usa el nombre canónico de la oficina', () => {
  const canon = { 'SECRETARIA DE OBRAS': OF.SOP };
  const r = Pr.proyectar({ nombre_obra: 'x', oficina_actual: 'Secretaría de Obras', dias_quieto: 0 }, circuito, [], {}, hoy, 5, canon, movsDe('X', 'DOV'));
  assert.strictEqual(r.paso_en_ruta, 2);
});
test('llegadasPorOficina cuenta expedientes distintos que pasaron por cada oficina', () => {
  const movs = [
    { expediente: '1/2026', fecha_pase: '01/09/2026', oficina: 'Contaduría' },
    { expediente: '1/2026', fecha_pase: '10/09/2026', oficina: 'Tesorería General' },
    { expediente: '1/2026', fecha_pase: '12/09/2026', oficina: 'TESORERIA GENERAL' },
    { expediente: '2/2026', fecha_pase: '05/09/2026', oficina: 'Tesorería General' },
    { expediente: '3/2026', fecha_pase: '05/09/2026', oficina: 'Contaduría' }
  ];
  const r = Pr.llegadasPorOficina(movs, {});
  assert.deepStrictEqual(r, { 'CONTADURIA': 2, 'TESORERIA GENERAL': 2 });
});
