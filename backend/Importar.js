// Importación inicial: hoja "trazabilidad" → MOVIMIENTOS, hoja "Ruta contratos" → RUTAS.
// Las funciones de conversión son puras (node); las importar*() se corren UNA vez desde el editor.

function trazabilidadAMovimientos(filas, hoy) {
  var vistos = {}, porExp = {}, descartadas = 0;
  filas.forEach(function (f) {
    var e = parseExpediente(String(f['Expediente'] || ''));
    var fecha = parseFecha(f['Ultimo Movimiento']);
    var oficina = String(f['Oficina'] || '').trim();
    if (!e || !fecha || !oficina) { descartadas++; return; }
    var k = e.clave + '|' + fmtFecha(fecha) + '|' + normOficina(oficina);
    if (vistos[k]) { descartadas++; return; }
    vistos[k] = true;
    (porExp[e.clave] = porExp[e.clave] || []).push({ clave: e.clave, fecha: fecha, oficina: oficina });
  });
  var movimientos = [];
  Object.keys(porExp).sort().forEach(function (clave) {
    var lista = porExp[clave].sort(function (a, b) { return a.fecha - b.fecha; });
    lista.forEach(function (m, i) {
      movimientos.push({
        id: nuevoId(), expediente: clave, fecha_pase: fmtFecha(m.fecha), oficina: m.oficina, descripcion_api: '',
        detectado_en: fmtFecha(hoy), origen: 'importado',
        dias_en_oficina_anterior: i === 0 ? '' : diasHabiles(lista[i - 1].fecha, m.fecha)
      });
    });
  });
  return { movimientos: movimientos, descartadas: descartadas };
}

var TIPOS_CANON_ = { 'CONTRATACION DIRECTA': 'Contratación Directa', 'RECONOCIMIENTO DE SERVICIO': 'Reconocimiento de Servicio', 'LICITACION': 'Licitación' };

function rutaContratosARutas(raw) {
  var out = [], tipo = null, orden = 0;
  raw.forEach(function (fila) {
    var b = String(fila[1] || '').trim();
    if (!b) return;
    var bn = normOficina(b);
    if (TIPOS_CANON_[bn]) { tipo = TIPOS_CANON_[bn]; orden = 0; return; }
    if (!tipo) return;
    var m = bn.match(/^SE GENERA EXPEDIENTE EN (.+)$/);
    var oficina = m ? m[1] : bn;
    if (oficina === 'OBRAS VIALES') oficina = 'DIRECCION DE OBRAS VIALES';
    orden++;
    out.push({ tipo_contrato: tipo, orden: orden, oficina: oficina, etapa: '', dias_default: 10 });
  });
  // Etapas: primer tercio Preliminar, segundo Media, resto Final; TESORERIA = Cobro.
  var porTipo = {};
  out.forEach(function (r) { (porTipo[r.tipo_contrato] = porTipo[r.tipo_contrato] || []).push(r); });
  Object.keys(porTipo).forEach(function (t) {
    var n = porTipo[t].length;
    porTipo[t].forEach(function (r, i) {
      if (/TESORERIA/.test(r.oficina)) r.etapa = 'Cobro';
      else r.etapa = i < n / 3 ? 'Preliminar' : (i < 2 * n / 3 ? 'Media' : 'Final');
    });
  });
  return out;
}

/** Correr UNA vez desde el editor. */
function importarTrazabilidad() {
  var filas = leerHoja_(ssMaestro_(), CFG.HOJA_TRAZABILIDAD);
  var r = trazabilidadAMovimientos(filas, new Date());
  agregarFilas_(ssDatos_(), 'MOVIMIENTOS', r.movimientos);
  log_('INFO', '', 'Importadas ' + r.movimientos.length + ' filas de trazabilidad, descartadas ' + r.descartadas);
}
function importarRutas() {
  var raw = leerHojaRaw_(ssMaestro_(), CFG.HOJA_RUTA_ORIGEN).filas;
  reemplazarHoja_(ssDatos_(), 'RUTAS', rutaContratosARutas(raw));
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'), M_ = require('./Motor.js');
  parseExpediente = P_.parseExpediente; parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; normOficina = P_.normOficina; diasHabiles = P_.diasHabiles; nuevoId = M_.nuevoId;
  module.exports = { trazabilidadAMovimientos, rutaContratosARutas };
}
