// Orquestación del bot: una pasada completa por todos los expedientes activos.

function correr(forzado) {
  var hoy = new Date();
  if (!forzado && !esHorarioHabil_(hoy)) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { console.log('Ya hay una corrida en curso, salgo'); return; }
  try { correr_(hoy); } finally { lock.releaseLock(); }
}

function correr_(hoy) {
  CORRIDA_ID_ = null;
  var ssD = ssDatos_(), ssM = ssMaestro_();

  // 1. Maestro con diagnóstico
  var raw = leerHojaRaw_(ssM, CFG.HOJA_MAESTRO);
  var diag = diagnosticarEncabezados(raw.encabezados, CFG.COLS_MAESTRO_OBLIGATORIAS);
  if (!diag.ok) { log_('ERROR', '', 'La planilla OBRAS INGECO cambió: falta la columna ' + diag.faltan.join(', ')); return; }
  var maestro = maestroAExpedientes(filasAObjetos(raw.filas), CFG.COLS_MAESTRO);
  maestro.sinExpediente.forEach(function (s) { log_('AVISO', '', 'Sin expediente válido: "' + s.nombre + '" (' + s.texto + ', fila ' + s.fila + ')'); });

  // 2. Estado previo
  // Si no hay estado guardado, el último movimiento conocido (importado o del bot) hace de previo:
  // así la primera corrida no duplica lo que ya está en MOVIMIENTOS.
  var previos = previoDesdeMovimientos(leerHoja_(ssD, 'MOVIMIENTOS'));
  leerHoja_(ssD, 'ESTADO_ACTUAL').forEach(function (e) { previos[String(e.expediente)] = e; });

  // 3. Consultar
  var movimientos = [], estados = [], errores = 0, abortar = null;
  try { tokenSmt_(); } catch (e) { log_('ERROR', '', 'No se pudo entrar al portal del municipio: ' + e.message); marcarFallo_(); return; }

  maestro.activos.forEach(function (exp) {
    if (abortar) return;
    var prev = previos[exp.clave] || null, estado;
    try {
      var r = ultimoCurso_(exp.nro, exp.anio);
      var lect = r.status === 200 ? interpretarRespuesta(r.body) : { ok: false, motivo: 'HTTP ' + r.status };
      if (!lect.ok) {
        log_('AVISO', exp.clave, 'No encontrado o sin datos: ' + lect.motivo);
        estado = prev ? Object.assign({}, prev, { error: lect.motivo, ultima_consulta: fmtFecha(hoy) }) : estadoVacio_(exp, hoy, lect.motivo);
      } else {
        var c = compararEstado(prev, lect, exp, hoy);
        if (c.movimiento) movimientos.push(c.movimiento);
        estado = Object.assign({}, prev || {}, c.estado);
        if (c.cambio) escribirEnMaestro_(raw.hoja, raw.encabezados, exp.fila, lect);
      }
    } catch (e) {
      if (e.esAuth) { abortar = e.message; return; }
      errores++; log_('ERROR', exp.clave, e.message);
      estado = prev ? Object.assign({}, prev, { error: e.message }) : estadoVacio_(exp, hoy, e.message);
    }
    estados.push(estado);
  });
  if (abortar) { log_('ERROR', '', 'Corrida abortada, no se guarda nada: ' + abortar); marcarFallo_(); return; }
  if (maestro.activos.length && errores === maestro.activos.length) { log_('ERROR', '', 'Fallaron todas las consultas, no se guarda nada'); marcarFallo_(); return; }

  // 4. Guardar movimientos y recalcular estadísticas + proyección
  agregarFilas_(ssD, 'MOVIMIENTOS', movimientos);
  var todosMovs = leerHoja_(ssD, 'MOVIMIENTOS');
  var mapaCanon = mapaCanon_(ssD);
  var stats = medianasPorOficina(todosMovs, mapaCanon);
  var rutas = leerHoja_(ssD, 'RUTAS');
  var cfg = leerConfig_();
  estados.forEach(function (e) {
    if (!e.oficina_actual) return;
    Object.assign(e, proyectar(e, rutas, stats, hoy, CFG.MIN_CASOS_MEDIANA, mapaCanon));
    var n = normOficina(e.oficina_actual);
    if (!mapaCanon[n] && !rutas.some(function (r) { return normOficina(r.oficina) === n; })) log_('AVISO', e.expediente, 'Oficina nueva sin mapear: ' + e.oficina_actual);
  });
  reemplazarHoja_(ssD, 'ESTADO_ACTUAL', estados);
  guardarOficinas_(ssD, stats);

  // 5. Alertas
  evaluarAlertas_(estados, cfg, ssD);
  PropertiesService.getScriptProperties().setProperty('FALLOS_SEGUIDOS', '0');
  log_('INFO', '', 'Corrida ok: ' + maestro.activos.length + ' consultados, ' + movimientos.length + ' movimientos, ' + errores + ' errores');
}

/** Para correr a mano desde el editor, fuera de horario. */
function correrAhora() { correr(true); }

function estadoVacio_(exp, hoy, err) {
  return { expediente: exp.clave, nombre_obra: exp.nombre, monto: exp.monto, tipo_contrato: exp.tipo, prioridad: exp.prioridad, oficina_actual: '', desde: '', dias_quieto: '', ultima_consulta: fmtFecha(hoy), error: err };
}

function escribirEnMaestro_(hoja, enc, fila, lect) {
  var iO = enc.indexOf(CFG.COLS_MAESTRO.oficina), iU = enc.indexOf(CFG.COLS_MAESTRO.ultimoMov);
  if (iO >= 0) hoja.getRange(fila, iO + 1).setValue(lect.oficina);
  if (iU >= 0) hoja.getRange(fila, iU + 1).setValue(fmtFecha(lect.fechaPase));
}

function mapaCanon_(ssD) {
  var m = {};
  leerHoja_(ssD, 'OFICINAS').forEach(function (o) { if (o.nombre_canonico) m[normOficina(o.nombre_api)] = normOficina(o.nombre_canonico); });
  return m;
}

// Actualiza mediana/casos en todas las filas cuyo nombre canónico coincide; si la oficina no existe, la crea.
function guardarOficinas_(ssD, stats) {
  var filas = leerHoja_(ssD, 'OFICINAS'), porCanon = {};
  filas.forEach(function (o) { var c = normOficina(o.nombre_canonico || o.nombre_api); (porCanon[c] = porCanon[c] || []).push(o); });
  Object.keys(stats).forEach(function (canon) {
    if (!porCanon[canon]) { var nueva = { nombre_api: canon, nombre_canonico: canon }; filas.push(nueva); porCanon[canon] = [nueva]; }
    porCanon[canon].forEach(function (f) { f.mediana_dias = stats[canon].mediana_dias; f.casos = stats[canon].casos; });
  });
  reemplazarHoja_(ssD, 'OFICINAS', filas);
}

function marcarFallo_() {
  var p = PropertiesService.getScriptProperties();
  var n = Number(p.getProperty('FALLOS_SEGUIDOS') || 0) + 1;
  p.setProperty('FALLOS_SEGUIDOS', String(n));
  if (n === 3) MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Expedientes INGECO: el bot falló 3 veces seguidas', 'Revisá la hoja LOG de "Expedientes INGECO - Datos". Puede ser la clave del portal o que la API cambió.');
}
