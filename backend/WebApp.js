// API JSON para la PWA. Content-Type de entrada text/plain (evita preflight CORS), respuesta JSON.

// Las fechas que Sheets haya convertido a Date salen como dd/mm/yyyy, nunca como ISO.
function json_(o) {
  var txt = JSON.stringify(o, function (k, v) { return (this[k] instanceof Date) ? fmtFecha(this[k]) : v; });
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return json_({ ok: true, sistema: 'Expedientes INGECO' }); }

function doPost(e) {
  var req;
  try { req = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Pedido inválido' }); }
  var accion = String(req.accion || ''), p = req.payload || {};
  try {
    if (accion.indexOf('setup_') === 0) return json_(accionSetup_(accion, p));
    // Toda acción exige una sesión válida de app-ingeco: los datos son montos y gestiones internas.
    var u = usuarioDeSesion_(p.sesion);
    if (!u) return json_({ ok: false, error: 'Abrí este sistema desde la app INGECO', sin_sesion: true });
    if (accion === 'estado') return json_(conCache_('estado', accionEstado_));
    if (accion === 'ficha') return json_(conCache_('ficha_' + String(p.expediente || ''), function () { return accionFicha_(p.expediente); }));
    if (accion === 'estadisticas') return json_(conCache_('estadisticas', accionEstadisticas_));
    if (accion === 'gestion') return json_(accionGestion_(p, u));
    if (accion === 'forzar_corrida') {
      if (!u.es_admin) return json_({ ok: false, error: 'Solo administradores' });
      correr(true); return json_({ ok: true });
    }
    return json_({ ok: false, error: 'Acción desconocida: ' + accion });
  } catch (err) {
    console.error(accion + ': ' + err + '\n' + (err.stack || ''));
    return json_({ ok: false, error: 'Algo falló del lado del servidor. Si sigue pasando, avisale a Marcos.', detalle: String(err.message || err) });
  }
}

function accionEstado_() {
  var ssD = ssDatos_();
  var estados = leerHoja_(ssD, 'ESTADO_ACTUAL');
  var log = leerUltimas_(ssD, 'LOG', 300);
  var ultimaCorrida = log.length ? log[log.length - 1].corrida : '';
  var avisos = log.filter(function (l) { return l.corrida === ultimaCorrida && (l.nivel === 'ERROR' || l.nivel === 'AVISO'); })
    .map(function (l) { return { nivel: l.nivel, expediente: l.expediente, mensaje: l.mensaje }; });
  var cfg = leerConfig_();
  return { ok: true, estados: estados, avisos: avisos, umbral: Number(cfg.umbral_dias_quieto) || CFG.UMBRAL_DEFAULT, ultima_corrida: ultimaCorrida, ultimos_movimientos: ultimosMovimientos_(ssD, estados, 8) };
}

// Últimos pases detectados por el bot (no la historia importada), del más nuevo al más viejo, con el nombre de la obra.
function ultimosMovimientos_(ssD, estados, n) {
  var nombres = {};
  estados.forEach(function (e) { nombres[String(e.expediente)] = e.nombre_obra; });
  var movs = leerHoja_(ssD, 'MOVIMIENTOS').filter(function (m) { return m.origen === 'bot'; });
  var k = function (m) { return fechaClave_(m.detectado_en) + fechaClave_(m.fecha_pase) + String(m.id); };
  movs.sort(function (a, b) { return k(b) < k(a) ? -1 : 1; });
  return movs.slice(0, n).map(function (m) {
    return { id: m.id, expediente: String(m.expediente), nombre_obra: nombres[String(m.expediente)] || '', fecha_pase: m.fecha_pase, detectado_en: m.detectado_en, oficina: m.oficina, comentarios: m.descripcion_api, dias_en_oficina_anterior: m.dias_en_oficina_anterior };
  });
}
function fechaClave_(f) { var d = parseFecha(f); return d ? Utilities.formatDate(d, 'America/Argentina/Tucuman', 'yyyyMMdd') : '00000000';
}

function accionFicha_(expediente) {
  var ssD = ssDatos_();
  expediente = String(expediente || '');
  var est = leerHoja_(ssD, 'ESTADO_ACTUAL').filter(function (e) { return String(e.expediente) === expediente; })[0];
  if (!est) return { ok: false, error: 'No encontré el expediente ' + expediente };
  var movs = leerHoja_(ssD, 'MOVIMIENTOS').filter(function (m) { return String(m.expediente) === expediente; });
  var gest = leerHoja_(ssD, 'GESTIONES').filter(function (g) { return String(g.expediente) === expediente; });
  return { ok: true, estado: est, movimientos: movs, gestiones: gest };
}

function accionEstadisticas_() {
  var ssD = ssDatos_();
  var oficinas = leerHoja_(ssD, 'OFICINAS');
  var movs = leerHoja_(ssD, 'MOVIMIENTOS');
  var porExp = {};
  movs.forEach(function (m) { (porExp[m.expediente] = porExp[m.expediente] || []).push(m); });
  var totales = [];
  Object.keys(porExp).forEach(function (k) {
    var l = porExp[k].sort(function (a, b) { return parseFecha(a.fecha_pase) - parseFecha(b.fecha_pase); });
    var fin = l.filter(function (m) { return /TESORERIA/.test(normOficina(m.oficina)); })[0];
    if (fin) totales.push(diasHabiles(parseFecha(l[0].fecha_pase), parseFecha(fin.fecha_pase)));
  });
  totales.sort(function (a, b) { return a - b; });
  var q = function (p) { return totales.length ? totales[Math.min(totales.length - 1, Math.floor(p * totales.length))] : 0; };
  return { ok: true, oficinas: oficinas, llegadas: llegadasPorOficina(movs, mapaCanon_(ssD)), rutas: leerHoja_(ssD, 'RUTAS'), min_casos: CFG.MIN_CASOS_MEDIANA, total: { casos: totales.length, mediana: mediana(totales), p25: q(0.25), p75: q(0.75) } };
}

function accionGestion_(p, u) {
  var tipos = ['llamé', 'fui', 'nota'];
  if (tipos.indexOf(p.tipo) < 0) return { ok: false, error: 'Tipo de gestión inválido' };
  if (!p.expediente || !String(p.texto || '').trim()) return { ok: false, error: 'Falta el texto de la gestión' };
  agregarFilas_(ssDatos_(), 'GESTIONES', [{ id: nuevoId(), expediente: p.expediente, fecha: fmtFecha(new Date()), tipo: p.tipo, texto: String(p.texto).trim().slice(0, 500), legajo: u.legajo, nombre: u.nombre_visible }]);
  invalidarCache_();
  return { ok: true };
}

// Verifica la sesión de módulo contra el backend común de app-ingeco (cache 5 min).
function usuarioDeSesion_(sesion) {
  if (!sesion) return null;
  // Clave de caché = hash del token completo (un prefijo compartido mezclaría sesiones distintas).
  var hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(sesion), Utilities.Charset.UTF_8));
  var cache = CacheService.getScriptCache(), k = 'ses_' + hash;
  var c = cache.get(k); if (c) return JSON.parse(c);
  var r = UrlFetchApp.fetch(CFG.APP_INGECO_BACKEND, { method: 'post', contentType: 'text/plain', muteHttpExceptions: true, payload: JSON.stringify({ accion: 'validar_sesion_modulo', payload: { sesion: sesion, modulo: CFG.MODULO } }) });
  var b; try { b = JSON.parse(r.getContentText()); } catch (e) { return null; }
  if (!b || !b.ok) return null;
  cache.put(k, JSON.stringify(b), 300);
  return b;
}
