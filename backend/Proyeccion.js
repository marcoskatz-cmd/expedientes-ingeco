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

// ── Circuito de cobro ──────────────────────────────────────────────────────────────────────────────
// El circuito NO es lineal: un expediente pasa varias veces por Obras Públicas, Obras Viales y Contaduría.
// La hoja RUTAS (tipo_contrato "*") lista los pasos en orden, con las oficinas repetidas. Para saber en qué
// paso está un expediente no alcanza con la oficina actual: se recorre su historia y se la alinea con el circuito.
// Certificados y fondos de reparo hacen un circuito corto (Obras Viales → Contaduría → Tesorería), que es el
// tramo final del largo: entran en el primer paso de etapa "Final".

var VENTANA_ = 3;          // cuántos pasos hacia adelante se busca la oficina siguiente antes de pensar que volvió atrás
var RE_CERTIFICADO_ = /CERTIF|FONDO DE REPARO|\bCERT\b/;
var RE_DECRETO_ = /FISCALIA|GOBIERNO/;   // si pasó por acá, es un trámite con decreto (circuito largo)

// Pasos del circuito, en orden. Se usa la ruta general "*"; si no hay, todas las filas.
function pasosRuta(rutas) {
  var g = rutas.filter(function (r) { return String(r.tipo_contrato).trim() === '*'; });
  return (g.length ? g : rutas.slice()).sort(function (a, b) { return Number(a.orden) - Number(b.orden); });
}

function inicioCertificados(pasos) {
  for (var i = 0; i < pasos.length; i++) if (String(pasos[i].etapa).trim() === 'Final') return i;
  return 0;
}

// Estadías del expediente en orden: [{ of, dias }] con la oficina canónica y los días hábiles medidos al salir
// (null si todavía no salió o no hay dato). Los pases internos (misma oficina) no cortan la estadía.
function historiaDe(movs, mapaCanon) {
  var lista = movs.map(function (m, i) { return { m: m, i: i }; })
    .sort(function (a, b) { return (parseFecha(a.m.fecha_pase) - parseFecha(b.m.fecha_pase)) || (a.i - b.i); });
  var out = [];
  lista.forEach(function (x) {
    var m = x.m, of = canonizar(m.oficina, mapaCanon), ult = out[out.length - 1];
    if (!of || (ult && ult.of === of)) return;
    var d = Number(m.dias_en_oficina_anterior);
    if (ult && m.dias_en_oficina_anterior !== '' && m.dias_en_oficina_anterior != null && !isNaN(d)) ult.dias = d;
    if (of !== 'COBRADO') out.push({ of: of, dias: null });
  });
  return out;
}

// Certificado / fondo de reparo → circuito corto. Con nombre se decide por el nombre; sin nombre (estadística
// de expedientes ya cobrados) por la historia: si solo pasó por Obras Viales, Contaduría y Tesorería.
function esCertificado(nombre, ofs) {
  if (ofs.some(function (o) { return RE_DECRETO_.test(o); })) return false;
  if (nombre) return RE_CERTIFICADO_.test(normOficina(nombre));
  return ofs.length > 0 && ofs.every(function (o) { return /OBRAS VIALES|CONTADURIA|TESORERIA/.test(o); });
}

// Alinea la secuencia de oficinas con los pasos: para cada estadía devuelve el índice de paso (o -1 si la oficina
// no está en el circuito). Primero busca la oficina unos pasos adelante; si no está, entiende que volvió a un paso
// anterior (idas y vueltas); si tampoco, que se salteó pasos.
function ubicar(ofs, pasosOfs, inicio) {
  inicio = inicio || 0;
  var p = inicio - 1, n = pasosOfs.length;
  return ofs.map(function (of) {
    var j = -1, k;
    for (k = p + 1; k <= Math.min(p + VENTANA_, n - 1) && j < 0; k++) if (pasosOfs[k] === of) j = k;
    for (k = Math.min(p, n - 1); k >= inicio && j < 0; k--) if (pasosOfs[k] === of) j = k;
    for (k = p + VENTANA_ + 1; k < n && j < 0; k++) if (pasosOfs[k] === of) j = k;
    if (j >= 0) p = j;
    return j;
  });
}

// Días hábiles medidos en cada paso del circuito (no por oficina: la 1ª y la 3ª vez en Obras Públicas son distintas).
function medianasPorPaso(movimientos, rutas, mapaCanon) {
  var pasos = pasosRuta(rutas), ofs = pasos.map(function (r) { return canonizar(r.oficina, mapaCanon); });
  var iniCert = inicioCertificados(pasos), acum = pasos.map(function () { return []; }), porExp = {};
  movimientos.forEach(function (m) { (porExp[m.expediente] = porExp[m.expediente] || []).push(m); });
  Object.keys(porExp).forEach(function (k) {
    var h = historiaDe(porExp[k], mapaCanon), hofs = h.map(function (v) { return v.of; });
    var ub = ubicar(hofs, ofs, esCertificado('', hofs) ? iniCert : 0);
    h.forEach(function (v, i) { if (ub[i] >= 0 && v.dias !== null) acum[ub[i]].push(v.dias); });
  });
  return acum.map(function (a) { return { mediana_dias: mediana(a), casos: a.length }; });
}

// Días que se usan para cada paso: la mediana del paso si tiene casos suficientes; si no, la de la oficina;
// si no, el valor por defecto de la hoja RUTAS (dato débil).
function diasPorPaso(rutas, statsPaso, statsOf, minCasos, mapaCanon) {
  return pasosRuta(rutas).map(function (r, i) {
    var sp = statsPaso[i] || { mediana_dias: 0, casos: 0 }, so = statsOf[canonizar(r.oficina, mapaCanon)];
    var base = { tipo_contrato: r.tipo_contrato, orden: r.orden, oficina: r.oficina, etapa: r.etapa, dias_default: r.dias_default, casos: sp.casos };
    if (sp.casos >= minCasos) return Object.assign(base, { dias: sp.mediana_dias, fuente: 'paso', debil: false });
    if (so && so.casos >= minCasos) return Object.assign(base, { dias: so.mediana_dias, fuente: 'oficina', debil: false });
    return Object.assign(base, { dias: Number(r.dias_default) || 0, fuente: 'default', debil: true });
  });
}

// estado: fila de ESTADO_ACTUAL; movs: movimientos de ESE expediente (pueden no incluir la oficina actual).
function proyectar(estado, rutas, statsPaso, statsOf, hoy, minCasos, mapaCanon, movs) {
  var pasos = diasPorPaso(rutas, statsPaso || [], statsOf || {}, minCasos, mapaCanon);
  var ofs = pasos.map(function (r) { return canonizar(r.oficina, mapaCanon); });
  var hist = historiaDe(movs || [], mapaCanon).map(function (v) { return v.of; });
  var actual = canonizar(estado.oficina_actual, mapaCanon);
  if (hist[hist.length - 1] !== actual) hist.push(actual);
  var cert = esCertificado(estado.nombre_obra, hist);
  var circuito = cert ? 'Certificado' : 'Con decreto';
  var ub = ubicar(hist, ofs, cert ? inicioCertificados(pasos) : 0), idx = ub[ub.length - 1];
  if (idx < 0) return { etapa: 'Fuera de ruta', paso_en_ruta: '', circuito: circuito, dias_restantes_est: '', fecha_cobro_est: '', calidad_estimacion: 'debil' };
  var debil = false, total = Math.max(0, pasos[idx].dias - Number(estado.dias_quieto || 0));
  if (pasos[idx].debil) debil = true;
  for (var i = idx + 1; i < pasos.length; i++) { total += pasos[i].dias; if (pasos[i].debil) debil = true; }
  total = Math.round(total);
  return {
    etapa: pasos[idx].etapa, paso_en_ruta: idx + 1, circuito: circuito, dias_restantes_est: total,
    fecha_cobro_est: fmtFecha(sumarDiasHabiles(hoy, total)), calidad_estimacion: debil ? 'debil' : 'buena'
  };
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); normOficina = P_.normOficina; parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; sumarDiasHabiles = P_.sumarDiasHabiles;
  module.exports = { mediana, canonizar, medianasPorOficina, llegadasPorOficina, proyectar, pasosRuta, inicioCertificados, historiaDe, esCertificado, ubicar, medianasPorPaso, diasPorPaso };
}
