// Lectura del maestro con auto-diagnóstico. Funciones puras (node); lo que usa SpreadsheetApp está en Hojas.js.

function diagnosticarEncabezados(encabezados, obligatorias) {
  var set = {};
  (encabezados || []).forEach(function (h) { set[String(h).trim()] = true; });
  var faltan = obligatorias.filter(function (c) { return !set[c]; });
  return { ok: faltan.length === 0, faltan: faltan };
}

function filasAObjetos(valores) {
  if (!valores || !valores.length) return [];
  var enc = valores[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i], vacia = true, o = { __fila: i + 1 };
    for (var j = 0; j < enc.length; j++) {
      if (!enc[j]) continue;
      var v = fila[j];
      if (v !== '' && v !== null && v !== undefined) vacia = false;
      o[enc[j]] = v;
    }
    if (!vacia) out.push(o);
  }
  return out;
}

function parseMonto(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function esCobrado_(estado$) { return /^cobrad[oa]/i.test(String(estado$ || '').trim()); }
// Solo se siguen los que dicen "A Cobrar". Filas TOTAL, vacías u otros estados quedan afuera (pedido de Marcos, 15-oct-2026).
function esACobrar_(estado$) { return /^a\s*cobrar/i.test(String(estado$ || '').trim()); }
// "Expediente madre" / "EXPTE MADRE" / "expediente masdre": agrupan certificados que ya figuran como filas propias → afuera (pedido 15-oct-2026).
function esMadre_(texto) { return /exp[a-z.]*\s+ma[sd]?d?re\b/i.test(String(texto || '')); }

function maestroAExpedientes(objs, cols) {
  var activos = [], sinExpediente = [], cobrados = 0, otros = 0, madres = 0, cobradosClaves = [];
  objs.forEach(function (o) {
    var nombre = String(o[cols.nombre] || '').trim();
    var texto = String(o[cols.expediente] || '').trim();
    if (!nombre && !texto) return;
    if (esCobrado_(o[cols.estado$])) { cobrados++; var ec = parseExpediente(texto); if (ec) cobradosClaves.push(ec.clave); return; }
    if (!esACobrar_(o[cols.estado$])) { otros++; return; }
    if (esMadre_(nombre) || esMadre_(o[cols.obs])) { madres++; return; }
    var e = parseExpediente(texto);
    if (!e) { sinExpediente.push({ nombre: nombre, texto: texto, fila: o.__fila }); return; }
    activos.push({
      clave: e.clave, nro: e.nro, anio: e.anio, nombre: nombre,
      monto: parseMonto(o[cols.monto]) || parseMonto(o[cols.montoTotal]),
      tipo: String(o[cols.tipo] || '').trim(),
      prioridad: String(o[cols.prioridad] || '').trim() || 'Normal',
      obs: String(o[cols.obs] || '').trim(),
      inicio: parseFecha(o[cols.inicio]),
      fila: o.__fila
    });
  });
  return { activos: activos, sinExpediente: sinExpediente, cobrados: cobrados, otros: otros, madres: madres, cobradosClaves: cobradosClaves };
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); parseExpediente = P_.parseExpediente; parseFecha = P_.parseFecha;
  module.exports = { diagnosticarEncabezados, filasAObjetos, parseMonto, maestroAExpedientes };
}
