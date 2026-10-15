// Setup remoto temporal: permite disparar las funciones de instalación por doPost sin entrar al editor.
// Secreto en Script Property SETUP_SECRET (vacío = deshabilitado).
function setupSecret_() { return PropertiesService.getScriptProperties().getProperty('SETUP_SECRET') || BOOTSTRAP_SECRET_; }
var BOOTSTRAP_SECRET_ = ''; // solo para el primer arranque; después el secreto vive en Script Properties

function accionSetup_(accion, p) {
  var sec = setupSecret_();
  if (!sec || p.secreto !== sec) return { ok: false, error: 'Setup deshabilitado' };
  var extra = accionSetupExtra_(accion, p) || accionSetupExtra2_(accion, p) || accionSetupMaestro_(accion, p) || accionSetupFormulas_(accion, p) || accionSetupArreglarMontos_(accion, p); if (extra) return extra;
  var ssD = ssDatos_();
  if (accion === 'setup_importar') {
    var out = {};
    if (ssD.getSheetByName('RUTAS').getLastRow() <= 1) { importarRutas(); out.rutas = 'importadas'; } else out.rutas = 'ya había';
    if (ssD.getSheetByName('MOVIMIENTOS').getLastRow() <= 1) { importarTrazabilidad(); out.trazabilidad = 'importada'; } else out.trazabilidad = 'ya había';
    out.rutas_filas = ssD.getSheetByName('RUTAS').getLastRow() - 1;
    out.movimientos_filas = ssD.getSheetByName('MOVIMIENTOS').getLastRow() - 1;
    return { ok: true, resultado: out };
  }
  if (accion === 'setup_correr') { correr(true); return { ok: true, log: ultimoLog_(ssD, 15) }; }
  if (accion === 'setup_trigger') { instalarTrigger(); return { ok: true, triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) }; }
  if (accion === 'setup_log') return { ok: true, log: ultimoLog_(ssD, Number(p.n) || 30) };
  if (accion === 'setup_props') return { ok: true, props: Object.keys(PropertiesService.getScriptProperties().getProperties()) };
  return { ok: false, error: 'Acción de setup desconocida' };
}

function ultimoLog_(ssD, n) {
  var h = ssD.getSheetByName('LOG'), last = h.getLastRow();
  if (last <= 1) return [];
  var desde = Math.max(2, last - n + 1);
  return h.getRange(desde, 1, last - desde + 1, 5).getDisplayValues().map(function (r) { return r.join(' | '); });
}

function accionSetupExtra_(accion, p) {
  if (accion === 'setup_probar') { var r = ultimoCurso_(String(p.nro), String(p.anio)); return { ok: true, status: r.status, body: r.body }; }
  if (accion === 'setup_hoja') { var h = ssDatos_().getSheetByName(p.hoja); return { ok: true, filas: h.getRange(1, 1, Math.min(h.getLastRow(), Number(p.n) || 50), h.getLastColumn()).getDisplayValues() }; }
  return null;
}

// Ruta general de COBRO observada en los 588 movimientos importados (la hoja "Ruta contratos" describía la
// contratación, no el cobro). tipo_contrato "*" = vale para todos los tipos. Editable en la hoja RUTAS.
var RUTA_COBRO_ = [
  ['DIRECCION DE OBRAS VIALES', 'Preliminar', 5],
  ['SECRETARIA DE OBRAS PUBLICAS', 'Preliminar', 2],
  ['SECRETARIA DE ECONOMIA Y HACIENDA', 'Media', 1],
  ['DIRECCION DE PLANEAMIENTO Y PRESUPUESTO', 'Media', 1],
  ['SECRETARIA DE GOBIERNO', 'Media', 2],
  ['FISCALIA MUNICIPAL', 'Media', 5],
  ['CONTADURIA GENERAL', 'Final', 2],
  ['TESORERIA GENERAL', 'Cobro', 9]
];
// Variantes de nombre que aparecen en planillas viejas → nombre del municipio.
var OFICINAS_ALIAS_ = { 'SECRETARIA DE OBRAS': 'SECRETARIA DE OBRAS PUBLICAS', 'DIRECCION DE OBRAS': 'DIRECCION DE OBRAS VIALES', 'TESORERIA': 'TESORERIA GENERAL', 'CONTADURIA': 'CONTADURIA GENERAL', 'FISCALIA': 'FISCALIA MUNICIPAL' };

function accionSetupExtra2_(accion, p) {
  var ssD = ssDatos_();
  if (accion === 'setup_prop') { PropertiesService.getScriptProperties().setProperty(String(p.nombre), String(p.valor)); return { ok: true }; }
  if (accion === 'setup_config') {
    var h = ssD.getSheetByName('CONFIG'), v = h.getDataRange().getValues(), fila = -1;
    v.forEach(function (r, i) { if (String(r[0]).trim() === p.clave) fila = i + 1; });
    if (fila < 0) { h.appendRow([p.clave, p.valor]); } else { h.getRange(fila, 2).setValue(p.valor); }
    return { ok: true };
  }
  if (accion === 'setup_rutas') {
    reemplazarHoja_(ssD, 'RUTAS', RUTA_COBRO_.map(function (r, i) { return { tipo_contrato: '*', orden: i + 1, oficina: r[0], etapa: r[1], dias_default: r[2] }; }));
    var of = leerHoja_(ssD, 'OFICINAS'), tiene = {};
    of.forEach(function (o) { tiene[normOficina(o.nombre_api)] = true; });
    Object.keys(OFICINAS_ALIAS_).forEach(function (k) { if (!tiene[k]) of.push({ nombre_api: k, nombre_canonico: OFICINAS_ALIAS_[k], mediana_dias: '', casos: '' }); });
    reemplazarHoja_(ssD, 'OFICINAS', of);
    return { ok: true, rutas: RUTA_COBRO_.length, oficinas: of.length };
  }
  if (accion === 'setup_reset_alertas') {
    var est = leerHoja_(ssD, 'ESTADO_ACTUAL').filter(function (e) { return String(e.expediente || '').trim(); });
    est.forEach(function (e) { e.alerta_enviada_en = ''; });
    reemplazarHoja_(ssD, 'ESTADO_ACTUAL', est);
    return { ok: true, filas: est.length };
  }
  return null;
}

function accionSetupMaestro_(accion, p) {
  if (accion !== 'setup_maestro') return null;
  var raw = leerHojaRaw_(ssMaestro_(), CFG.HOJA_MAESTRO);
  var enc = raw.encabezados, iE = enc.indexOf('Estado $'), iM = enc.indexOf('Monto'), iT = enc.indexOf('Monto Total'), iX = enc.indexOf('Expediente'), iN = enc.indexOf('Nombre Obra');
  var rg = raw.hoja.getRange(2, 1, raw.hoja.getLastRow() - 1, enc.length), filas = rg.getDisplayValues(), vals = rg.getValues();
  return { ok: true, filas: filas.map(function (r, i) { return [i + 2, r[iX], String(r[iN]).slice(0, 40), JSON.stringify(vals[i][iE]), r[iM], typeof vals[i][iM]]; }).filter(function (r) { return /cobrar/i.test(r[3]); }) };
}

function accionSetupFormulas_(accion, p) {
  if (accion !== 'setup_formulas') return null;
  var h = ssMaestro_().getSheetByName(String(p.hoja));
  if (!h) return { ok: false, error: 'no existe la hoja' };
  var rg = h.getDataRange();
  var f = rg.getFormulas(), v = rg.getDisplayValues(), out = [];
  f.forEach(function (fila, i) { fila.forEach(function (c, j) { if (c) out.push({ celda: String.fromCharCode(65 + j) + (i + 1), formula: c, valor: v[i][j] }); }); });
  return { ok: true, formulas: out };
}

// Convierte a número los montos del maestro que quedaron como texto (SUMIF los ignora). Solo filas "A Cobrar".
function accionSetupArreglarMontos_(accion, p) {
  if (accion !== 'setup_arreglar_montos') return null;
  var raw = leerHojaRaw_(ssMaestro_(), CFG.HOJA_MAESTRO), enc = raw.encabezados;
  var iE = enc.indexOf('Estado $'), iM = enc.indexOf('Monto');
  var rg = raw.hoja.getRange(2, 1, raw.hoja.getLastRow() - 1, enc.length), vals = rg.getValues(), cambios = [];
  vals.forEach(function (r, i) {
    if (!/cobrar/i.test(String(r[iE])) || typeof r[iM] !== 'string' || !r[iM].trim()) return;
    var n = parseMonto(r[iM]);
    if (!n) return;
    raw.hoja.getRange(i + 2, iM + 1).setValue(n).setNumberFormat('"$"#,##0.00');
    cambios.push([i + 2, r[iM], n]);
  });
  var det = ssMaestro_().getSheetByName('Detalle Municipio');
  SpreadsheetApp.flush();
  return { ok: true, cambios: cambios, detalle_C4: det ? det.getRange('C4').getDisplayValue() : null };
}
