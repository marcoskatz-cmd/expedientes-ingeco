// Resumen diario por mail (18 h), en una carilla: pendientes con próxima oficina + movimientos del día. armarResumen es pura (node).

function esc_(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function pesos_(n) { var v = Number(n); return isNaN(v) || !v ? '' : '$' + v.toLocaleString('es-AR', { maximumFractionDigits: 0 }); }

/**
 * Una carilla: totales, movimientos del día y la lista completa de expedientes pendientes con oficina actual,
 * días ahí y próxima oficina según la ruta. estados: ESTADO_ACTUAL. movimientos: MOVIMIENTOS. hoy: 'dd/mm/yyyy'.
 * siguiente(e) → nombre de la próxima oficina ('' si no se sabe). Devuelve { asunto, texto, html, cantMov }.
 */
function armarResumen(estados, movimientos, hoy, umbral, siguiente) {
  siguiente = siguiente || function () { return ''; };
  var activos = estados.filter(function (e) { return String(e.expediente || '').trim(); });
  var porExp = {};
  activos.forEach(function (e) { porExp[String(e.expediente)] = e; });
  var movs = movimientos.filter(function (m) { return String(m.detectado_en || '').trim() === hoy; });

  var total = 0;
  activos.forEach(function (e) { total += Number(e.monto) || 0; });
  var esQuieto = function (e) { return e.dias_quieto !== '' && e.dias_quieto !== undefined && Number(e.dias_quieto) > umbral; };
  var cantQuietos = activos.filter(esQuieto).length;
  // Pendientes: los más demorados primero; sin dato del municipio al final.
  var pend = activos.slice().sort(function (a, b) {
    var da = a.oficina_actual ? Number(a.dias_quieto) || 0 : -1, db = b.oficina_actual ? Number(b.dias_quieto) || 0 : -1;
    return db - da || (Number(b.monto) || 0) - (Number(a.monto) || 0);
  }).map(function (e) {
    return { exp: e.expediente, obra: e.nombre_obra || '', oficina: e.oficina_actual || 'Sin dato del municipio',
      dias: e.oficina_actual && e.dias_quieto !== '' && e.dias_quieto !== undefined ? String(e.dias_quieto) : '',
      prox: e.oficina_actual ? siguiente(e) || '—' : '', monto: pesos_(e.monto), quieto: esQuieto(e) };
  });

  var fm = movs.map(function (m) {
    var e = porExp[String(m.expediente)] || {};
    return { exp: m.expediente, obra: e.nombre_obra || '', que: m.oficina === 'COBRADO' ? 'Cobrado' : 'Pasó a ' + m.oficina,
      det: m.dias_en_oficina_anterior !== '' && m.dias_en_oficina_anterior !== undefined ? m.dias_en_oficina_anterior + ' días hábiles en la anterior' : '' };
  });

  var asunto = 'Expedientes INGECO — resumen ' + hoy + ': ' + (movs.length ? movs.length + ' movimiento(s)' : 'sin movimientos');
  var cabecera = activos.length + ' expedientes pendientes' + (total ? ' por ' + pesos_(total) : '') + ' · ' + movs.length + ' movimiento(s) hoy · ' + cantQuietos + ' quietos más de ' + umbral + ' días hábiles';

  // Texto plano (respaldo para clientes sin HTML)
  var t = ['RESUMEN DE EXPEDIENTES — ' + hoy, cabecera, '', 'MOVIMIENTOS DEL DÍA (' + movs.length + ')'];
  if (!fm.length) t.push('Sin movimientos hoy.');
  fm.forEach(function (r) { t.push('• ' + r.exp + ' ' + r.obra + ': ' + r.que + (r.det ? ' (' + r.det + ')' : '')); });
  t.push('', 'PENDIENTES (' + pend.length + ')');
  pend.forEach(function (r) { t.push('• ' + r.exp + ' ' + r.obra + ': ' + r.oficina + (r.dias ? ', ' + r.dias + ' días' + (r.quieto ? ' (QUIETO)' : '') : '') + (r.prox ? ' → ' + r.prox : '') + (r.monto ? ' — ' + r.monto : '')); });
  t.push('', 'Información obtenida por la app de Expedientes de INGECO.');
  t.push('Ver en la app INGECO → Expedientes: https://marcoskatz-cmd.github.io/expedientes-ingeco/');

  // HTML compacto para que entre en una carilla. Azul / ámbar, sin rojo-verde.
  var th = 'style="text-align:left;padding:3px 5px;border-bottom:2px solid #1f4e79;color:#1f4e79"';
  var td = 'padding:3px 5px;border-bottom:1px solid #ddd;vertical-align:top';
  var tabla = function (cab, filas, resaltar) {
    return '<table style="border-collapse:collapse;width:100%;font-size:12px"><tr>' + cab.map(function (c) { return '<th ' + th + '>' + c + '</th>'; }).join('') + '</tr>' +
      filas.map(function (f, i) {
        var bg = resaltar && resaltar[i] ? ';background:#fff3d6' : '';
        return '<tr>' + f.map(function (c) { return '<td style="' + td + bg + '">' + esc_(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>';
  };
  var h = '<div style="font-family:Arial,sans-serif;color:#222;max-width:760px;font-size:12px">';
  h += '<h2 style="color:#1f4e79;margin:0">Expedientes INGECO — ' + esc_(hoy) + '</h2><div style="color:#444;margin:2px 0 10px">' + esc_(cabecera) + '</div>';
  h += '<h3 style="color:#1f4e79;margin:8px 0 4px;font-size:14px">Movimientos del día (' + movs.length + ')</h3>';
  h += fm.length ? tabla(['Expediente', 'Obra', 'Movimiento', 'Detalle'], fm.map(function (r) { return [r.exp, r.obra, r.que, r.det]; })) : '<p style="margin:2px 0">Sin movimientos hoy.</p>';
  h += '<h3 style="color:#1f4e79;margin:12px 0 4px;font-size:14px">Pendientes (' + pend.length + ')</h3>';
  h += tabla(['Expediente', 'Obra', 'Está en', 'Días', 'Próxima oficina', 'Monto'],
    pend.map(function (r) { return [r.exp, r.obra, r.oficina, r.dias, r.prox, r.monto]; }), pend.map(function (r) { return r.quieto; }));
  if (cantQuietos) h += '<div style="color:#8a5300;margin-top:4px">Fondo ámbar: quieto más de ' + umbral + ' días hábiles.</div>';
  h += '<p style="margin-top:10px"><a href="https://marcoskatz-cmd.github.io/expedientes-ingeco/" style="color:#1f4e79">Ver en la app INGECO → Expedientes</a></p>';
  h += '<p style="margin-top:12px;padding-top:6px;border-top:1px solid #ddd;color:#666;font-size:11px">Información obtenida por la app de Expedientes de INGECO · ' + esc_(hoy) + '</p></div>';

  return { asunto: asunto, texto: t.join('\n'), html: h, cantMov: movs.length };
}

/** Destinatarios: CONFIG mails_resumen; si está vacío, el default de Config.js (Julia Katz). */
function destinatariosResumen(cfg, porDefecto) {
  var lista = function (v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); };
  var m = lista(cfg.mails_resumen);
  return m.length ? m : lista(porDefecto);
}

/** Lo dispara el trigger diario de las 18 h. Solo días hábiles (el bot no corre fines de semana). */
function enviarResumenDiario(forzado) {
  var ahora = new Date();
  var dia = Number(Utilities.formatDate(ahora, 'America/Argentina/Tucuman', 'u'));
  if (forzado !== true && dia > 5) return;
  var ssD = ssDatos_(), cfg = leerConfig_();
  var umbral = Number(cfg.umbral_dias_quieto) || CFG.UMBRAL_DEFAULT;
  var rutas = leerHoja_(ssD, 'RUTAS'), mapaCanon = mapaCanon_(ssD);
  var r = armarResumen(leerHoja_(ssD, 'ESTADO_ACTUAL'), leerHoja_(ssD, 'MOVIMIENTOS'), fmtFecha(ahora), umbral,
    function (e) { return siguienteOficina(e, rutas, mapaCanon); });
  // Deja la fila mails_resumen visible en CONFIG para poder editar la lista de destinatarios ahí.
  if (cfg.mails_resumen === undefined) { try { ssD.getSheetByName('CONFIG').appendRow(['mails_resumen', CFG.MAILS_RESUMEN_DEFAULT]); } catch (e) { } }
  var mails = destinatariosResumen(cfg, CFG.MAILS_RESUMEN_DEFAULT);
  if (!mails.length) { log_('AVISO', '', 'Resumen diario: no hay destinatarios'); return; }
  try {
    // El resumen va como PDF adjunto; el cuerpo solo lo presenta.
    var pdf = Utilities.newBlob('<html><head><meta charset="utf-8"></head><body>' + r.html + '</body></html>', 'text/html', 'resumen.html').getAs('application/pdf').setName('Expedientes INGECO - resumen ' + fmtFecha(ahora).replace(/\//g, '-') + '.pdf');
    var cuerpo = 'Adjunto el resumen de expedientes a cobrar del ' + fmtFecha(ahora) + ' (' + (r.cantMov ? r.cantMov + ' movimiento(s) hoy' : 'sin movimientos hoy') + ').\n\nInformación obtenida por la app de Expedientes de INGECO.';
    MailApp.sendEmail({ to: mails.join(','), subject: r.asunto, body: cuerpo, attachments: [pdf], name: 'Expedientes INGECO' });
    log_('INFO', '', 'Resumen diario enviado a ' + mails.length + ' destinatario(s), ' + r.cantMov + ' movimientos');
  } catch (e) { log_('ERROR', '', 'Resumen diario falló: ' + e.message); }
}

/** Para probar desde el editor cualquier día. */
function enviarResumenAhora() { enviarResumenDiario(true); }

if (typeof module !== 'undefined') module.exports = { armarResumen, destinatariosResumen };
