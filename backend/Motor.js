// Comparación del estado previo con la respuesta de la API. Puro: se testea con node.

function interpretarRespuesta(resp) {
  if (!resp || typeof resp !== 'object') return { ok: false, motivo: 'respuesta vacía' };
  var curso = resp.curso || {};
  var oficina = String(curso.descripcion || '').trim();
  if (!oficina) return { ok: false, motivo: 'sin oficina (curso.descripcion vacío)' };
  // El municipio a veces manda el pase sin fecha (fecha: null): la oficina vale igual, la fecha la pone el bot al detectarlo.
  var fechaPase = (curso.fecha === null || curso.fecha === undefined || curso.fecha === '') ? null : parseFecha(curso.fecha);
  if (fechaPase === null && curso.fecha) return { ok: false, motivo: 'fecha de pase inválida: ' + curso.fecha };
  var ex = resp.expediente || {};
  return {
    ok: true, oficina: oficina, oficinaNorm: normOficina(oficina), fechaPase: fechaPase,
    asunto: String(ex.asunto || '').trim(), comentarios: String(curso.comentarios || '').replace(/\s+/g, ' ').trim(),
    fechaInicio: parseFecha(ex.fecha)
  };
}

function compararEstado(previo, lectura, exp, hoy) {
  var desdePrev = previo ? parseFecha(previo.desde) : null;
  var mismaOficina = !!previo && normOficina(previo.oficina_actual) === lectura.oficinaNorm;
  // Sin fecha del municipio solo se compara la oficina; la fecha del pase es la de detección.
  var fechaPase = lectura.fechaPase || hoy;
  var mismaFecha = !lectura.fechaPase || (!!desdePrev && desdePrev.getTime() === fechaPase.getTime());
  var cambio = !previo || !mismaOficina || !mismaFecha;
  var movimiento = null;
  if (cambio) {
    movimiento = {
      id: nuevoId(), expediente: exp.clave, fecha_pase: fmtFecha(fechaPase), oficina: lectura.oficina,
      descripcion_api: (lectura.comentarios || lectura.asunto || '').slice(0, 300), detectado_en: fmtFecha(hoy), origen: 'bot',
      dias_en_oficina_anterior: (previo && desdePrev) ? diasHabiles(desdePrev, fechaPase) : ''
    };
  }
  var desde = cambio ? fechaPase : desdePrev;
  var estado = {
    expediente: exp.clave, nombre_obra: exp.nombre, monto: exp.monto, tipo_contrato: exp.tipo, prioridad: exp.prioridad,
    oficina_actual: cambio ? lectura.oficina : previo.oficina_actual,
    desde: fmtFecha(desde), dias_quieto: diasHabiles(desde, hoy),
    alerta_enviada_en: cambio ? '' : (previo.alerta_enviada_en || ''),
    ultima_consulta: fmtFecha(hoy), error: ''
  };
  return { cambio: cambio, movimiento: movimiento, estado: estado };
}

// Estado previo sintético a partir del último movimiento de cada expediente (para la primera corrida
// después de importar la trazabilidad, o si ESTADO_ACTUAL se vació).
function previoDesdeMovimientos(movimientos) {
  var out = {};
  movimientos.forEach(function (m) {
    var f = parseFecha(m.fecha_pase);
    if (!f || !m.expediente) return;
    var prev = out[m.expediente];
    if (!prev || parseFecha(prev.desde) <= f) out[m.expediente] = { oficina_actual: String(m.oficina || ''), desde: fmtFecha(f), alerta_enviada_en: '' };
  });
  return out;
}

function nuevoId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; normOficina = P_.normOficina; diasHabiles = P_.diasHabiles;
  module.exports = { interpretarRespuesta, compararEstado, previoDesdeMovimientos, nuevoId };
}
