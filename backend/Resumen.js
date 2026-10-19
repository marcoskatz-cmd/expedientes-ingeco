// Resumen diario por mail (18 h): situación de los expedientes + movimientos del día. armarResumen es pura (node).

function esc_(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function pesos_(n) { var v = Number(n); return isNaN(v) || !v ? '' : '$' + v.toLocaleString('es-AR', { maximumFractionDigits: 0 }); }

/**
 * estados: filas de ESTADO_ACTUAL. movimientos: filas de MOVIMIENTOS. hoy: 'dd/mm/yyyy'.
 * Devuelve { asunto, texto, html, cantMov }.
 */
function armarResumen(estados, movimientos, hoy, umbral) {
  var activos = estados.filter(function (e) { return String(e.expediente || '').trim(); });
  var porExp = {};
  activos.forEach(function (e) { porExp[String(e.expediente)] = e; });
  var movs = movimientos.filter(function (m) { return String(m.detectado_en || '').trim() === hoy; });

  // Situación por oficina: cantidad y monto
  var oficinas = {}, total = 0, sinDato = 0;
  activos.forEach(function (e) {
    total += Number(e.monto) || 0;
    if (!e.oficina_actual) { sinDato++; return; }
    var o = oficinas[e.oficina_actual] = oficinas[e.oficina_actual] || { oficina: e.oficina_actual, cant: 0, monto: 0 };
    o.cant++; o.monto += Number(e.monto) || 0;
  });
  var listaOf = Object.keys(oficinas).map(function (k) { return oficinas[k]; }).sort(function (a, b) { return b.cant - a.cant || b.monto - a.monto; });
  var quietos = activos.filter(function (e) { return e.dias_quieto !== '' && Number(e.dias_quieto) > umbral; })
    .sort(function (a, b) { return Number(b.dias_quieto) - Number(a.dias_quieto); });

  var filaMov = function (m) {
    var e = porExp[String(m.expediente)] || {};
    return {
      exp: m.expediente, obra: e.nombre_obra || '',
      que: m.oficina === 'COBRADO' ? 'Cobrado' : 'Pasó a ' + m.oficina,
      det: m.dias_en_oficina_anterior !== '' && m.dias_en_oficina_anterior !== undefined ? m.dias_en_oficina_anterior + ' días hábiles en la oficina anterior' : '',
      monto: pesos_(e.monto)
    };
  };
  var fm = movs.map(filaMov);

  var asunto = 'Expedientes INGECO — resumen ' + hoy + ': ' + (movs.length ? movs.length + ' movimiento(s)' : 'sin movimientos');

  // Texto plano (respaldo para clientes sin HTML)
  var t = [];
  t.push('RESUMEN DE EXPEDIENTES — ' + hoy, '');
  t.push('MOVIMIENTOS DEL DÍA (' + movs.length + ')');
  if (!fm.length) t.push('Sin movimientos hoy.');
  fm.forEach(function (r) { t.push('• ' + r.exp + ' ' + r.obra + ': ' + r.que + (r.det ? ' (' + r.det + ')' : '') + (r.monto ? ' — ' + r.monto : '')); });
  t.push('', 'SITUACIÓN: ' + activos.length + ' expedientes a cobrar' + (total ? ' por ' + pesos_(total) : ''));
  listaOf.forEach(function (o) { t.push('• ' + o.oficina + ': ' + o.cant + (o.monto ? ' — ' + pesos_(o.monto) : '')); });
  if (sinDato) t.push('• Sin dato del municipio: ' + sinDato);
  t.push('', 'QUIETOS MÁS DE ' + umbral + ' DÍAS HÁBILES (' + quietos.length + ')');
  quietos.forEach(function (e) { t.push('• ' + e.expediente + ' ' + (e.nombre_obra || '') + ': ' + e.dias_quieto + ' días en ' + e.oficina_actual); });
  t.push('', 'Ver en la app INGECO → Expedientes: https://marcoskatz-cmd.github.io/expedientes-ingeco/');

  // HTML: azul / ámbar, sin rojo-verde
  var th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #1f4e79;color:#1f4e79"';
  var td = 'style="padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top"';
  var tabla = function (cab, filas) {
    return '<table style="border-collapse:collapse;width:100%;font-size:14px"><tr>' + cab.map(function (c) { return '<th ' + th + '>' + c + '</th>'; }).join('') + '</tr>' +
      filas.map(function (f) { return '<tr>' + f.map(function (c) { return '<td ' + td + '>' + esc_(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  };
  var h = '<div style="font-family:Arial,sans-serif;color:#222;max-width:720px">';
  h += '<h2 style="color:#1f4e79;margin:0 0 4px">Expedientes INGECO</h2><div style="color:#666;margin-bottom:16px">Resumen del ' + esc_(hoy) + '</div>';
  h += '<h3 style="color:#1f4e79">Movimientos del día (' + movs.length + ')</h3>';
  h += fm.length ? tabla(['Expediente', 'Obra', 'Movimiento', 'Detalle', 'Monto'], fm.map(function (r) { return [r.exp, r.obra, r.que, r.det, r.monto]; })) : '<p>Sin movimientos hoy.</p>';
  h += '<h3 style="color:#1f4e79">Situación: ' + activos.length + ' expedientes a cobrar' + (total ? ' por ' + esc_(pesos_(total)) : '') + '</h3>';
  var filasOf = listaOf.map(function (o) { return [o.oficina, o.cant, pesos_(o.monto)]; });
  if (sinDato) filasOf.push(['Sin dato del municipio', sinDato, '']);
  h += tabla(['Oficina', 'Expedientes', 'Monto'], filasOf);
  h += '<h3 style="color:#b36b00">Quietos más de ' + umbral + ' días hábiles (' + quietos.length + ')</h3>';
  h += quietos.length ? tabla(['Expediente', 'Obra', 'Oficina', 'Días', 'Monto'], quietos.map(function (e) { return [e.expediente, e.nombre_obra, e.oficina_actual, e.dias_quieto, pesos_(e.monto)]; })) : '<p>Ninguno.</p>';
  h += '<p style="margin-top:20px"><a href="https://marcoskatz-cmd.github.io/expedientes-ingeco/" style="color:#1f4e79">Ver en la app INGECO → Expedientes</a></p></div>';

  return { asunto: asunto, texto: t.join('\n'), html: h, cantMov: movs.length };
}

/** Destinatarios: CONFIG mails_resumen; si está vacío, mails_alerta; si también, el dueño del script. */
function destinatariosResumen(cfg, dueno) {
  var lista = function (v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); };
  var m = lista(cfg.mails_resumen);
  if (!m.length) m = lista(cfg.mails_alerta);
  if (!m.length && dueno) m = [dueno];
  return m;
}

/** Lo dispara el trigger diario de las 18 h. Solo días hábiles (el bot no corre fines de semana). */
function enviarResumenDiario(forzado) {
  var ahora = new Date();
  var dia = Number(Utilities.formatDate(ahora, 'America/Argentina/Tucuman', 'u'));
  if (forzado !== true && dia > 5) return;
  var ssD = ssDatos_(), cfg = leerConfig_();
  var umbral = Number(cfg.umbral_dias_quieto) || CFG.UMBRAL_DEFAULT;
  var r = armarResumen(leerHoja_(ssD, 'ESTADO_ACTUAL'), leerHoja_(ssD, 'MOVIMIENTOS'), fmtFecha(ahora), umbral);
  var mails = destinatariosResumen(cfg, Session.getEffectiveUser().getEmail());
  if (!mails.length) { log_('AVISO', '', 'Resumen diario: no hay destinatarios'); return; }
  try {
    MailApp.sendEmail({ to: mails.join(','), subject: r.asunto, body: r.texto, htmlBody: r.html, name: 'Expedientes INGECO' });
    log_('INFO', '', 'Resumen diario enviado a ' + mails.length + ' destinatario(s), ' + r.cantMov + ' movimientos');
  } catch (e) { log_('ERROR', '', 'Resumen diario falló: ' + e.message); }
}

/** Para probar desde el editor cualquier día. */
function enviarResumenAhora() { enviarResumenDiario(true); }

if (typeof module !== 'undefined') module.exports = { armarResumen, destinatariosResumen };
