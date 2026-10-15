// Setup remoto temporal: permite disparar las funciones de instalación por doPost sin entrar al editor.
// Secreto en Script Property SETUP_SECRET (vacío = deshabilitado).
function setupSecret_() { return PropertiesService.getScriptProperties().getProperty('SETUP_SECRET') || BOOTSTRAP_SECRET_; }
var BOOTSTRAP_SECRET_ = ''; // solo para el primer arranque; después el secreto vive en Script Properties

function accionSetup_(accion, p) {
  var sec = setupSecret_();
  if (!sec || p.secreto !== sec) return { ok: false, error: 'Setup deshabilitado' };
  var extra = accionSetupExtra_(accion, p) || accionSetupExtra2_(accion, p); if (extra) return extra;
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
