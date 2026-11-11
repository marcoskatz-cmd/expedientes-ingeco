// Estadística por oficina y proyección de días restantes. Puro: se testea con node.

function mediana(nums) {
  var a = nums.filter(function (n) { return typeof n === 'number' && !isNaN(n); }).sort(function (x, y) { return x - y; });
  if (!a.length) return 0;
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function canonizar(oficina, mapaCanon) {
  var n = normOficina(oficina);
  return (mapaCanon && mapaCanon[n]) || n;
}

// Cada movimiento con dias_en_oficina_anterior aporta ese valor a la oficina del movimiento previo del mismo expediente.
function medianasPorOficina(movimientos, mapaCanon) {
  var porExp = {};
  movimientos.forEach(function (m) { (porExp[m.expediente] = porExp[m.expediente] || []).push(m); });
  var acum = {};
  Object.keys(porExp).forEach(function (k) {
    var lista = porExp[k].slice().sort(function (a, b) { return parseFecha(a.fecha_pase) - parseFecha(b.fecha_pase); });
    for (var i = 1; i < lista.length; i++) {
      var d = Number(lista[i].dias_en_oficina_anterior);
      if (lista[i].dias_en_oficina_anterior === '' || isNaN(d)) continue;
      if (normOficina(lista[i].oficina) === normOficina(lista[i - 1].oficina)) continue; // pase interno: no es una salida
      var of = canonizar(lista[i - 1].oficina, mapaCanon);
      (acum[of] = acum[of] || []).push(d);
    }
  });
  var out = {};
  Object.keys(acum).forEach(function (of) { out[of] = { mediana_dias: mediana(acum[of]), casos: acum[of].length }; });
  return out;
}

// Cuántos expedientes distintos pasaron por cada oficina (aunque no tengan salida registrada).
function llegadasPorOficina(movimientos, mapaCanon) {
  var set = {};
  movimientos.forEach(function (m) {
    var of = canonizar(m.oficina, mapaCanon);
    if (!of || of === 'COBRADO') return;
    (set[of] = set[of] || {})[m.expediente] = true;
  });
  var out = {};
  Object.keys(set).forEach(function (of) { out[of] = Object.keys(set[of]).length; });
  return out;
}

var RUTA_FALLBACK_ = 'Contratación Directa';

// Ruta esperada para el tipo de contrato del expediente, ordenada. debil = tuvo que usar la de Contratación Directa.
function rutaDe(estado, rutas) {
  var tipo = normOficina(estado.tipo_contrato);
  var ruta = rutas.filter(function (r) { return normOficina(r.tipo_contrato) === tipo; });
  var debil = false;
  // Sin ruta propia: primero la ruta general "*" (no penaliza), si no la de Contratación Directa (débil).
  if (!ruta.length) ruta = rutas.filter(function (r) { return String(r.tipo_contrato).trim() === '*'; });
  if (!ruta.length) { ruta = rutas.filter(function (r) { return normOficina(r.tipo_contrato) === normOficina(RUTA_FALLBACK_); }); debil = true; }
  return { pasos: ruta.slice().sort(function (a, b) { return Number(a.orden) - Number(b.orden); }), debil: debil };
}

function indiceEnRuta_(pasos, oficina, mapaCanon) {
  var actual = canonizar(oficina, mapaCanon), idx = -1;
  pasos.forEach(function (r, i) { if (idx < 0 && canonizar(r.oficina, mapaCanon) === actual) idx = i; });
  return idx;
}

/** Próxima oficina según la ruta: la siguiente distinta de la actual. '' si está fuera de ruta o en el último paso. */
function siguienteOficina(estado, rutas, mapaCanon) {
  if (!estado.oficina_actual) return '';
  var pasos = rutaDe(estado, rutas).pasos, idx = indiceEnRuta_(pasos, estado.oficina_actual, mapaCanon);
  if (idx < 0) return '';
  var actual = canonizar(estado.oficina_actual, mapaCanon);
  for (var i = idx + 1; i < pasos.length; i++) if (canonizar(pasos[i].oficina, mapaCanon) !== actual) return pasos[i].oficina;
  return '';
}

function proyectar(estado, rutas, stats, hoy, minCasos, mapaCanon) {
  var rd = rutaDe(estado, rutas), ruta = rd.pasos;
  var calidad = rd.debil ? 'debil' : 'buena';
  var idx = indiceEnRuta_(ruta, estado.oficina_actual, mapaCanon);
  if (idx < 0) return { etapa: 'Fuera de ruta', paso_en_ruta: '', dias_restantes_est: '', fecha_cobro_est: '', calidad_estimacion: 'debil' };

  function diasDe(paso) {
    var s = stats[canonizar(paso.oficina, mapaCanon)];
    if (s && s.casos >= minCasos) return s.mediana_dias;
    calidad = 'debil';
    return Number(paso.dias_default) || 0;
  }
  var total = Math.max(0, diasDe(ruta[idx]) - Number(estado.dias_quieto || 0));
  for (var i = idx + 1; i < ruta.length; i++) total += diasDe(ruta[i]);
  total = Math.round(total);
  return {
    etapa: ruta[idx].etapa, paso_en_ruta: idx + 1, dias_restantes_est: total,
    fecha_cobro_est: fmtFecha(sumarDiasHabiles(hoy, total)), calidad_estimacion: calidad
  };
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); normOficina = P_.normOficina; parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; sumarDiasHabiles = P_.sumarDiasHabiles;
  module.exports = { mediana, canonizar, medianasPorOficina, llegadasPorOficina, proyectar, rutaDe, siguienteOficina };
}
