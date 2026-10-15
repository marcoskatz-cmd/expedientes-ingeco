// Configuración central. Los secretos viven en Script Properties, nunca acá.
var CFG = {
  SMT_BASE: 'https://estadisticas.smt.gob.ar:5000',
  APP_INGECO_BACKEND: 'https://script.google.com/macros/s/AKfycbx9NN1FfOQjUjfymLXrMyd2QM6l96HP0lxY6RC7_xKsbDlO0PnwdHbaMtag54VYFor0/exec',
  MODULO: 'EXPEDIENTES',
  HOJA_MAESTRO: 'OBRAS DE MUNICIPIO',
  HOJA_TRAZABILIDAD: 'trazabilidad',
  HOJA_RUTA_ORIGEN: 'Ruta contratos',
  HOJAS: {
    MOVIMIENTOS: ['id', 'expediente', 'fecha_pase', 'oficina', 'descripcion_api', 'detectado_en', 'origen', 'dias_en_oficina_anterior'],
    ESTADO_ACTUAL: ['expediente', 'nombre_obra', 'monto', 'tipo_contrato', 'prioridad', 'oficina_actual', 'desde', 'dias_quieto', 'etapa', 'paso_en_ruta', 'dias_restantes_est', 'fecha_cobro_est', 'calidad_estimacion', 'alerta_enviada_en', 'ultima_consulta', 'error'],
    RUTAS: ['tipo_contrato', 'orden', 'oficina', 'etapa', 'dias_default'],
    OFICINAS: ['nombre_api', 'nombre_canonico', 'mediana_dias', 'casos'],
    GESTIONES: ['id', 'expediente', 'fecha', 'tipo', 'texto', 'legajo', 'nombre'],
    CONFIG: ['clave', 'valor'],
    LOG: ['fecha', 'corrida', 'nivel', 'expediente', 'mensaje']
  },
  // Encabezados del maestro (planilla OBRAS INGECO). Se leen por nombre, nunca por posición.
  COLS_MAESTRO: {
    nombre: 'Nombre Obra', expediente: 'Expediente', estado$: 'Estado $', monto: 'Monto',
    tipo: 'Tipo de contrato', prioridad: 'Prioridad de seguimiento', obs: 'Observaciones',
    inicio: 'Inicio de Expediente', oficina: 'Oficina', ultimoMov: 'Ultimo Movimiento'
  },
  COLS_MAESTRO_OBLIGATORIAS: ['Nombre Obra', 'Expediente', 'Estado $', 'Monto', 'Tipo de contrato'],
  UMBRAL_DEFAULT: 10,
  MIN_CASOS_MEDIANA: 5
};

function prop_(nombre) {
  var v = PropertiesService.getScriptProperties().getProperty(nombre);
  if (!v) throw new Error('Falta la propiedad ' + nombre + ' en Script Properties');
  return v;
}

if (typeof module !== 'undefined') module.exports = { CFG };
