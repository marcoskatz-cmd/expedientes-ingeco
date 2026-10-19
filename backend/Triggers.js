function esHorarioHabil_(d) {
  var h = Number(Utilities.formatDate(d, 'America/Argentina/Tucuman', 'H'));
  var dia = Number(Utilities.formatDate(d, 'America/Argentina/Tucuman', 'u')); // 1=lun..7=dom
  return dia >= 1 && dia <= 5 && h >= 9 && h <= 17;
}

/** Correr una vez desde el editor. Instala el bot horario y el resumen diario de las 18 h. */
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'correr' || t.getHandlerFunction() === 'enviarResumenDiario') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('correr').timeBased().everyHours(1).create();
  // Apps Script dispara dentro de la hora elegida (18:00–18:59); el resumen solo sale lun–vie.
  ScriptApp.newTrigger('enviarResumenDiario').timeBased().atHour(18).nearMinute(0).everyDays(1).inTimezone('America/Argentina/Tucuman').create();
  console.log('Triggers instalados: bot horario (9-17 lun-vie) y resumen diario 18 h');
}
