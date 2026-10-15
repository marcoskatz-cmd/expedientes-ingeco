// Pegamento con Google Sheets. Sin tests automáticos: se prueba en vivo desde el editor.

function ssDatos_() { return SpreadsheetApp.openById(prop_('SHEET_DATOS')); }
function ssMaestro_() { return SpreadsheetApp.openById(prop_('SHEET_MAESTRO')); }

function leerHojaRaw_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) throw new Error('No existe la hoja "' + nombre + '" en ' + ss.getName());
  var v = h.getDataRange().getValues();
  return { hoja: h, encabezados: v.length ? v[0].map(function (x) { return String(x).trim(); }) : [], filas: v };
}
function leerHoja_(ss, nombre) { return filasAObjetos(leerHojaRaw_(ss, nombre).filas); }

function agregarFilas_(ss, nombre, objs) {
  if (!objs.length) return;
  var cols = CFG.HOJAS[nombre];
  var h = ss.getSheetByName(nombre);
  var filas = objs.map(function (o) { return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; }); });
  h.getRange(h.getLastRow() + 1, 1, filas.length, cols.length).setValues(filas);
}

function reemplazarHoja_(ss, nombre, objs) {
  var h = ss.getSheetByName(nombre);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, h.getMaxColumns()).clearContent();
  agregarFilas_(ss, nombre, objs);
}

var CORRIDA_ID_ = null;
function log_(nivel, expediente, mensaje) {
  if (!CORRIDA_ID_) CORRIDA_ID_ = Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', 'yyyyMMdd-HHmm');
  try {
    agregarFilas_(ssDatos_(), 'LOG', [{ fecha: new Date(), corrida: CORRIDA_ID_, nivel: nivel, expediente: expediente || '', mensaje: String(mensaje).slice(0, 500) }]);
  } catch (e) { console.error('log_ fallo: ' + e); }
  console.log('[' + nivel + '] ' + (expediente || '') + ' ' + mensaje);
}

function leerConfig_() {
  var o = {};
  leerHoja_(ssDatos_(), 'CONFIG').forEach(function (r) { o[String(r.clave).trim()] = r.valor; });
  return o;
}

/** Setup, una sola vez: crea la planilla de datos con las 7 hojas. Luego guardar su id en SHEET_DATOS. */
function crearPlanillaDatos() {
  var ss = SpreadsheetApp.create('Expedientes INGECO - Datos');
  Object.keys(CFG.HOJAS).forEach(function (n) {
    var h = ss.insertSheet(n);
    h.getRange(1, 1, 1, CFG.HOJAS[n].length).setValues([CFG.HOJAS[n]]).setFontWeight('bold');
    h.setFrozenRows(1);
  });
  ss.deleteSheet(ss.getSheets()[0]);
  ss.getSheetByName('CONFIG').getRange(2, 1, 2, 2).setValues([['umbral_dias_quieto', 10], ['mails_alerta', '']]);
  console.log('Creada: ' + ss.getId() + ' -> guardar como SHEET_DATOS');
  return ss.getId();
}
