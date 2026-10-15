// Acceso a la API del Municipio de San Miguel de Tucumán (la misma que usa back.smt.gob.ar).
// Login con CUIL/clave de Script Properties; token cacheado 50 minutos.

var CACHE_TOKEN_ = 'smt_token';

function loginSmt_() {
  var cuil = prop_('SMT_CUIL'), clave = prop_('SMT_CLAVE');
  // Nombres de campos: confirmados/ajustados con probarSmt() la primera vez.
  var r = UrlFetchApp.fetch(CFG.SMT_BASE + '/usuarios/login', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ cuil: cuil, password: clave })
  });
  if (r.getResponseCode() !== 200) throw new Error('Login SMT falló: HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  var b = JSON.parse(r.getContentText() || '{}');
  var token = b.token || (b.data && b.data.token);
  if (!token) throw new Error('Login SMT sin token en la respuesta: ' + JSON.stringify(b).slice(0, 200));
  CacheService.getScriptCache().put(CACHE_TOKEN_, token, 3000);
  return token;
}

function tokenSmt_() {
  return CacheService.getScriptCache().get(CACHE_TOKEN_) || loginSmt_();
}

function ultimoCurso_(nro, anio, reintento) {
  var r = UrlFetchApp.fetch(CFG.SMT_BASE + '/expedientes/ultimocurso', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: tokenSmt_() },
    payload: JSON.stringify({ anioexpediente: String(anio), nroexpediente: String(nro) + 'P' })
  });
  var code = r.getResponseCode();
  if (code === 401 || code === 403) {
    CacheService.getScriptCache().remove(CACHE_TOKEN_);
    if (!reintento) return ultimoCurso_(nro, anio, true);
    // Segundo 401 seguido: el login no sirve. Se aborta la corrida entera (ver Corrida.js).
    var err = new Error('El portal rechazó el token aun después de volver a loguear (HTTP ' + code + ')');
    err.esAuth = true;
    throw err;
  }
  var body = null;
  try { body = JSON.parse(r.getContentText() || 'null'); } catch (e) { body = null; }
  return { status: code, body: body };
}

/** Manual: correr desde el editor para ver la forma real de la respuesta. */
function probarSmt() {
  CacheService.getScriptCache().remove(CACHE_TOKEN_);
  var r = ultimoCurso_('240034', '2026');
  console.log(JSON.stringify(r, null, 2));
}
