// Funciones puras de parseo. Sin globals de Apps Script: se testean con node.

function parseExpediente(texto) {
  if (typeof texto !== 'string') return null;
  var m = texto.trim().match(/^(\d{1,7})\s*\/\s*(\d{4}|\d{2})$/);
  if (!m) return null;
  var anio = m[2].length === 2 ? '20' + m[2] : m[2];
  return { nro: m[1], anio: anio, clave: m[1] + '/' + anio };
}

function parseFecha(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
  if (typeof x !== 'string' || !x.trim()) return null;
  var s = x.trim(), d, m, y, mm;
  if ((mm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/))) {
    d = +mm[1]; m = +mm[2] - 1; y = mm[3].length === 2 ? 2000 + +mm[3] : +mm[3];
  } else if ((mm = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    y = +mm[1]; m = +mm[2] - 1; d = +mm[3];
  } else return null;
  var f = new Date(y, m, d);
  if (f.getFullYear() !== y || f.getMonth() !== m || f.getDate() !== d) return null;
  return f;
}

function fmtFecha(f) {
  if (!(f instanceof Date) || isNaN(f)) return '';
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(f.getDate()) + '/' + p(f.getMonth() + 1) + '/' + f.getFullYear();
}

function normOficina(t) {
  if (t === null || t === undefined) return '';
  return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function esHabil_(f) { var d = f.getDay(); return d !== 0 && d !== 6; }

function diasHabiles(desde, hasta) {
  if (!desde || !hasta || hasta <= desde) return 0;
  var n = 0, f = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  var fin = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  while (f < fin) { f.setDate(f.getDate() + 1); if (esHabil_(f)) n++; }
  return n;
}

function sumarDiasHabiles(desde, n) {
  var f = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  while (n > 0) { f.setDate(f.getDate() + 1); if (esHabil_(f)) n--; }
  return f;
}

if (typeof module !== 'undefined') module.exports = { parseExpediente, parseFecha, fmtFecha, normOficina, diasHabiles, sumarDiasHabiles };
