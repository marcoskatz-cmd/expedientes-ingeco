# Expedientes INGECO — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot horario en Apps Script que consulta la API del Municipio SMT por cada expediente de cobro de INGECO, registra cada pase entre oficinas, proyecta días restantes hasta Tesorería y lo muestra en una PWA bajo app-ingeco.

**Architecture:** Lógica pura (parseo, comparación de estados, proyección, importación) en archivos JS sin globals de Apps Script, testeados con `node --test`. Capa de pegamento (Sheets, UrlFetchApp, triggers, doPost) en archivos separados, probada a mano desde el editor de Apps Script. Web estática que consume la API JSON por `doPost`.

**Tech Stack:** Google Apps Script V8 (clasp), Google Sheets, Node 18+ solo para tests (`node --test`, sin dependencias), HTML/CSS/JS plano en GitHub Pages, guard.js de app-ingeco.

**Spec:** `docs/superpowers/specs/2026-10-15-expedientes-ingeco-design.md`

## Global Constraints

- Stack: Apps Script + Sheets + PWA estática. Sin frameworks, sin npm en producción.
- Todo texto visible en español llano. Nunca "Error 500": decir qué pasó y qué hacer.
- Colores: nunca rojo-verde. teal `#0f766e` = bien, ámbar `#b45309` = atención, gris `#6b7280` = sin dato.
- Credenciales SMT solo en Script Properties `SMT_CUIL` / `SMT_CLAVE`. Nunca en el repo ni en logs.
- Número de expediente a la API: `nroexpediente` = número + sufijo `P`, `anioexpediente` = año como string.
- Bot: trigger cada hora, solo 9–17 h, lunes a viernes, zona `America/Argentina/Tucuman`.
- Umbral de alerta por defecto: 10 días hábiles, leído de CONFIG `umbral_dias_quieto`.
- Proyección: mediana por oficina con ≥ 5 casos; si no, `dias_default` de RUTAS y `calidad = "debil"`.
- Lectura del maestro por nombre de encabezado, nunca por posición. Falta de encabezado obligatorio → no corre, LOG + cartel en la app.
- Deploy: `clasp push` / `clasp deploy -i`; web por `git subtree push --prefix web origin gh-pages`. Nunca copy-paste al editor.
- Repo privado `marcoskatz-cmd/expedientes-ingeco`, commit directo a `main`.

## Review Focus

1. Expediente con número no estándar en el maestro ("s/e", "242028 - expediente madre", "1278/25" con año corto) → se separa como "sin expediente válido", nunca rompe la corrida. (Task 2)
2. La API devuelve 200 con cuerpo vacío o sin `curso` para un expediente inexistente → se registra en LOG como "no encontrado", el estado anterior se conserva. (Task 5)
3. Oficina que vuelve con mayúsculas/espacios distintos ("Tesorería General " vs "TESORERIA GENERAL") → se normaliza antes de comparar, no genera movimiento falso. (Task 4)
4. Token vencido a mitad de corrida (401) → se reloguea una vez y reintenta; si falla de nuevo, aborta la corrida con LOG, sin dejar ESTADO_ACTUAL a medias. (Task 5)
5. Fecha de pase que viene en formato `dd/mm/yyyy` o ISO → ambas se parsean; una fecha inválida no genera movimiento y se loguea. (Task 2)

---

## Estructura de archivos

```
expedientes-ingeco/
  package.json                  scripts: "test": "node --test tests/"
  .gitignore                    node_modules, .clasprc, backend/.clasp.json NO (sí va, sin secretos)
  backend/
    appsscript.json
    .clasp.json                 scriptId (se completa al crear el proyecto)
    Config.js                   constantes, Script Properties, nombres de hojas/columnas
    Parse.js                    PURO: parseExpediente, parseFecha, normOficina, diasHabiles
    Motor.js                    PURO: compararEstado(estadoPrevio, respuestaApi) → {cambio, movimiento, estadoNuevo}
    Proyeccion.js               PURO: medianasPorOficina(movs), proyectar(estado, ruta, oficinas, hoy)
    Importar.js                 PURO: trazabilidadAMovimientos(filas) + glue importarTrazabilidad()
    Smt.js                      glue: loginSmt_(), ultimoCurso_(token, nro, anio)
    Hojas.js                    glue: leerMaestro_(), leerHoja_(nombre), escribirFilas_(), crearPlanillaDatos()
    Corrida.js                  glue: correr() orquesta todo
    Alertas.js                  glue: evaluarAlertas_(), mail + notificar app-ingeco
    WebApp.js                   doPost + acciones
    Triggers.js                 instalarTrigger(), esHorarioHabil_()
  tests/
    parse.test.js
    motor.test.js
    proyeccion.test.js
    importar.test.js
  web/
    index.html, app.js, estilos.css, manifest.webmanifest, sw.js, ayuda.html
  docs/
```

**Convención para archivos PUROS** (Parse, Motor, Proyeccion, Importar): funciones globales normales (Apps Script las necesita así) y al final:

```js
if (typeof module !== 'undefined') module.exports = { parseExpediente, parseFecha, normOficina, diasHabiles };
```

Apps Script ignora `module` (no existe). Node lo usa. `.claspignore` excluye `tests/` y `package.json`.

---

### Task 1: Esqueleto del repo, clasp y test runner

**Files:**
- Create: `package.json`, `.gitignore`, `backend/appsscript.json`, `backend/.claspignore`, `backend/Config.js`, `tests/smoke.test.js`

**Interfaces:**
- Produces: `CFG` global (Config.js) con `HOJAS`, `COLS_MAESTRO`, `prop_(nombre)`.

- [ ] **Step 1: package.json y .gitignore**

```json
{
  "name": "expedientes-ingeco",
  "private": true,
  "scripts": { "test": "node --test tests/" }
}
```

`.gitignore`:
```
node_modules/
.clasprc.json
*.log
```

- [ ] **Step 2: backend/appsscript.json y .claspignore**

```json
{
  "timeZone": "America/Argentina/Tucuman",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

`backend/.claspignore`:
```
**/**
!*.js
!appsscript.json
```

- [ ] **Step 3: backend/Config.js**

```js
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
  // Encabezados del maestro. Obligatorios: los que no tienen "opcional".
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
```

- [ ] **Step 4: tests/smoke.test.js**

```js
const test = require('node:test');
const assert = require('node:assert');
const { CFG } = require('../backend/Config.js');
test('config tiene las 7 hojas', () => {
  assert.strictEqual(Object.keys(CFG.HOJAS).length, 7);
});
```

- [ ] **Step 5: Correr tests**

Run: `npm test`
Expected: 1 pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Esqueleto: config, clasp y test runner"
```

---

### Task 2: Parse.js — expediente, fechas, oficinas, días hábiles

**Files:**
- Create: `backend/Parse.js`, `tests/parse.test.js`

**Interfaces:**
- Produces:
  - `parseExpediente(texto) → {nro:string, anio:string, clave:"nro/anio"} | null`
  - `parseFecha(x) → Date | null` (acepta Date, `dd/mm/yyyy`, `dd/mm/yy`, ISO `yyyy-mm-dd...`)
  - `fmtFecha(date) → "dd/mm/yyyy"`
  - `normOficina(texto) → string` (sin tildes, mayúsculas, espacios colapsados)
  - `diasHabiles(desde, hasta) → number` (lun–vie, sin feriados)
  - `sumarDiasHabiles(desde, n) → Date`

- [ ] **Step 1: Tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../backend/Parse.js');

test('parseExpediente formatos válidos', () => {
  assert.deepStrictEqual(P.parseExpediente('240034/2026'), { nro: '240034', anio: '2026', clave: '240034/2026' });
  assert.deepStrictEqual(P.parseExpediente(' 1278/25 '), { nro: '1278', anio: '2025', clave: '1278/2025' });
  assert.deepStrictEqual(P.parseExpediente('241197/2025'), { nro: '241197', anio: '2025', clave: '241197/2025' });
});
test('parseExpediente inválidos → null', () => {
  for (const x of ['s/e', '', null, undefined, '242028 - expediente madre', 'mayo-13', 240034]) {
    assert.strictEqual(P.parseExpediente(x), null, String(x));
  }
});
test('parseFecha', () => {
  assert.strictEqual(P.parseFecha('04/09/2025').toISOString().slice(0, 10), '2025-09-04');
  assert.strictEqual(P.parseFecha('11/3/25').toISOString().slice(0, 10), '2025-03-11');
  assert.strictEqual(P.parseFecha('2026-02-13T00:00:00.000Z').toISOString().slice(0, 10), '2026-02-13');
  assert.strictEqual(P.parseFecha(new Date(2026, 0, 5)).getDate(), 5);
  assert.strictEqual(P.parseFecha('31/02/2025'), null);
  assert.strictEqual(P.parseFecha(''), null);
  assert.strictEqual(P.parseFecha('ayer'), null);
});
test('fmtFecha', () => assert.strictEqual(P.fmtFecha(new Date(2026, 9, 15)), '15/10/2026'));
test('normOficina', () => {
  assert.strictEqual(P.normOficina(' Tesorería  General '), 'TESORERIA GENERAL');
  assert.strictEqual(P.normOficina('Dirección de Obras Viales'), 'DIRECCION DE OBRAS VIALES');
  assert.strictEqual(P.normOficina(null), '');
});
test('diasHabiles', () => {
  // lun 6-oct-2025 → lun 20-oct-2025 = 10 hábiles
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 6), new Date(2025, 9, 20)), 10);
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 6), new Date(2025, 9, 6)), 0);
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 10), new Date(2025, 9, 13)), 1); // vie→lun
  assert.strictEqual(P.diasHabiles(new Date(2025, 9, 20), new Date(2025, 9, 6)), 0); // invertido → 0
});
test('sumarDiasHabiles', () => {
  assert.strictEqual(P.fmtFecha(P.sumarDiasHabiles(new Date(2025, 9, 10), 1)), '13/10/2025');
  assert.strictEqual(P.fmtFecha(P.sumarDiasHabiles(new Date(2025, 9, 6), 10)), '20/10/2025');
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm test`
Expected: FAIL, "Cannot find module '../backend/Parse.js'".

- [ ] **Step 3: Implementar backend/Parse.js**

```js
// Funciones puras de parseo. Sin globals de Apps Script: se testean con node.

function parseExpediente(texto) {
  if (typeof texto !== 'string') return null;
  var m = texto.trim().match(/^(\d{1,7})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  var anio = m[2].length === 2 ? '20' + m[2] : m[2];
  return { nro: m[1], anio: anio, clave: m[1] + '/' + anio };
}

function parseFecha(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
  if (typeof x !== 'string' || !x.trim()) return null;
  var s = x.trim(), d, m, y, mm;
  if ((mm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/))) {
    d = +mm[1]; m = +mm[2] - 1; y = mm[3].length === 2 ? 2000 + +mm[3] : +mm[3];
  } else if ((mm = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    y = +mm[1]; m = +mm[2] - 1; d = +mm[3];
  } else return null;
  var f = new Date(y, m, d);
  if (f.getFullYear() !== y || f.getMonth() !== m || f.getDate() !== d) return null;
  return f;
}

function fmtFecha(f) {
  if (!(f instanceof Date) || isNaN(f)) return '';
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(f.getDate()) + '/' + p(f.getMonth() + 1) + '/' + f.getFullYear();
}

function normOficina(t) {
  if (t === null || t === undefined) return '';
  return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function esHabil_(f) { var d = f.getDay(); return d !== 0 && d !== 6; }

function diasHabiles(desde, hasta) {
  if (!desde || !hasta || hasta <= desde) return 0;
  var n = 0, f = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  var fin = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  while (f < fin) { f.setDate(f.getDate() + 1); if (esHabil_(f)) n++; }
  return n;
}

function sumarDiasHabiles(desde, n) {
  var f = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  while (n > 0) { f.setDate(f.getDate() + 1); if (esHabil_(f)) n--; }
  return f;
}

if (typeof module !== 'undefined') module.exports = { parseExpediente, parseFecha, fmtFecha, normOficina, diasHabiles, sumarDiasHabiles };
```

- [ ] **Step 4: Correr tests** → todos pass.

- [ ] **Step 5: Commit** `git commit -am "Parse: expediente, fechas, oficinas, días hábiles"` (agregar archivos nuevos con `git add`).

---

### Task 3: Hojas.js — lectura del maestro con auto-diagnóstico y acceso a la planilla de datos

**Files:**
- Create: `backend/Hojas.js`, `backend/Diagnostico.js`, `tests/diagnostico.test.js`

**Interfaces:**
- Produces (puro, Diagnostico.js):
  - `diagnosticarEncabezados(encabezados:string[], obligatorias:string[]) → {ok:boolean, faltan:string[]}`
  - `filasAObjetos(valores:any[][]) → object[]` (primera fila = encabezados, trim)
  - `maestroAExpedientes(objs:object[], cols) → {activos:[{clave,nro,anio,nombre,monto,tipo,prioridad,obs,inicio,fila}], sinExpediente:[{nombre,texto,fila}], cobrados:number}`
- Produces (glue, Hojas.js):
  - `ssDatos_() → Spreadsheet`, `ssMaestro_() → Spreadsheet`
  - `leerHoja_(ss, nombre) → object[]`, `leerHojaRaw_(ss, nombre) → {encabezados, filas}`
  - `agregarFilas_(ss, nombre, objs)` (escribe en orden de `CFG.HOJAS[nombre]`)
  - `reemplazarHoja_(ss, nombre, objs)` (borra y reescribe)
  - `log_(nivel, expediente, mensaje)` (append en LOG con corrida actual)
  - `leerConfig_() → {clave: valor}`
  - `crearPlanillaDatos()` (setup, una vez: crea las 7 hojas con encabezados y CONFIG default)

- [ ] **Step 1: Tests de Diagnostico**

```js
const test = require('node:test');
const assert = require('node:assert');
const D = require('../backend/Diagnostico.js');
const { CFG } = require('../backend/Config.js');

test('diagnosticarEncabezados detecta faltantes', () => {
  assert.deepStrictEqual(D.diagnosticarEncabezados(['Nombre Obra', 'Expediente'], CFG.COLS_MAESTRO_OBLIGATORIAS),
    { ok: false, faltan: ['Estado $', 'Monto', 'Tipo de contrato'] });
  assert.deepStrictEqual(D.diagnosticarEncabezados(CFG.COLS_MAESTRO_OBLIGATORIAS.concat(['x']), CFG.COLS_MAESTRO_OBLIGATORIAS), { ok: true, faltan: [] });
});
test('filasAObjetos usa encabezados con trim', () => {
  const r = D.filasAObjetos([[' Expediente ', 'Monto'], ['1/2026', 5], ['', '']]);
  assert.deepStrictEqual(r, [{ Expediente: '1/2026', Monto: 5, __fila: 2 }]);
});
test('maestroAExpedientes separa activos, sin expediente y cobrados', () => {
  const objs = [
    { 'Nombre Obra': 'A', Expediente: '240034/2026', 'Estado $': 'A Cobrar', Monto: ' $235.718.068,87 ', 'Tipo de contrato': 'Contratación Directa', __fila: 2 },
    { 'Nombre Obra': 'B', Expediente: 's/e', 'Estado $': 'A Cobrar', Monto: '', 'Tipo de contrato': '', __fila: 3 },
    { 'Nombre Obra': 'C', Expediente: '1278/2025', 'Estado $': 'Cobrada ', Monto: 1, 'Tipo de contrato': '', __fila: 4 },
    { 'Nombre Obra': '', Expediente: '', 'Estado $': '', Monto: '', 'Tipo de contrato': '', __fila: 5 }
  ];
  const r = D.maestroAExpedientes(objs, CFG.COLS_MAESTRO);
  assert.strictEqual(r.activos.length, 1);
  assert.strictEqual(r.activos[0].clave, '240034/2026');
  assert.strictEqual(r.activos[0].monto, 235718068.87);
  assert.strictEqual(r.activos[0].prioridad, 'Normal');
  assert.deepStrictEqual(r.sinExpediente, [{ nombre: 'B', texto: 's/e', fila: 3 }]);
  assert.strictEqual(r.cobrados, 1);
});
test('parseMonto', () => {
  assert.strictEqual(D.parseMonto(' $352.350.310,00 '), 352350310);
  assert.strictEqual(D.parseMonto(1234.5), 1234.5);
  assert.strictEqual(D.parseMonto(''), 0);
});
```

- [ ] **Step 2: Correr → falla por módulo inexistente.**

- [ ] **Step 3: backend/Diagnostico.js**

```js
function diagnosticarEncabezados(encabezados, obligatorias) {
  var set = {};
  (encabezados || []).forEach(function (h) { set[String(h).trim()] = true; });
  var faltan = obligatorias.filter(function (c) { return !set[c]; });
  return { ok: faltan.length === 0, faltan: faltan };
}

function filasAObjetos(valores) {
  if (!valores || !valores.length) return [];
  var enc = valores[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i], vacia = true, o = { __fila: i + 1 };
    for (var j = 0; j < enc.length; j++) {
      if (!enc[j]) continue;
      var v = fila[j];
      if (v !== '' && v !== null && v !== undefined) vacia = false;
      o[enc[j]] = v;
    }
    if (!vacia) out.push(o);
  }
  return out;
}

function parseMonto(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function esCobrado_(estado$) { return /^cobrad[oa]/i.test(String(estado$ || '').trim()); }

function maestroAExpedientes(objs, cols) {
  var activos = [], sinExpediente = [], cobrados = 0;
  objs.forEach(function (o) {
    var nombre = String(o[cols.nombre] || '').trim();
    var texto = String(o[cols.expediente] || '').trim();
    if (!nombre && !texto) return;
    if (esCobrado_(o[cols.estado$])) { cobrados++; return; }
    var e = parseExpediente(texto);
    if (!e) { sinExpediente.push({ nombre: nombre, texto: texto, fila: o.__fila }); return; }
    activos.push({
      clave: e.clave, nro: e.nro, anio: e.anio, nombre: nombre,
      monto: parseMonto(o[cols.monto]),
      tipo: String(o[cols.tipo] || '').trim(),
      prioridad: String(o[cols.prioridad] || '').trim() || 'Normal',
      obs: String(o[cols.obs] || '').trim(),
      inicio: parseFecha(o[cols.inicio]),
      fila: o.__fila
    });
  });
  return { activos: activos, sinExpediente: sinExpediente, cobrados: cobrados };
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); parseExpediente = P_.parseExpediente; parseFecha = P_.parseFecha;
  module.exports = { diagnosticarEncabezados, filasAObjetos, parseMonto, maestroAExpedientes };
}
```

Nota: en node, `parseExpediente` y `parseFecha` se inyectan al final porque en Apps Script son globales. En node las asignaciones a variables no declaradas funcionan en modo no estricto; no agregar `'use strict'` a este archivo.

- [ ] **Step 4: Correr tests → pass.**

- [ ] **Step 5: backend/Hojas.js (glue, sin test automático)**

```js
function ssDatos_() { return SpreadsheetApp.openById(prop_('SHEET_DATOS')); }
function ssMaestro_() { return SpreadsheetApp.openById(prop_('SHEET_MAESTRO')); }

function leerHojaRaw_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) throw new Error('No existe la hoja "' + nombre + '" en ' + ss.getName());
  var v = h.getDataRange().getValues();
  return { hoja: h, encabezados: v.length ? v[0].map(function (x) { return String(x).trim(); }) : [], filas: v };
}
function leerHoja_(ss, nombre) { return filasAObjetos(leerHojaRaw_(ss, nombre).filas); }

function agregarFilas_(ss, nombre, objs) {
  if (!objs.length) return;
  var cols = CFG.HOJAS[nombre];
  var h = ss.getSheetByName(nombre);
  var filas = objs.map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : o[c]; }); });
  h.getRange(h.getLastRow() + 1, 1, filas.length, cols.length).setValues(filas);
}

function reemplazarHoja_(ss, nombre, objs) {
  var cols = CFG.HOJAS[nombre];
  var h = ss.getSheetByName(nombre);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, h.getMaxColumns()).clearContent();
  agregarFilas_(ss, nombre, objs);
}

var CORRIDA_ID_ = null;
function log_(nivel, expediente, mensaje) {
  if (!CORRIDA_ID_) CORRIDA_ID_ = Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', 'yyyyMMdd-HHmm');
  try {
    agregarFilas_(ssDatos_(), 'LOG', [{ fecha: new Date(), corrida: CORRIDA_ID_, nivel: nivel, expediente: expediente || '', mensaje: String(mensaje).slice(0, 500) }]);
  } catch (e) { console.error('log_ falló: ' + e); }
  console.log('[' + nivel + '] ' + (expediente || '') + ' ' + mensaje);
}

function leerConfig_() {
  var o = {};
  leerHoja_(ssDatos_(), 'CONFIG').forEach(function (r) { o[String(r.clave).trim()] = r.valor; });
  return o;
}

/** Setup, una sola vez: crea la planilla de datos con las 7 hojas. Luego guardar su id en SHEET_DATOS. */
function crearPlanillaDatos() {
  var ss = SpreadsheetApp.create('Expedientes INGECO - Datos');
  Object.keys(CFG.HOJAS).forEach(function (n) {
    var h = ss.insertSheet(n);
    h.getRange(1, 1, 1, CFG.HOJAS[n].length).setValues([CFG.HOJAS[n]]).setFontWeight('bold');
    h.setFrozenRows(1);
  });
  ss.deleteSheet(ss.getSheets()[0]);
  ss.getSheetByName('CONFIG').getRange(2, 1, 2, 2).setValues([['umbral_dias_quieto', 10], ['mails_alerta', '']]);
  console.log('Creada: ' + ss.getId() + ' → guardar como SHEET_DATOS');
  return ss.getId();
}
```

- [ ] **Step 6: Commit** `"Hojas y diagnóstico del maestro"`.

---

### Task 4: Motor.js — comparar estado previo con respuesta de la API

**Files:**
- Create: `backend/Motor.js`, `tests/motor.test.js`

**Interfaces:**
- Consumes: `parseFecha`, `fmtFecha`, `normOficina`, `diasHabiles` (Parse.js).
- Produces:
  - `interpretarRespuesta(resp) → {ok:true, oficina, oficinaNorm, fechaPase:Date, asunto, fechaInicio:Date|null} | {ok:false, motivo}`
  - `compararEstado(previo|null, lectura, exp, hoy:Date) → {cambio:boolean, movimiento:object|null, estado:object}`
    - `previo` = fila de ESTADO_ACTUAL (`oficina_actual`, `desde` como string dd/mm/yyyy)
    - `estado` = objeto con todas las columnas de ESTADO_ACTUAL salvo las de proyección y alerta (las completa Proyeccion / Alertas).
  - `nuevoId() → string` (uuid simple)

- [ ] **Step 1: Tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const M = require('../backend/Motor.js');
const hoy = new Date(2026, 9, 15);
const exp = { clave: '240034/2026', nombre: 'Obra X', monto: 100, tipo: 'Contratación Directa', prioridad: 'Alta', inicio: null };

test('interpretarRespuesta válida', () => {
  const r = M.interpretarRespuesta({ expediente: { fecha: '2025-10-17T00:00:00.000Z', asunto: 'Limpieza' }, curso: { fecha: '13/02/2026', descripcion: 'Tesorería General ' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.oficina, 'Tesorería General');
  assert.strictEqual(r.oficinaNorm, 'TESORERIA GENERAL');
  assert.strictEqual(r.fechaPase.getMonth(), 1);
  assert.strictEqual(r.fechaInicio.getDate(), 17);
});
test('interpretarRespuesta vacía / sin curso / fecha inválida', () => {
  assert.strictEqual(M.interpretarRespuesta(null).ok, false);
  assert.strictEqual(M.interpretarRespuesta({}).ok, false);
  assert.strictEqual(M.interpretarRespuesta({ expediente: {}, curso: { descripcion: 'X', fecha: 'nunca' } }).ok, false);
  assert.strictEqual(M.interpretarRespuesta({ curso: { descripcion: '', fecha: '01/01/2026' } }).ok, false);
});
test('primer registro genera movimiento con origen bot y sin días previos', () => {
  const lect = { ok: true, oficina: 'Fiscalía', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 12), asunto: 'a', fechaInicio: null };
  const r = M.compararEstado(null, lect, exp, hoy);
  assert.strictEqual(r.cambio, true);
  assert.strictEqual(r.movimiento.origen, 'bot');
  assert.strictEqual(r.movimiento.dias_en_oficina_anterior, '');
  assert.strictEqual(r.estado.oficina_actual, 'Fiscalía');
  assert.strictEqual(r.estado.desde, '12/10/2026');
  assert.strictEqual(r.estado.dias_quieto, 3); // lun 12-oct → jue 15-oct
});
test('misma oficina con distinto formato → sin cambio', () => {
  const previo = { oficina_actual: 'Fiscalia', desde: '12/10/2026', alerta_enviada_en: 'x' };
  const lect = { ok: true, oficina: 'FISCALÍA ', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 12), asunto: 'a' };
  const r = M.compararEstado(previo, lect, exp, hoy);
  assert.strictEqual(r.cambio, false);
  assert.strictEqual(r.movimiento, null);
  assert.strictEqual(r.estado.alerta_enviada_en, 'x');
  assert.strictEqual(r.estado.dias_quieto, 3);
});
test('cambio de oficina genera movimiento con días en la anterior y limpia alerta', () => {
  const previo = { oficina_actual: 'Fiscalía', desde: '01/10/2026', alerta_enviada_en: 'x' };
  const lect = { ok: true, oficina: 'Tesorería', oficinaNorm: 'TESORERIA', fechaPase: new Date(2026, 9, 14), asunto: 'a' };
  const r = M.compararEstado(previo, lect, exp, hoy);
  assert.strictEqual(r.cambio, true);
  assert.strictEqual(r.movimiento.oficina, 'Tesorería');
  assert.strictEqual(r.movimiento.dias_en_oficina_anterior, 9); // 1-oct → 14-oct hábiles
  assert.strictEqual(r.estado.alerta_enviada_en, '');
  assert.strictEqual(r.estado.desde, '14/10/2026');
});
test('misma oficina pero fecha de pase nueva → movimiento (pase interno)', () => {
  const previo = { oficina_actual: 'Fiscalía', desde: '01/10/2026', alerta_enviada_en: '' };
  const lect = { ok: true, oficina: 'Fiscalía', oficinaNorm: 'FISCALIA', fechaPase: new Date(2026, 9, 14), asunto: 'a' };
  const r = M.compararEstado(previo, lect, exp, hoy);
  assert.strictEqual(r.cambio, true);
  assert.strictEqual(r.estado.desde, '14/10/2026');
});
test('nuevoId distinto cada vez', () => assert.notStrictEqual(M.nuevoId(), M.nuevoId()));
```

- [ ] **Step 2: Correr → falla.**

- [ ] **Step 3: backend/Motor.js**

```js
function interpretarRespuesta(resp) {
  if (!resp || typeof resp !== 'object') return { ok: false, motivo: 'respuesta vacía' };
  var curso = resp.curso || {};
  var oficina = String(curso.descripcion || '').trim();
  if (!oficina) return { ok: false, motivo: 'sin oficina (curso.descripcion vacío)' };
  var fechaPase = parseFecha(curso.fecha);
  if (!fechaPase) return { ok: false, motivo: 'fecha de pase inválida: ' + curso.fecha };
  var ex = resp.expediente || {};
  return { ok: true, oficina: oficina, oficinaNorm: normOficina(oficina), fechaPase: fechaPase, asunto: String(ex.asunto || '').trim(), fechaInicio: parseFecha(ex.fecha) };
}

function compararEstado(previo, lectura, exp, hoy) {
  var desdePrev = previo ? parseFecha(previo.desde) : null;
  var mismaOficina = !!previo && normOficina(previo.oficina_actual) === lectura.oficinaNorm;
  var mismaFecha = !!desdePrev && desdePrev.getTime() === lectura.fechaPase.getTime();
  var cambio = !previo || !mismaOficina || !mismaFecha;
  var movimiento = null;
  if (cambio) {
    movimiento = {
      id: nuevoId(), expediente: exp.clave, fecha_pase: fmtFecha(lectura.fechaPase), oficina: lectura.oficina,
      descripcion_api: lectura.asunto, detectado_en: fmtFecha(hoy), origen: 'bot',
      dias_en_oficina_anterior: (previo && desdePrev) ? diasHabiles(desdePrev, lectura.fechaPase) : ''
    };
  }
  var desde = cambio ? lectura.fechaPase : desdePrev;
  var estado = {
    expediente: exp.clave, nombre_obra: exp.nombre, monto: exp.monto, tipo_contrato: exp.tipo, prioridad: exp.prioridad,
    oficina_actual: cambio ? lectura.oficina : previo.oficina_actual,
    desde: fmtFecha(desde), dias_quieto: diasHabiles(desde, hoy),
    alerta_enviada_en: cambio ? '' : (previo.alerta_enviada_en || ''),
    ultima_consulta: fmtFecha(hoy), error: ''
  };
  return { cambio: cambio, movimiento: movimiento, estado: estado };
}

function nuevoId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; normOficina = P_.normOficina; diasHabiles = P_.diasHabiles;
  module.exports = { interpretarRespuesta, compararEstado, nuevoId };
}
```

- [ ] **Step 4: Correr tests → pass. Commit** `"Motor: comparación de estados y movimientos"`.

---

### Task 5: Smt.js — login y consulta a la API del municipio

**Files:**
- Create: `backend/Smt.js`

**Interfaces:**
- Produces:
  - `tokenSmt_() → string` (cacheado 50 min en CacheService; si no hay, loguea)
  - `ultimoCurso_(nro, anio) → {status:number, body:object|null}`; ante 401 borra caché, reloguea y reintenta una vez.
  - `probarSmt()` función manual para el editor: consulta `240034/2026` y loguea la respuesta cruda.

- [ ] **Step 1: Implementar**

```js
var CACHE_TOKEN_ = 'smt_token';

function loginSmt_() {
  var cuil = prop_('SMT_CUIL'), clave = prop_('SMT_CLAVE');
  // Nombres de campos del login: confirmar con probarLoginSmt() la primera vez. El front manda cuil + password.
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
  if ((code === 401 || code === 403) && !reintento) {
    CacheService.getScriptCache().remove(CACHE_TOKEN_);
    return ultimoCurso_(nro, anio, true);
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
```

- [ ] **Step 2: Crear el proyecto Apps Script y probar en vivo**

```bash
cd backend && clasp create --type standalone --title "Expedientes INGECO" --rootDir .
```
Luego en el editor: Script Properties `SMT_CUIL`, `SMT_CLAVE`. `clasp push`, ejecutar `probarSmt` y leer el log. Si el login responde que faltan campos, ajustar los nombres (`cuil`/`password`) a lo que acepte el backend y anotarlo en el spec. Si `Authorization` requiere prefijo `Bearer `, agregarlo.

- [ ] **Step 3: Commit** `"Smt: login y ultimocurso"` (con `.clasp.json` del scriptId).

---

### Task 6: Proyeccion.js — medianas por oficina y días restantes

**Files:**
- Create: `backend/Proyeccion.js`, `tests/proyeccion.test.js`

**Interfaces:**
- Consumes: `normOficina`, `sumarDiasHabiles`, `fmtFecha`.
- Produces:
  - `mediana(nums[]) → number`
  - `medianasPorOficina(movimientos, mapaCanon) → {NOMBRE_CANON: {mediana_dias, casos}}` usando `dias_en_oficina_anterior` del movimiento N asignado a la oficina del movimiento N−1 del mismo expediente. Simplificación: cada movimiento con `dias_en_oficina_anterior` numérico aporta a la oficina del movimiento previo (los movimientos vienen ordenados por expediente y fecha_pase).
  - `canonizar(oficinaTexto, mapaCanon) → string` (`mapaCanon` = {nombre_api_norm: nombre_canonico}; sin mapeo → el normalizado)
  - `proyectar(estado, rutas, oficinasStats, hoy, minCasos) → {etapa, paso_en_ruta, dias_restantes_est, fecha_cobro_est, calidad_estimacion}`
    - `rutas` = filas de RUTAS; `oficinasStats` = salida de medianasPorOficina.

- [ ] **Step 1: Tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const Pr = require('../backend/Proyeccion.js');
const hoy = new Date(2026, 9, 15);
const rutas = [
  { tipo_contrato: 'Contratación Directa', orden: 1, oficina: 'DIRECCION DE OBRAS VIALES', etapa: 'Preliminar', dias_default: 5 },
  { tipo_contrato: 'Contratación Directa', orden: 2, oficina: 'SECRETARIA DE OBRAS', etapa: 'Media', dias_default: 7 },
  { tipo_contrato: 'Contratación Directa', orden: 3, oficina: 'TESORERIA GENERAL', etapa: 'Cobro', dias_default: 3 }
];

test('mediana', () => {
  assert.strictEqual(Pr.mediana([3, 1, 2]), 2);
  assert.strictEqual(Pr.mediana([4, 1, 3, 2]), 2.5);
  assert.strictEqual(Pr.mediana([]), 0);
});
test('medianasPorOficina asigna días a la oficina anterior', () => {
  const movs = [
    { expediente: '1/2026', fecha_pase: '01/09/2026', oficina: 'Obras Viales', dias_en_oficina_anterior: '' },
    { expediente: '1/2026', fecha_pase: '10/09/2026', oficina: 'Secretaría de Obras', dias_en_oficina_anterior: 7 },
    { expediente: '1/2026', fecha_pase: '20/09/2026', oficina: 'Tesorería', dias_en_oficina_anterior: 8 },
    { expediente: '2/2026', fecha_pase: '01/09/2026', oficina: 'Obras Viales', dias_en_oficina_anterior: '' },
    { expediente: '2/2026', fecha_pase: '05/09/2026', oficina: 'Secretaría de Obras', dias_en_oficina_anterior: 3 }
  ];
  const canon = { 'OBRAS VIALES': 'DIRECCION DE OBRAS VIALES', 'SECRETARIA DE OBRAS': 'SECRETARIA DE OBRAS' };
  const r = Pr.medianasPorOficina(movs, canon);
  assert.deepStrictEqual(r['DIRECCION DE OBRAS VIALES'], { mediana_dias: 5, casos: 2 });
  assert.deepStrictEqual(r['SECRETARIA DE OBRAS'], { mediana_dias: 8, casos: 1 });
});
test('proyectar con historia suficiente', () => {
  const stats = { 'SECRETARIA DE OBRAS': { mediana_dias: 10, casos: 6 }, 'TESORERIA GENERAL': { mediana_dias: 4, casos: 6 } };
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Secretaria de Obras', dias_quieto: 3 };
  const r = Pr.proyectar(est, rutas, stats, hoy, 5, {});
  assert.strictEqual(r.etapa, 'Media');
  assert.strictEqual(r.paso_en_ruta, 2);
  assert.strictEqual(r.dias_restantes_est, 7 + 4);
  assert.strictEqual(r.calidad_estimacion, 'buena');
  assert.strictEqual(r.fecha_cobro_est, '30/10/2026');
});
test('proyectar sin casos usa default y marca débil; ya pasó la mediana → 0 en la actual', () => {
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Secretaria de Obras', dias_quieto: 20 };
  const r = Pr.proyectar(est, rutas, {}, hoy, 5, {});
  assert.strictEqual(r.dias_restantes_est, 0 + 3);
  assert.strictEqual(r.calidad_estimacion, 'debil');
});
test('proyectar fuera de ruta', () => {
  const est = { tipo_contrato: 'Contratación Directa', oficina_actual: 'Intendencia', dias_quieto: 1 };
  const r = Pr.proyectar(est, rutas, {}, hoy, 5, {});
  assert.strictEqual(r.etapa, 'Fuera de ruta');
  assert.strictEqual(r.dias_restantes_est, '');
  assert.strictEqual(r.paso_en_ruta, '');
});
test('proyectar tipo sin ruta cae a Contratación Directa y es débil', () => {
  const est = { tipo_contrato: 'Reconocimiento de Servicio', oficina_actual: 'Tesorería General', dias_quieto: 0 };
  const stats = { 'TESORERIA GENERAL': { mediana_dias: 4, casos: 9 } };
  const r = Pr.proyectar(est, rutas, stats, hoy, 5, {});
  assert.strictEqual(r.etapa, 'Cobro');
  assert.strictEqual(r.calidad_estimacion, 'debil');
  assert.strictEqual(r.dias_restantes_est, 4);
});
```

- [ ] **Step 2: Correr → falla.**

- [ ] **Step 3: backend/Proyeccion.js**

```js
function mediana(nums) {
  var a = nums.filter(function (n) { return typeof n === 'number' && !isNaN(n); }).sort(function (x, y) { return x - y; });
  if (!a.length) return 0;
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function canonizar(oficina, mapaCanon) {
  var n = normOficina(oficina);
  return (mapaCanon && mapaCanon[n]) || n;
}

function medianasPorOficina(movimientos, mapaCanon) {
  var porExp = {};
  movimientos.forEach(function (m) { (porExp[m.expediente] = porExp[m.expediente] || []).push(m); });
  var acum = {};
  Object.keys(porExp).forEach(function (k) {
    var lista = porExp[k].slice().sort(function (a, b) { return parseFecha(a.fecha_pase) - parseFecha(b.fecha_pase); });
    for (var i = 1; i < lista.length; i++) {
      var d = Number(lista[i].dias_en_oficina_anterior);
      if (lista[i].dias_en_oficina_anterior === '' || isNaN(d)) continue;
      var of = canonizar(lista[i - 1].oficina, mapaCanon);
      (acum[of] = acum[of] || []).push(d);
    }
  });
  var out = {};
  Object.keys(acum).forEach(function (of) { out[of] = { mediana_dias: mediana(acum[of]), casos: acum[of].length }; });
  return out;
}

var RUTA_FALLBACK_ = 'Contratación Directa';

function proyectar(estado, rutas, stats, hoy, minCasos, mapaCanon) {
  var tipo = String(estado.tipo_contrato || '').trim();
  var ruta = rutas.filter(function (r) { return r.tipo_contrato === tipo; });
  var calidad = 'buena';
  if (!ruta.length) { ruta = rutas.filter(function (r) { return r.tipo_contrato === RUTA_FALLBACK_; }); calidad = 'debil'; }
  ruta = ruta.slice().sort(function (a, b) { return Number(a.orden) - Number(b.orden); });
  var actual = canonizar(estado.oficina_actual, mapaCanon);
  var idx = -1;
  ruta.forEach(function (r, i) { if (idx < 0 && normOficina(r.oficina) === actual) idx = i; });
  if (idx < 0) return { etapa: 'Fuera de ruta', paso_en_ruta: '', dias_restantes_est: '', fecha_cobro_est: '', calidad_estimacion: 'debil' };

  function diasDe(paso) {
    var s = stats[normOficina(paso.oficina)];
    if (s && s.casos >= minCasos) return s.mediana_dias;
    calidad = 'debil';
    return Number(paso.dias_default) || 0;
  }
  var total = Math.max(0, diasDe(ruta[idx]) - Number(estado.dias_quieto || 0));
  for (var i = idx + 1; i < ruta.length; i++) total += diasDe(ruta[i]);
  total = Math.round(total);
  return {
    etapa: ruta[idx].etapa, paso_en_ruta: idx + 1, dias_restantes_est: total,
    fecha_cobro_est: fmtFecha(sumarDiasHabiles(hoy, total)), calidad_estimacion: calidad
  };
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'); normOficina = P_.normOficina; parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; sumarDiasHabiles = P_.sumarDiasHabiles;
  module.exports = { mediana, canonizar, medianasPorOficina, proyectar };
}
```

- [ ] **Step 4: Tests → pass. Commit** `"Proyección: medianas por oficina y días restantes"`.

---

### Task 7: Importar.js — trazabilidad histórica y rutas

**Files:**
- Create: `backend/Importar.js`, `tests/importar.test.js`

**Interfaces:**
- Produces (puro): `trazabilidadAMovimientos(filas:object[], hoy) → {movimientos:[], descartadas:number}`; filas con `Expediente`, `Ultimo Movimiento`, `Oficina`. Dedup por `expediente|fecha|oficinaNorm`. Ordena y calcula `dias_en_oficina_anterior`.
- Produces (puro): `rutaContratosARutas(filasRaw:any[][]) → RUTAS[]` a partir de la hoja "Ruta contratos" (col B oficina, col C comentario; un bloque por tipo encabezado en col B que no tenga comentario y no sea oficina conocida: ver test).
- Produces (glue): `importarTrazabilidad()` y `importarRutas()` para correr una vez desde el editor.

- [ ] **Step 1: Tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const I = require('../backend/Importar.js');

test('trazabilidadAMovimientos dedup, orden y días', () => {
  const filas = [
    { Expediente: '241096/2025', 'Ultimo Movimiento': '28/08/2025', Oficina: 'Fiscalía Municipal' },
    { Expediente: '241096/2025', 'Ultimo Movimiento': '28/08/2025', Oficina: 'Fiscalia Municipal ' },
    { Expediente: '241096/2025', 'Ultimo Movimiento': '15/08/2025', Oficina: 'Dirección de Obras Viales' },
    { Expediente: 's/e', 'Ultimo Movimiento': '01/01/2025', Oficina: 'X' },
    { Expediente: '1/2025', 'Ultimo Movimiento': '', Oficina: 'X' },
    { Expediente: '1/2025', 'Ultimo Movimiento': '01/01/2025', Oficina: '' }
  ];
  const r = I.trazabilidadAMovimientos(filas, new Date(2026, 9, 15));
  assert.strictEqual(r.descartadas, 3);
  assert.strictEqual(r.movimientos.length, 2);
  assert.strictEqual(r.movimientos[0].oficina, 'Dirección de Obras Viales');
  assert.strictEqual(r.movimientos[0].dias_en_oficina_anterior, '');
  assert.strictEqual(r.movimientos[1].dias_en_oficina_anterior, 9);
  assert.strictEqual(r.movimientos[1].origen, 'importado');
  assert.strictEqual(r.movimientos[1].detectado_en, '15/10/2026');
});
test('rutaContratosARutas', () => {
  const raw = [
    ['', '', ''],
    ['', 'Contratacion directa', ''],
    ['', 'Se genera expediente en Obras Viales', ''],
    ['', 'Secretaria de Obras ', 'Para autorizar el tramite'],
    ['', 'Secretaria de Economia y Hacienda ', 'Autoriza el tramite'],
    ['', 'Tesorería General', 'Paga'],
    ['', '', ''],
    ['', 'Reconocimiento de Servicio', ''],
    ['', 'Secretaria de Obras', 'inicio']
  ];
  const r = I.rutaContratosARutas(raw);
  assert.deepStrictEqual(r.map(x => [x.tipo_contrato, x.orden, x.oficina]), [
    ['Contratación Directa', 1, 'DIRECCION DE OBRAS VIALES'],
    ['Contratación Directa', 2, 'SECRETARIA DE OBRAS'],
    ['Contratación Directa', 3, 'SECRETARIA DE ECONOMIA Y HACIENDA'],
    ['Contratación Directa', 4, 'TESORERIA GENERAL'],
    ['Reconocimiento de Servicio', 1, 'SECRETARIA DE OBRAS']
  ]);
  assert.strictEqual(r[3].etapa, 'Cobro');
  assert.strictEqual(r[0].etapa, 'Preliminar');
  assert.strictEqual(r[0].dias_default, 10);
});
```

- [ ] **Step 2: Correr → falla.**

- [ ] **Step 3: backend/Importar.js**

```js
function trazabilidadAMovimientos(filas, hoy) {
  var vistos = {}, porExp = {}, descartadas = 0;
  filas.forEach(function (f) {
    var e = parseExpediente(String(f['Expediente'] || ''));
    var fecha = parseFecha(f['Ultimo Movimiento']);
    var oficina = String(f['Oficina'] || '').trim();
    if (!e || !fecha || !oficina) { descartadas++; return; }
    var k = e.clave + '|' + fmtFecha(fecha) + '|' + normOficina(oficina);
    if (vistos[k]) { descartadas++; return; }
    vistos[k] = true;
    (porExp[e.clave] = porExp[e.clave] || []).push({ clave: e.clave, fecha: fecha, oficina: oficina });
  });
  var movimientos = [];
  Object.keys(porExp).sort().forEach(function (clave) {
    var lista = porExp[clave].sort(function (a, b) { return a.fecha - b.fecha; });
    lista.forEach(function (m, i) {
      movimientos.push({
        id: nuevoId(), expediente: clave, fecha_pase: fmtFecha(m.fecha), oficina: m.oficina, descripcion_api: '',
        detectado_en: fmtFecha(hoy), origen: 'importado',
        dias_en_oficina_anterior: i === 0 ? '' : diasHabiles(lista[i - 1].fecha, m.fecha)
      });
    });
  });
  return { movimientos: movimientos, descartadas: descartadas };
}

var TIPOS_CANON_ = { 'CONTRATACION DIRECTA': 'Contratación Directa', 'RECONOCIMIENTO DE SERVICIO': 'Reconocimiento de Servicio', 'LICITACION': 'Licitación' };

function rutaContratosARutas(raw) {
  var out = [], tipo = null, orden = 0;
  raw.forEach(function (fila) {
    var b = String(fila[1] || '').trim(), c = String(fila[2] || '').trim();
    if (!b) return;
    var bn = normOficina(b);
    if (TIPOS_CANON_[bn]) { tipo = TIPOS_CANON_[bn]; orden = 0; return; }
    if (!tipo) return;
    var m = bn.match(/^SE GENERA EXPEDIENTE EN (.+)$/);
    var oficina = m ? m[1] : bn;
    if (oficina === 'OBRAS VIALES') oficina = 'DIRECCION DE OBRAS VIALES';
    orden++;
    out.push({ tipo_contrato: tipo, orden: orden, oficina: oficina, etapa: '', dias_default: 10 });
  });
  // Etapas: primer tercio Preliminar, segundo Media, resto Final; TESORERIA = Cobro.
  var porTipo = {};
  out.forEach(function (r) { (porTipo[r.tipo_contrato] = porTipo[r.tipo_contrato] || []).push(r); });
  Object.keys(porTipo).forEach(function (t) {
    var n = porTipo[t].length;
    porTipo[t].forEach(function (r, i) {
      if (/TESORERIA/.test(r.oficina)) r.etapa = 'Cobro';
      else r.etapa = i < n / 3 ? 'Preliminar' : (i < 2 * n / 3 ? 'Media' : 'Final');
    });
  });
  return out;
}

/** Correr UNA vez desde el editor. */
function importarTrazabilidad() {
  var filas = leerHoja_(ssMaestro_(), CFG.HOJA_TRAZABILIDAD);
  var r = trazabilidadAMovimientos(filas, new Date());
  agregarFilas_(ssDatos_(), 'MOVIMIENTOS', r.movimientos);
  log_('INFO', '', 'Importadas ' + r.movimientos.length + ' filas de trazabilidad, descartadas ' + r.descartadas);
}
function importarRutas() {
  var raw = leerHojaRaw_(ssMaestro_(), CFG.HOJA_RUTA_ORIGEN).filas;
  reemplazarHoja_(ssDatos_(), 'RUTAS', rutaContratosARutas(raw));
}

if (typeof module !== 'undefined') {
  var P_ = require('./Parse.js'), M_ = require('./Motor.js');
  parseExpediente = P_.parseExpediente; parseFecha = P_.parseFecha; fmtFecha = P_.fmtFecha; normOficina = P_.normOficina; diasHabiles = P_.diasHabiles; nuevoId = M_.nuevoId;
  module.exports = { trazabilidadAMovimientos, rutaContratosARutas };
}
```

- [ ] **Step 4: Tests → pass. Commit** `"Importar: trazabilidad histórica y rutas"`.

---

### Task 8: Corrida.js — orquestación del bot

**Files:**
- Create: `backend/Corrida.js`, `backend/Triggers.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `correr()` (entrada del trigger), `esHorarioHabil_(date) → boolean`, `instalarTrigger()`.

- [ ] **Step 1: Implementar Corrida.js**

```js
function correr(forzado) {
  var hoy = new Date();
  if (!forzado && !esHorarioHabil_(hoy)) return;
  CORRIDA_ID_ = null;
  var ssD = ssDatos_(), ssM = ssMaestro_();

  // 1. Maestro con diagnóstico
  var raw = leerHojaRaw_(ssM, CFG.HOJA_MAESTRO);
  var diag = diagnosticarEncabezados(raw.encabezados, CFG.COLS_MAESTRO_OBLIGATORIAS);
  if (!diag.ok) { log_('ERROR', '', 'La planilla OBRAS INGECO cambió: falta la columna ' + diag.faltan.join(', ')); return; }
  var maestro = maestroAExpedientes(filasAObjetos(raw.filas), CFG.COLS_MAESTRO);
  maestro.sinExpediente.forEach(function (s) { log_('AVISO', '', 'Sin expediente válido: "' + s.nombre + '" (' + s.texto + ', fila ' + s.fila + ')'); });

  // 2. Estado previo
  var previos = {};
  leerHoja_(ssD, 'ESTADO_ACTUAL').forEach(function (e) { previos[e.expediente] = e; });

  // 3. Consultar
  var movimientos = [], estados = [], errores = 0;
  try { tokenSmt_(); } catch (e) { log_('ERROR', '', 'No se pudo entrar al portal del municipio: ' + e.message); marcarFallo_(); return; }

  maestro.activos.forEach(function (exp) {
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
      errores++; log_('ERROR', exp.clave, e.message);
      estado = prev ? Object.assign({}, prev, { error: e.message }) : estadoVacio_(exp, hoy, e.message);
    }
    estados.push(estado);
  });
  if (errores > 0 && errores === maestro.activos.length) { log_('ERROR', '', 'Fallaron todas las consultas, no se guarda nada'); marcarFallo_(); return; }

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
  guardarOficinas_(ssD, stats, mapaCanon);

  // 5. Alertas
  evaluarAlertas_(estados, cfg, ssD);
  PropertiesService.getScriptProperties().setProperty('FALLOS_SEGUIDOS', '0');
  log_('INFO', '', 'Corrida ok: ' + maestro.activos.length + ' consultados, ' + movimientos.length + ' movimientos, ' + errores + ' errores');
}

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

function guardarOficinas_(ssD, stats, mapaCanon) {
  var filas = leerHoja_(ssD, 'OFICINAS'), porApi = {};
  filas.forEach(function (o) { porApi[normOficina(o.nombre_api)] = o; });
  Object.keys(stats).forEach(function (canon) {
    var fila = porApi[canon] || (porApi[canon] = { nombre_api: canon, nombre_canonico: canon });
    fila.mediana_dias = stats[canon].mediana_dias; fila.casos = stats[canon].casos;
  });
  reemplazarHoja_(ssD, 'OFICINAS', Object.keys(porApi).map(function (k) { return porApi[k]; }));
}

function marcarFallo_() {
  var p = PropertiesService.getScriptProperties();
  var n = Number(p.getProperty('FALLOS_SEGUIDOS') || 0) + 1;
  p.setProperty('FALLOS_SEGUIDOS', String(n));
  if (n === 3) MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Expedientes INGECO: el bot falló 3 veces seguidas', 'Revisá la hoja LOG de "Expedientes INGECO - Datos". Puede ser la clave del portal o que la API cambió.');
}
```

- [ ] **Step 2: Triggers.js**

```js
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
```

- [ ] **Step 3: Prueba en vivo**: `clasp push`, correr `crearPlanillaDatos` → anotar id en `SHEET_DATOS`; `SHEET_MAESTRO` = `1Hl8HZqrH6lMwnAGpitA37ZGLg4szTcFGK7vmv92qkBA`; correr `importarRutas`, `importarTrazabilidad`, después `correr(true)` desde una función `correrAhora() { correr(true); }`. Verificar ESTADO_ACTUAL, MOVIMIENTOS, LOG y que el maestro tenga Oficina/Ultimo Movimiento actualizados.

- [ ] **Step 4: Commit** `"Corrida del bot y trigger horario"`.

---

### Task 9: Alertas.js — mail + notificación app-ingeco

**Files:**
- Create: `backend/Alertas.js`, `tests/alertas.test.js`

**Interfaces:**
- Produces (puro): `seleccionarAlertas(estados, umbral) → estados[]` (dias_quieto > umbral y `alerta_enviada_en` vacío).
- Produces (glue): `evaluarAlertas_(estados, cfg, ssD)`: manda un mail con todas las alertas de la corrida a `cfg.mails_alerta` (separados por coma, si hay) y una notificación `notificar` por app-ingeco; marca `alerta_enviada_en` en cada estado y reescribe ESTADO_ACTUAL.

- [ ] **Step 1: Test**

```js
const test = require('node:test');
const assert = require('node:assert');
const A = require('../backend/Alertas.js');
test('seleccionarAlertas', () => {
  const r = A.seleccionarAlertas([
    { expediente: '1', dias_quieto: 11, alerta_enviada_en: '' },
    { expediente: '2', dias_quieto: 10, alerta_enviada_en: '' },
    { expediente: '3', dias_quieto: 30, alerta_enviada_en: '01/10/2026' },
    { expediente: '4', dias_quieto: '', alerta_enviada_en: '' }
  ], 10);
  assert.deepStrictEqual(r.map(x => x.expediente), ['1']);
});
```

- [ ] **Step 2: Implementar**

```js
function seleccionarAlertas(estados, umbral) {
  return estados.filter(function (e) { return Number(e.dias_quieto) > umbral && !e.alerta_enviada_en && e.dias_quieto !== ''; });
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
      payload: JSON.stringify({ accion: 'notificar', clave_sistema: clave, modulo: CFG.MODULO, destinatarios: [{ modulo: CFG.MODULO }], tipo: 'aviso_general', titulo: titulo, cuerpo: cuerpo, url_destino: 'https://marcoskatz-cmd.github.io/expedientes-ingeco/', prioridad: 'normal' })
    });
  } catch (e) { log_('ERROR', '', 'notificar app-ingeco falló: ' + e.message); }
}

if (typeof module !== 'undefined') module.exports = { seleccionarAlertas };
```

Nota: confirmar en `app-ingeco/docs/integracion-modulos.md` si `{modulo: ...}` es un destinatario válido; si no, usar `{admin: true}` hasta tener la lista de legajos.

- [ ] **Step 3: Tests → pass. Commit** `"Alertas por mail y app-ingeco"`.

---

### Task 10: WebApp.js — API JSON para la PWA

**Files:**
- Create: `backend/WebApp.js`

**Interfaces:**
- Produces `doPost(e)` con acciones `estado`, `ficha`, `estadisticas`, `gestion`, `forzar_corrida`. Respuesta siempre `{ok, ...}` JSON, `Content-Type` de entrada `text/plain`.

- [ ] **Step 1: Implementar**

```js
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() { return json_({ ok: true, sistema: 'Expedientes INGECO' }); }

function doPost(e) {
  var req;
  try { req = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Pedido inválido' }); }
  var accion = String(req.accion || ''), p = req.payload || {};
  try {
    if (accion === 'estado') return json_(accionEstado_());
    if (accion === 'ficha') return json_(accionFicha_(p.expediente));
    if (accion === 'estadisticas') return json_(accionEstadisticas_());
    if (accion === 'gestion') return json_(accionGestion_(p));
    if (accion === 'forzar_corrida') { var u = usuarioDeSesion_(p.sesion); if (!u || !u.es_admin) return json_({ ok: false, error: 'Solo administradores' }); correr(true); return json_({ ok: true }); }
    return json_({ ok: false, error: 'Acción desconocida: ' + accion });
  } catch (err) {
    console.error(accion + ': ' + err + '\n' + (err.stack || ''));
    return json_({ ok: false, error: 'Algo falló del lado del servidor. Si sigue pasando, avisale a Marcos.', detalle: String(err.message || err) });
  }
}

function accionEstado_() {
  var ssD = ssDatos_();
  var estados = leerHoja_(ssD, 'ESTADO_ACTUAL');
  var log = leerHoja_(ssD, 'LOG');
  var ultimaCorrida = log.length ? log[log.length - 1].corrida : '';
  var avisos = log.filter(function (l) { return l.corrida === ultimaCorrida && (l.nivel === 'ERROR' || l.nivel === 'AVISO'); }).map(function (l) { return { nivel: l.nivel, expediente: l.expediente, mensaje: l.mensaje }; });
  var cfg = leerConfig_();
  return { ok: true, estados: estados, avisos: avisos, umbral: Number(cfg.umbral_dias_quieto) || CFG.UMBRAL_DEFAULT, ultima_corrida: ultimaCorrida };
}

function accionFicha_(expediente) {
  var ssD = ssDatos_();
  var est = leerHoja_(ssD, 'ESTADO_ACTUAL').filter(function (e) { return e.expediente === expediente; })[0];
  if (!est) return { ok: false, error: 'No encontré el expediente ' + expediente };
  var movs = leerHoja_(ssD, 'MOVIMIENTOS').filter(function (m) { return m.expediente === expediente; });
  var gest = leerHoja_(ssD, 'GESTIONES').filter(function (g) { return g.expediente === expediente; });
  return { ok: true, estado: est, movimientos: movs, gestiones: gest };
}

function accionEstadisticas_() {
  var ssD = ssDatos_();
  var oficinas = leerHoja_(ssD, 'OFICINAS');
  var movs = leerHoja_(ssD, 'MOVIMIENTOS');
  // Tiempo total inicio → Tesorería por expediente que llegó a Tesorería
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
  return { ok: true, oficinas: oficinas, total: { casos: totales.length, mediana: mediana(totales), p25: q(0.25), p75: q(0.75) } };
}

function accionGestion_(p) {
  var u = usuarioDeSesion_(p.sesion);
  if (!u) return { ok: false, error: 'Abrí este sistema desde la app INGECO para cargar gestiones' };
  var tipos = ['llamé', 'fui', 'nota'];
  if (tipos.indexOf(p.tipo) < 0) return { ok: false, error: 'Tipo de gestión inválido' };
  if (!p.expediente || !String(p.texto || '').trim()) return { ok: false, error: 'Falta el texto de la gestión' };
  agregarFilas_(ssDatos_(), 'GESTIONES', [{ id: nuevoId(), expediente: p.expediente, fecha: fmtFecha(new Date()), tipo: p.tipo, texto: String(p.texto).trim().slice(0, 500), legajo: u.legajo, nombre: u.nombre_visible }]);
  return { ok: true };
}

// Verifica la sesión de módulo contra el backend común de app-ingeco (cache 5 min).
function usuarioDeSesion_(sesion) {
  if (!sesion) return null;
  var cache = CacheService.getScriptCache(), k = 'ses_' + sesion.slice(0, 40);
  var c = cache.get(k); if (c) return JSON.parse(c);
  var r = UrlFetchApp.fetch(CFG.APP_INGECO_BACKEND, { method: 'post', contentType: 'text/plain', muteHttpExceptions: true, payload: JSON.stringify({ accion: 'validar_sesion_modulo', payload: { sesion: sesion, modulo: CFG.MODULO } }) });
  var b; try { b = JSON.parse(r.getContentText()); } catch (e) { return null; }
  if (!b || !b.ok) return null;
  cache.put(k, JSON.stringify(b), 300);
  return b;
}
```

- [ ] **Step 2: Deploy y prueba por HTTP**

```bash
cd backend && clasp push && clasp deploy --description "v1"
```
Anotar el deploymentId. Probar:
```bash
curl -s -L -X POST "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" -H "Content-Type: text/plain" -d '{"accion":"estado"}'
```
Expected: `{"ok":true,"estados":[...]}`.

- [ ] **Step 3: Commit** `"WebApp: API JSON"`.

---

### Task 11: Web — PWA (tablero, lista, ficha, estadísticas, ayuda)

**Files:**
- Create: `web/index.html`, `web/app.js`, `web/estilos.css`, `web/manifest.webmanifest`, `web/sw.js`, `web/ayuda.html`

**Interfaces:**
- Consumes la API de Task 10. `API_URL` constante en `app.js`.
- guard.js con `data-modulo="EXPEDIENTES"`.

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expedientes INGECO</title>
<link rel="manifest" href="manifest.webmanifest">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="estilos.css">
<script src="https://marcoskatz-cmd.github.io/app-ingeco/guard.js" data-modulo="EXPEDIENTES"></script>
</head>
<body>
<header><h1>Expedientes a cobrar</h1><span id="corrida"></span></header>
<div id="avisos"></div>
<main id="vista"></main>
<nav class="barra">
  <button data-v="tablero" class="activo">Tablero</button>
  <button data-v="lista">Lista</button>
  <button data-v="stats">Estadísticas</button>
  <a href="ayuda.html">Ayuda</a>
</nav>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: app.js** (sin framework; render por vista; auto-refresh 5 min; ficha como panel sobre la lista)

```js
const API_URL = 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec';
const $ = s => document.querySelector(s);
let DATA = null, VISTA = 'tablero';

async function api(accion, payload) {
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion, payload: payload || {} }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Falló la consulta');
  return j;
}
const pesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const semaforo = (e, umbral) => e.error ? 'gris' : (Number(e.dias_quieto) > umbral ? 'ambar' : 'teal');

function sinAcceso() {
  $('#vista').innerHTML = '<p class="vacio">Abrí este sistema desde la app INGECO.</p>';
}

async function cargar() {
  try {
    DATA = await api('estado');
    $('#corrida').textContent = DATA.ultima_corrida ? 'Última consulta ' + DATA.ultima_corrida.replace('-', ' ') : '';
    $('#avisos').innerHTML = DATA.avisos.filter(a => a.nivel === 'ERROR').map(a => `<div class="aviso">${a.mensaje}</div>`).join('');
    render();
  } catch (e) { $('#vista').innerHTML = `<p class="vacio">No pude traer los datos: ${e.message}. Probá de nuevo en un rato.</p>`; }
}

function render() {
  if (!DATA) return;
  if (VISTA === 'tablero') renderTablero();
  else if (VISTA === 'lista') renderLista();
  else renderStats();
}

function renderTablero() {
  const act = DATA.estados.filter(e => e.oficina_actual);
  const porEtapa = {}, porOficina = {};
  act.forEach(e => { porEtapa[e.etapa] = (porEtapa[e.etapa] || 0) + Number(e.monto); porOficina[e.oficina_actual] = (porOficina[e.oficina_actual] || 0) + Number(e.monto); });
  const quietos = act.filter(e => Number(e.dias_quieto) > DATA.umbral);
  const total = act.reduce((s, e) => s + Number(e.monto), 0);
  const prox = act.filter(e => e.dias_restantes_est !== '' && Number(e.dias_restantes_est) <= 22).reduce((s, e) => s + Number(e.monto), 0);
  $('#vista').innerHTML = `
    <section class="tiles">
      <div class="tile"><small>A cobrar</small><b>${pesos(total)}</b><span>${act.length} expedientes</span></div>
      <div class="tile ${quietos.length ? 'ambar' : ''}"><small>Quietos +${DATA.umbral} días</small><b>${quietos.length}</b><span>${pesos(quietos.reduce((s, e) => s + Number(e.monto), 0))}</span></div>
      <div class="tile teal"><small>Cobro estimado 30 días</small><b>${pesos(prox)}</b></div>
    </section>
    <h2>Por etapa</h2>${barras(porEtapa, total)}
    <h2>Por oficina</h2>${barras(porOficina, total)}`;
}
function barras(obj, total) {
  return '<div class="barras">' + Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="fila"><span>${k || 'Sin dato'}</span><div class="barra"><i style="width:${total ? v / total * 100 : 0}%"></i></div><b>${pesos(v)}</b></div>`).join('') + '</div>';
}

function renderLista() {
  const q = (window.__q || '').toLowerCase();
  const lista = DATA.estados.filter(e => !q || (e.nombre_obra + e.expediente + e.oficina_actual).toLowerCase().includes(q))
    .sort((a, b) => Number(b.dias_quieto || 0) - Number(a.dias_quieto || 0));
  $('#vista').innerHTML = `<input id="buscar" placeholder="Buscar obra, expediente u oficina" value="${window.__q || ''}">
    <ul class="lista">${lista.map(e => `<li class="${semaforo(e, DATA.umbral)}" data-exp="${e.expediente}">
      <b>${e.nombre_obra}</b><span>${e.expediente} · ${pesos(e.monto)}</span>
      <span>${e.oficina_actual || 'Sin dato: ' + (e.error || '')} · ${e.dias_quieto !== '' ? e.dias_quieto + ' días' : ''}</span>
      <span>${e.dias_restantes_est !== '' ? 'Faltan ~' + e.dias_restantes_est + ' días hábiles (' + e.fecha_cobro_est + ')' + (e.calidad_estimacion === 'debil' ? ' · estimación débil' : '') : e.etapa || ''}</span>
    </li>`).join('')}</ul>`;
  $('#buscar').oninput = ev => { window.__q = ev.target.value; renderLista(); $('#buscar').focus(); $('#buscar').setSelectionRange(99, 99); };
  document.querySelectorAll('.lista li').forEach(li => li.onclick = () => ficha(li.dataset.exp));
}

async function ficha(exp) {
  const f = await api('ficha', { expediente: exp });
  const e = f.estado, u = window.INGECO_USUARIO;
  $('#vista').innerHTML = `<button class="volver" id="volver">← Volver</button>
    <h2>${e.nombre_obra}</h2><p>${e.expediente} · ${pesos(e.monto)} · ${e.tipo_contrato}</p>
    <p class="${semaforo(e, DATA.umbral)}">En <b>${e.oficina_actual}</b> desde ${e.desde} (${e.dias_quieto} días hábiles)</p>
    <p>${e.dias_restantes_est !== '' ? 'Cobro estimado: ' + e.fecha_cobro_est + ' (~' + e.dias_restantes_est + ' días hábiles' + (e.calidad_estimacion === 'debil' ? ', estimación débil' : '') + ')' : 'Sin proyección: ' + e.etapa}</p>
    <h3>Recorrido</h3><ol class="tiempo">${f.movimientos.map(m => `<li class="${m.origen}"><b>${m.fecha_pase}</b> ${m.oficina}${m.dias_en_oficina_anterior !== '' ? ' <small>(' + m.dias_en_oficina_anterior + ' días en la anterior)</small>' : ''}</li>`).join('')}</ol>
    <h3>Gestiones</h3><ul class="gest">${f.gestiones.map(g => `<li><b>${g.fecha}</b> ${g.tipo} — ${g.texto} <small>${g.nombre}</small></li>`).join('') || '<li>Ninguna todavía</li>'}</ul>
    ${u ? `<form id="fgest"><select name="tipo"><option value="llamé">Llamé</option><option value="fui">Fui</option><option value="nota">Nota</option></select>
      <input name="texto" placeholder="Qué pasó" required maxlength="500"><button>Agregar gestión</button></form><p id="okgest"></p>` : '<p class="vacio">Para cargar gestiones abrí desde la app INGECO.</p>'}`;
  $('#volver').onclick = () => renderLista();
  const form = $('#fgest');
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    form.querySelector('button').disabled = true;
    try { await api('gestion', { expediente: exp, tipo: form.tipo.value, texto: form.texto.value, sesion: window.INGECO_SESION }); $('#okgest').textContent = 'Gestión guardada'; ficha(exp); }
    catch (e) { $('#okgest').textContent = e.message; form.querySelector('button').disabled = false; }
  };
}

async function renderStats() {
  const s = await api('estadisticas');
  const ofs = s.oficinas.filter(o => o.casos).sort((a, b) => b.mediana_dias - a.mediana_dias);
  const max = Math.max(1, ...ofs.map(o => Number(o.mediana_dias)));
  $('#vista').innerHTML = `<section class="tiles"><div class="tile"><small>Inicio → Tesorería (mediana)</small><b>${s.total.mediana} días</b><span>${s.total.casos} casos · p25 ${s.total.p25} · p75 ${s.total.p75}</span></div></section>
    <h2>Días por oficina (mediana)</h2><div class="barras">${ofs.map(o => `<div class="fila"><span>${o.nombre_canonico}</span><div class="barra"><i style="width:${o.mediana_dias / max * 100}%"></i></div><b>${o.mediana_dias} d · ${o.casos} casos</b></div>`).join('')}</div>`;
}

document.querySelectorAll('.barra button').forEach(b => b.onclick = () => { VISTA = b.dataset.v; document.querySelectorAll('.barra button').forEach(x => x.classList.toggle('activo', x === b)); render(); });

if (!window.INGECO_USUARIO) sinAcceso(); else { cargar(); setInterval(cargar, 5 * 60 * 1000); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 3: estilos.css** (Barlow, mobile-first, barra inferior fija, clases `.teal` `#0f766e`, `.ambar` `#b45309`, `.gris` `#6b7280`, `.tiempo li.importado` con borde punteado, `.aviso` fondo ámbar claro). Mínimo 60 líneas; sin rojo ni verde.

- [ ] **Step 4: manifest.webmanifest, sw.js (network-only, sin caché HTTP, igual que app-ingeco), ayuda.html** con: qué es cada pantalla, qué significa cada color, cómo se calcula la proyección ("mediana histórica de días por oficina; con menos de 5 casos se usa un valor por defecto y se marca 'estimación débil'"), qué hacer si aparece el cartel de la planilla.

- [ ] **Step 5: Probar local** con `preview_start` sobre `web/` (servidor estático `python -m http.server 8080` en launch.json). Sin ticket debe mostrar "Abrí este sistema desde la app INGECO". Para probar con datos durante desarrollo, cargar la página con `?dev=1` y en app.js permitir `if (!window.INGECO_USUARIO && !location.search.includes('dev=1')) sinAcceso();` — quitar `dev=1` antes de publicar.

- [ ] **Step 6: Publicar**

```bash
git add web && git commit -m "Web: PWA de expedientes" && git subtree push --prefix web origin gh-pages
```
Crear el repo privado antes: `gh repo create marcoskatz-cmd/expedientes-ingeco --private --source=. --push`. Activar Pages desde rama `gh-pages`.

---

### Task 12: Alta en app-ingeco, trigger y cierre

**Files:**
- Modify: memoria `expedientes-ingeco.md`; `README.md` del repo.

- [ ] **Step 1:** En app-ingeco → Admin → Módulos: código `EXPEDIENTES`, URL `https://marcoskatz-cmd.github.io/expedientes-ingeco/`, embebido, ícono 📂, responsable Marcos. Asignar a Marcos en Personas. Pedir/crear `CLAVE_EXPEDIENTES` en el backend común y guardarla en Script Properties del bot.
- [ ] **Step 2:** Correr `instalarTrigger()` desde el editor. Verificar al día siguiente que LOG tenga corridas 9–17.
- [ ] **Step 3:** README con: qué hace, Script Properties necesarias, funciones de setup (`crearPlanillaDatos`, `importarRutas`, `importarTrazabilidad`, `instalarTrigger`, `probarSmt`), deploy (clasp + subtree), y cómo mapear una oficina nueva (hoja OFICINAS, columna nombre_canonico).
- [ ] **Step 4:** Actualizar memoria con scriptId, deploymentId, id de la planilla de datos, estado "en producción".
- [ ] **Step 5:** Commit y push.
