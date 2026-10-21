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
  // La hora viene con fracción de segundo ('11:16:18.2306'); alcanza con HH:MM. Solo la trae el pase con fecha.
  var hora = /^(\d{1,2}):(\d{2})/.exec(String(curso.hora || ''));
  return {
    ok: true, oficina: oficina, oficinaNorm: normOficina(oficina), fechaPase: fechaPase,
    asunto: String(ex.asunto || '').trim(), comentarios: String(curso.comentarios || '').replace(/\s+/g, ' ').trim(),
    fechaInicio: parseFecha(ex.fecha),
    hora: hora ? ('0' + hora[1]).slice(-2) + ':' + hora[2] : '',
    // idestado 1 = el pase salió y la oficina todavía no lo recibió (sin fecha ni hora); 2 = recibido (fecha y hora de llegada).
    // Verificado 21-oct-2026 sobre 98 expedientes: 1 ⇔ fecha null, sin excepciones.
    estadoPase: curso.idestado === undefined || curso.idestado === null ? '' : curso.idestado,
    idCurso: curso.idcurso === undefined || curso.idcurso === null ? '' : curso.idcurso
  };
}

function recibidoTexto_(lectura) {
  return lectura.fechaPase ? fmtFecha(lectura.fechaPase) + (lectura.hora ? ' ' + lectura.hora : '') : '';
}

function compararEstado(previo, lectura, exp, hoy) {
  var desdePrev = previo ? parseFecha(previo.desde) : null;
  var mismaOficina = !!previo && normOficina(previo.oficina_actual) === lectura.oficinaNorm;
  var fechaPase = lectura.fechaPase || hoy;
  var cambio, recepcion = null;
  if (previo && previo.id_curso !== undefined && previo.id_curso !== '' && lectura.idCurso !== '' && lectura.idCurso !== undefined) {
    // Cada pase tiene su número de curso: mismo número = mismo pase. Si mientras tanto la oficina lo recibió, no es un
    // movimiento nuevo (antes contaba como tal y reiniciaba los días): solo se anota la llegada.
    cambio = String(previo.id_curso) !== String(lectura.idCurso);
    if (!cambio && !previo.recibido_en && lectura.fechaPase) recepcion = recibidoTexto_(lectura);
  } else {
    // Sin número de curso guardado (estado viejo): se compara oficina y fecha. Sin fecha del municipio, solo la oficina.
    var mismaFecha = !lectura.fechaPase || (!!desdePrev && desdePrev.getTime() === fechaPase.getTime());
    cambio = !previo || !mismaOficina || !mismaFecha;
  }
  var movimiento = null;
  if (cambio) {
    movimiento = {
      id: nuevoId(), expediente: exp.clave, fecha_pase: fmtFecha(fechaPase), oficina: lectura.oficina,
      descripcion_api: (lectura.comentarios || lectura.asunto || '').slice(0, 300), detectado_en: fmtFecha(hoy), origen: 'bot',
      dias_en_oficina_anterior: (previo && desdePrev) ? diasHabiles(desdePrev, fechaPase) : '',
      hora_pase: lectura.hora || '', id_curso: lectura.idCurso === undefined ? '' : lectura.idCurso,
      recibido_en: recibidoTexto_(lectura)
    };
  }
  var desde = cambio ? fechaPase : desdePrev;
  var estado = {
    expediente: exp.clave, nombre_obra: exp.nombre, monto: exp.monto, tipo_contrato: exp.tipo, prioridad: exp.prioridad,
    oficina_actual: cambio ? lectura.oficina : previo.oficina_actual,
    desde: fmtFecha(desde), dias_quieto: diasHabiles(desde, hoy),
    alerta_enviada_en: cambio ? '' : (previo.alerta_enviada_en || ''),
    ultima_consulta: fmtFecha(hoy), error: '',
    // hora_pase acompaña a 'desde': si el pase llegó después, la hora de llegada va en recibido_en.
    hora_pase: cambio ? (lectura.hora || '') : ((previo && previo.hora_pase) || ''),
    estado_pase: lectura.estadoPase === undefined ? '' : lectura.estadoPase, id_curso: lectura.idCurso === undefined ? '' : lectura.idCurso,
    recibido_en: cambio ? recibidoTexto_(lectura) : (recepcion || (previo && previo.recibido_en) || '')
  };
  return { cambio: cambio, movimiento: movimiento, estado: estado, recepcion: recepcion };
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

// Un expediente que en el maestro pasó a "Cobrada" y que teníamos en seguimiento: se cierra su estadía en la última
// oficina (normalmente Tesorería) con un movimiento COBRADO fechado hoy. Es la única forma de medir cuánto tarda Tesorería.
function cerrarCobrados(previos, cobradosClaves, hoy) {
  var out = [];
  (cobradosClaves || []).forEach(function (clave) {
    var p = previos[clave];
    if (!p || !p.oficina_actual) return;
    var desde = parseFecha(p.desde);
    out.push({
      id: nuevoId(), expediente: clave, fecha_pase: fmtFecha(hoy), oficina: 'COBRADO', descripcion_api: 'Marcado como cobrado en la planilla OBRAS INGECO',
      detectado_en: fmtFecha(hoy), origen: 'bot', dias_en_oficina_anterior: desde ? diasHabiles(desde, hoy) : ''
    });
  });
  return out;
}

// Limpieza de lo registrado antes del 21-oct-2026: cuando un pase sin recibir se recibía, el bot anotaba un segundo
// movimiento en la misma oficina y reiniciaba los días. Se detecta como dos movimientos seguidos del bot con la misma
// oficina y el mismo comentario (el comentario es del pase: si cambia, fue un pase interno real).
// Devuelve qué borrar, qué corregir y desde cuándo está realmente en la oficina actual.
function unirDuplicados(movs) {
  var porExp = {}, borrar = [], cambios = {}, desde = {};
  movs.forEach(function (m) { (porExp[m.expediente] = porExp[m.expediente] || []).push(m); });
  Object.keys(porExp).forEach(function (exp) {
    var l = porExp[exp].slice().sort(function (a, b) { return parseFecha(a.fecha_pase) - parseFecha(b.fecha_pase); });
    var base = null;
    l.forEach(function (m, i) {
      var dup = base && m.origen === 'bot' && base.origen === 'bot' && normOficina(m.oficina) === normOficina(base.oficina) &&
        String(m.descripcion_api || '') !== '' && String(m.descripcion_api) === String(base.descripcion_api);
      if (!dup) { base = m; return; }
      borrar.push(m.id);
      cambios[base.id] = Object.assign(cambios[base.id] || {}, { recibido_en: fmtFecha(parseFecha(m.fecha_pase)) + (m.hora_pase ? ' ' + m.hora_pase : '') });
      var sig = l[i + 1];
      if (sig) cambios[sig.id] = Object.assign(cambios[sig.id] || {}, { dias_en_oficina_anterior: diasHabiles(parseFecha(base.fecha_pase), parseFecha(sig.fecha_pase)) });
      else desde[exp] = fmtFecha(parseFecha(base.fecha_pase));
    });
  });
  return { borrar: borrar, cambios: cambios, desde: desde };
}

function nuevoId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; normOficina = P_.normOficina; diasHabiles = P_.diasHabiles;
  module.exports = { interpretarRespuesta, compararEstado, previoDesdeMovimientos, cerrarCobrados, unirDuplicados, nuevoId };
}
