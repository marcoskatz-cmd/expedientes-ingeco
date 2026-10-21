// Pegamento con Google Sheets. Sin tests automáticos: se prueba en vivo desde el editor.

// Se abre una sola vez por ejecución (abrirla tarda; log_ la pedía en cada renglón).
var SS_DATOS_ = null;
function ssDatos_() { return SS_DATOS_ || (SS_DATOS_ = SpreadsheetApp.openById(prop_('SHEET_DATOS'))); }
function ssMaestro_() { return SpreadsheetApp.openById(prop_('SHEET_MAESTRO')); }

function leerHojaRaw_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) throw new Error('No existe la hoja "' + nombre + '" en ' + ss.getName());
  var v = h.getDataRange().getValues();
  return { hoja: h, encabezados: v.length ? v[0].map(function (x) { return String(x).trim(); }) : [], filas: v };
}
function leerHoja_(ss, nombre) { return filasAObjetos(leerHojaRaw_(ss, nombre).filas); }

// Solo los últimos n renglones (el LOG crece sin parar y no hace falta leerlo entero).
function leerUltimas_(ss, nombre, n) {
  var h = ss.getSheetByName(nombre), last = h.getLastRow(), cols = h.getLastColumn();
  if (last < 2) return [];
  var enc = h.getRange(1, 1, 1, cols).getValues();
  var desde = Math.max(2, last - n + 1);
  return filasAObjetos(enc.concat(h.getRange(desde, 1, last - desde + 1, cols).getValues()));
}

// Caché de respuestas de la API. Los datos cambian solo cuando corre el bot (una vez por hora) o se carga
// una gestión: ahí se llama a invalidarCache_(). Lo editado a mano en la planilla aparece en menos de 1 hora.
// CacheService guarda hasta 100 KB por clave, así que las respuestas grandes se parten en pedazos.
function conCache_(clave, fn) {
  var cache = CacheService.getScriptCache();
  var k = 'r' + (PropertiesService.getScriptProperties().getProperty('CACHE_VER') || '0') + '_' + clave;
  var cab = cache.get(k);
  if (cab) {
    var nP = Number(cab), ks = [];
    for (var i = 0; i < nP; i++) ks.push(k + '_' + i);
    var partes = cache.getAll(ks), txt = '';
    for (i = 0; i < nP && partes[ks[i]] != null; i++) txt += partes[ks[i]];
    if (i === nP) return JSON.parse(txt);
  }
  var r = fn();
  if (!r || !r.ok) return r;
  var t = JSON.stringify(r, function (kk, v) { return (this[kk] instanceof Date) ? fmtFecha(this[kk]) : v; });
  var T = 90000, obj = {}, n = Math.ceil(t.length / T);
  if (n <= 20) {
    for (var j = 0; j < n; j++) obj[k + '_' + j] = t.slice(j * T, (j + 1) * T);
    obj[k] = String(n);
    try { cache.putAll(obj, 3600); } catch (e) { console.error('cache: ' + e); }
  }
  return JSON.parse(t);
}
function invalidarCache_() { PropertiesService.getScriptProperties().setProperty('CACHE_VER', String(Date.now())); }

// Hojas creadas antes de sumar columnas: agrega al final los encabezados que falten, en formato texto
// (si no, Sheets convierte '11:16' en una hora-fecha).
function asegurarEncabezados_(ss) {
  Object.keys(CFG.HOJAS).forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (!h) return;
    var enc = h.getRange(1, 1, 1, Math.max(1, h.getLastColumn())).getValues()[0].map(function (x) { return String(x).trim(); });
    CFG.HOJAS[n].forEach(function (c, i) {
      if (enc.indexOf(c) >= 0) return;
      if (enc.length > i && enc[i] !== '') throw new Error('Hoja ' + n + ': la columna ' + (i + 1) + ' es "' + enc[i] + '" y se esperaba "' + c + '"');
      if (h.getMaxColumns() < i + 1) h.insertColumnsAfter(h.getMaxColumns(), i + 1 - h.getMaxColumns());
      h.getRange(1, i + 1).setValue(c).setFontWeight('bold');
      h.getRange(2, i + 1, h.getMaxRows() - 1, 1).setNumberFormat('@');
      enc[i] = c;
    });
  });
}

// Edita en el lugar filas de una hoja por su columna 'id' (o la que se pase): cambios = { id: { columna: valor } }.
// Las de 'borrar' se eliminan de abajo hacia arriba para no correr los índices.
function editarFilas_(ss, nombre, cambios, borrar, colId) {
  var raw = leerHojaRaw_(ss, nombre), iId = raw.encabezados.indexOf(colId || 'id'), hechos = 0, aBorrar = [];
  for (var r = 1; r < raw.filas.length; r++) {
    var id = String(raw.filas[r][iId]);
    if ((borrar || []).indexOf(id) >= 0) { aBorrar.push(r + 1); continue; }
    var c = cambios[id];
    if (!c) continue;
    Object.keys(c).forEach(function (col) {
      var i = raw.encabezados.indexOf(col);
      if (i >= 0) raw.hoja.getRange(r + 1, i + 1).setValue(c[col]);
    });
    hechos++;
  }
  aBorrar.sort(function (a, b) { return b - a; }).forEach(function (f) { raw.hoja.deleteRow(f); });
  return { editadas: hechos, borradas: aBorrar.length };
}

// Anota la llegada en el movimiento del pase (por número de curso; si el movimiento es anterior a guardarlo, el último del expediente).
function anotarRecepciones_(ss, recepciones) {
  if (!recepciones.length) return;
  var movs = leerHoja_(ss, 'MOVIMIENTOS'), cambios = {};
  recepciones.forEach(function (rc) {
    var delExp = movs.filter(function (m) { return String(m.expediente) === rc.expediente; });
    var m = delExp.filter(function (x) { return rc.id_curso !== '' && String(x.id_curso) === String(rc.id_curso); })[0] ||
      delExp.sort(function (a, b) { return parseFecha(a.fecha_pase) - parseFecha(b.fecha_pase); })[delExp.length - 1];
    if (m) cambios[String(m.id)] = { recibido_en: rc.recibido_en, id_curso: rc.id_curso };
  });
  editarFilas_(ss, 'MOVIMIENTOS', cambios, []);
}

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
  ss.setSpreadsheetLocale('es_AR');
  ss.setSpreadsheetTimeZone('America/Argentina/Tucuman');
  Object.keys(CFG.HOJAS).forEach(function (n) {
    var h = ss.insertSheet(n);
    h.getRange(1, 1, 1, CFG.HOJAS[n].length).setValues([CFG.HOJAS[n]]).setFontWeight('bold');
    h.setFrozenRows(1);
    // Todo como texto plano: así "05/03/2026" o "5/2026" no se convierten en fechas y se leen tal cual se escribieron.
    h.getRange(2, 1, h.getMaxRows() - 1, CFG.HOJAS[n].length).setNumberFormat('@');
  });
  ss.deleteSheet(ss.getSheets()[0]);
  ss.getSheetByName('CONFIG').getRange(2, 1, 2, 2).setValues([['umbral_dias_quieto', 10], ['mails_alerta', '']]);
  console.log('Creada: ' + ss.getId() + ' -> guardar como SHEET_DATOS');
  return ss.getId();
}
