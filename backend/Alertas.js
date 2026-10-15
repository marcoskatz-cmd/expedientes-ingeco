// Alertas de expedientes quietos: mail + notificación por app-ingeco. seleccionarAlertas es pura (node).

function seleccionarAlertas(estados, umbral) {
  return estados.filter(function (e) { return e.dias_quieto !== '' && Number(e.dias_quieto) > umbral && !e.alerta_enviada_en; });
}

function evaluarAlertas_(estados, cfg, ssD) {
  var umbral = Number(cfg.umbral_dias_quieto) || CFG.UMBRAL_DEFAULT;
  var lista = seleccionarAlertas(estados, umbral);
  if (!lista.length) return;
  var hoy = fmtFecha(new Date());
  var lineas = lista.map(function (e) { return '• ' + e.nombre_obra + ' (' + e.expediente + '): ' + e.dias_quieto + ' días hábiles en ' + e.oficina_actual + ' — $' + Number(e.monto).toLocaleString('es-AR'); });
  var titulo = lista.length + ' expediente(s) quietos más de ' + umbral + ' días hábiles';
  var cuerpo = lineas.join('\n') + '\n\nVer en la app INGECO → Expedientes.';
  var mails = String(cfg.mails_alerta || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (mails.length) { try { MailApp.sendEmail(mails.join(','), 'Expedientes INGECO: ' + titulo, cuerpo); } catch (e) { log_('ERROR', '', 'Mail de alerta falló: ' + e.message); } }
  notificarApp_(titulo, cuerpo);
  lista.forEach(function (e) { e.alerta_enviada_en = hoy; });
  reemplazarHoja_(ssD, 'ESTADO_ACTUAL', estados);
  log_('INFO', '', 'Alertas enviadas: ' + lista.length);
}

function notificarApp_(titulo, cuerpo) {
  var clave = PropertiesService.getScriptProperties().getProperty('CLAVE_EXPEDIENTES');
  if (!clave) { log_('AVISO', '', 'Sin CLAVE_EXPEDIENTES: no se notifica por la app'); return; }
  try {
    UrlFetchApp.fetch(CFG.APP_INGECO_BACKEND, {
      method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
      payload: JSON.stringify({ accion: 'notificar', clave_sistema: clave, modulo: CFG.MODULO, destinatarios: [{ admin: true }], tipo: 'aviso_general', titulo: titulo, cuerpo: cuerpo, url_destino: 'https://marcoskatz-cmd.github.io/expedientes-ingeco/', prioridad: 'normal' })
    });
  } catch (e) { log_('ERROR', '', 'notificar app-ingeco falló: ' + e.message); }
}

if (typeof module !== 'undefined') module.exports = { seleccionarAlertas };
