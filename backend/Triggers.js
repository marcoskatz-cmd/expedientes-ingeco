function esHorarioHabil_(d) {
  var h = Number(Utilities.formatDate(d, 'America/Argentina/Tucuman', 'H'));
  var dia = Number(Utilities.formatDate(d, 'America/Argentina/Tucuman', 'u')); // 1=lun..7=dom
  return dia >= 1 && dia <= 5 && h >= 9 && h <= 17;
}

/** Correr una vez desde el editor. */
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'correr') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('correr').timeBased().everyHours(1).create();
  console.log('Trigger horario instalado (el bot ignora las horas fuera de 9-17 lun-vie)');
}
