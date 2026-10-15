// Alertas de expedientes quietos: mail + notificación por app-ingeco. seleccionarAlertas es pura (node).

function seleccionarAlertas(estados, umbral) {
  return estados.filter(function (e) { return e.dias_quieto !== '' && Number(e.dias_quieto) > umbral && !e.alerta_enviada_en; });
}

function hayCanal(mails, clave) { return !!(mails && mails.length) || !!clave; }

function evaluarAlertas_(estados, cfg, ssD) {
  var umbral = Number(cfg.umbral_dias_quieto) || CFG.UMBRAL_DEFAULT;
  var lista = seleccionarAlertas(estados, umbral);
  if (!lista.length) return;
  var mailsCfg = String(cfg.mails_alerta || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var claveApp = PropertiesService.getScriptProperties().getProperty('CLAVE_EXPEDIENTES');
  if (!hayCanal(mailsCfg, claveApp)) { log_('AVISO', '', lista.length + ' expedientes quietos, pero no hay mails_alerta en CONFIG ni CLAVE_EXPEDIENTES: no se avisa'); return; }
  var hoy = fmtFecha(new Date());
  var lineas = lista.map(function (e) { return '• ' + e.nombre_obra + ' (' + e.expediente + '): ' + e.dias_quieto + ' días hábiles en ' + e.oficina_actual + ' — $' + Number(e.monto).toLocaleString('es-AR'); });
  var titulo = lista.length + ' expediente(s) quietos más de ' + umbral + ' días hábiles';
  var cuerpo = lineas.join('\n') + '\n\nVer en la app INGECO → Expedientes.';
  var mails = mailsCfg;
  if (mails.length) { try { MailApp.sendEmail(mails.join(','), 'Expedientes INGECO: ' + titulo, cuerpo); } catch (e) { log_('ERROR', '', 'Mail de alerta falló: ' + e.message); } }
  notificarApp_(titulo, cuerpo);
  lista.forEach(function (e) { e.alerta_enviada_en = hoy; });
  reemplazarHoja_(ssD, 'ESTADO_ACTUAL', estados);
  log_('INFO', '', 'Alertas enviadas: ' + lista.length);
}

/**
 * Aviso por la app INGECO. opts: { destinatarios, prioridad, clave_unica, url_destino }.
 * Por defecto va a todos los que tienen el módulo Expedientes más los admins.
 */
function notificarApp_(titulo, cuerpo, opts) {
  opts = opts || {};
  var clave = PropertiesService.getScriptProperties().getProperty('CLAVE_EXPEDIENTES');
  if (!clave) { log_('AVISO', '', 'Sin CLAVE_EXPEDIENTES: no se notifica por la app'); return; }
  try {
    var r = UrlFetchApp.fetch(CFG.APP_INGECO_BACKEND, {
      method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
      payload: JSON.stringify({
        accion: 'notificar', clave_sistema: clave, modulo: CFG.MODULO,
        destinatarios: opts.destinatarios || [{ con_modulo: CFG.MODULO }, { admin: true }],
        tipo: 'aviso_general', titulo: titulo, cuerpo: cuerpo,
        url_destino: opts.url_destino || 'https://marcoskatz-cmd.github.io/expedientes-ingeco/',
        prioridad: opts.prioridad || 'normal', clave_unica: opts.clave_unica || '', dias_unica: 60
      })
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) { }
    if (!j.ok) log_('AVISO', '', 'app-ingeco no aceptó el aviso: ' + r.getContentText().slice(0, 160));
  } catch (e) { log_('ERROR', '', 'notificar app-ingeco falló: ' + e.message); }
}

/** Un aviso por cada movimiento detectado en la corrida (pase de oficina o cobro). */
function avisarMovimientos_(avisos) {
  avisos.forEach(function (a) {
    try { notificarApp_(a.titulo, a.cuerpo, { clave_unica: 'mov-' + a.id }); } catch (e) { log_('ERROR', a.expediente, 'aviso de movimiento falló: ' + e.message); }
  });
}

if (typeof module !== 'undefined') module.exports = { seleccionarAlertas, hayCanal };
