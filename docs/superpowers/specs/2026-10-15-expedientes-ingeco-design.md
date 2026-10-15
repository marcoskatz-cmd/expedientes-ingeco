# Expedientes INGECO — seguimiento de expedientes a cobrar (Municipio SMT)

Fecha: 2026-10-15. Estado: aprobado por Marcos (diseño conversacional 15-oct-2026).

## 1. Objetivo

Saber en todo momento en qué oficina está cada expediente de cobro de INGECO en la
Municipalidad de San Miguel de Tucumán, construir su trazabilidad (historial de pases
entre oficinas) y, a partir de esa historia, proyectar cuántos días le faltan a cada
expediente para llegar a Tesorería y cobrarse.

El municipio **no expone el historial**: su API devuelve solo el último movimiento. La
trazabilidad se construye consultando varias veces por día y registrando cada cambio.

## 2. Fuente externa: API del municipio (verificado 15-oct-2026)

Portal: `https://ciudaddigital.smt.gob.ar` (solo login) → módulo Expedientes en
`https://back.smt.gob.ar`. Ambos pegan a la misma API:

```
BASE = https://estadisticas.smt.gob.ar:5000

POST /usuarios/login
  body JSON: { cuil, password }            (nombres de campos a confirmar en el primer login real)
  → { token, ... }                         el front lo guarda en localStorage "token"
                                           y lo manda como header Authorization: <token>

POST /expedientes/ultimocurso
  header Authorization: <token>
  body JSON: { anioexpediente: "2026", nroexpediente: "240034P" }
  → { expediente: { fecha, asunto }, curso: { fecha, descripcion } }
```

- El número va **con sufijo "P"** y el año separado. La columna `Expediente` del maestro
  ("240034/2026") se parsea como `nro/anio`.
- `curso.descripcion` es la oficina/repartición actual; `curso.fecha` la fecha del pase.
- Si el expediente no existe la respuesta es vacía o no-200: se registra en LOG.
- Credenciales: CUIL y clave de Marcos en **Script Properties** (`SMT_CUIL`, `SMT_CLAVE`).
  Marcos cambia la clave actual (quedó escrita en un chat). Nunca van al repo.

## 3. Fuentes internas

### 3.1 Maestro: planilla "OBRAS INGECO" (id `1Hl8HZqrH6lMwnAGpitA37ZGLg4szTcFGK7vmv92qkBA`), hoja `OBRAS DE MUNICIPIO`

Sigue siendo la fuente de verdad de qué obras/expedientes existen. Columnas que lee el bot
(por nombre de encabezado, no por posición):

| Columna | Uso |
|---|---|
| Nombre Obra | nombre a mostrar |
| Expediente | `nro/anio`; vacío o "s/e" → sin expediente, se lista aparte y no se consulta |
| Estado $ | solo se consultan los que NO son "Cobrada"/"Cobrado" |
| Monto | $ a cobrar |
| Tipo de contrato | elige la ruta esperada |
| Prioridad de seguimiento | filtro en la app (si la columna no existe, se asume "Normal") |
| Observaciones | se muestra en la ficha |
| Inicio de Expediente | fecha de inicio (si está vacía se usa `expediente.fecha` de la API) |

El bot **escribe** de vuelta en esta hoja las columnas `Oficina` y `Ultimo Movimiento`
cuando detecta un cambio, para que la planilla se mantenga sola. No toca ninguna otra celda.

Auto-diagnóstico (regla 7 de los sistemas INGECO): si falta un encabezado obligatorio
(Nombre Obra, Expediente, Estado $, Monto, Tipo de contrato) el bot no corre, escribe el
error en LOG y la app muestra un cartel "La planilla OBRAS INGECO cambió: falta la columna X".

### 3.2 Hoja `trazabilidad` (828 filas): importación inicial, una sola vez

Cada fila es una copia de la fila principal en algún momento. Se convierte en movimientos:
`(Expediente, Ultimo Movimiento, Oficina)` deduplicado. Origen = `importado`. Sin fecha o sin
oficina → se descarta y se cuenta en LOG.

### 3.3 Hoja `Ruta contratos`: rutas esperadas

Se copia a la hoja RUTAS de la planilla nueva (editable desde ahí en adelante).

## 4. Planilla nueva: "Expedientes INGECO - Datos"

| Hoja | Columnas |
|---|---|
| MOVIMIENTOS | id (uuid), expediente, fecha_pase, oficina, descripcion_api, detectado_en, origen (`bot`/`importado`/`manual`), dias_en_oficina_anterior |
| ESTADO_ACTUAL | expediente, nombre_obra, monto, tipo_contrato, prioridad, oficina_actual, desde, dias_quieto, etapa (`Preliminar`/`Media`/`Final`/`Cobro`), paso_en_ruta, dias_restantes_est, fecha_cobro_est, calidad_estimacion (`buena`/`debil`), alerta_enviada_en, ultima_consulta, error |
| RUTAS | tipo_contrato, orden, oficina, etapa, dias_default |
| OFICINAS | nombre_api, nombre_canonico, mediana_dias, casos (recalculado por el bot) |
| GESTIONES | id, expediente, fecha, tipo (`llamé`/`fui`/`nota`), texto, legajo, nombre |
| CONFIG | clave, valor (umbral_dias_quieto=10, mails_alerta, etc.) |
| LOG | fecha, corrida, nivel, expediente, mensaje |

Las oficinas de la API pueden venir con variantes de texto; OFICINAS mapea `nombre_api` →
`nombre_canonico` y el bot avisa en LOG cuando aparece una oficina nueva no mapeada (la app la
muestra para que Marcos la asigne a la ruta).

## 5. Bot (Apps Script, repo `backend/`)

- Trigger por hora, **9 a 17 h, lunes a viernes** (`instalarTrigger()`). Fuera de ese horario no corre.
- Corrida: login (1 vez, token cacheado en CacheService 50 min) → leer maestro → por cada
  expediente activo `ultimocurso` → comparar con ESTADO_ACTUAL:
  - si cambió `oficina` o `fecha_pase` → nueva fila en MOVIMIENTOS (con `dias_en_oficina_anterior`),
    actualizar ESTADO_ACTUAL y escribir Oficina/Ultimo Movimiento en el maestro;
  - si no cambió → solo `ultima_consulta` y `dias_quieto`.
- Después de la pasada: recalcular OFICINAS (mediana de días por oficina sobre MOVIMIENTOS
  con `dias_en_oficina_anterior`), recalcular proyección (sección 7) y evaluar alertas.
- Errores de login o de red: se registra en LOG, no se toca nada más, se reintenta en la
  próxima hora. Tres corridas seguidas fallidas → mail a Marcos.
- Límite: ~160 consultas por corrida, bien dentro de las cuotas de UrlFetchApp.

### Alertas

Expediente con `dias_quieto` > `umbral_dias_quieto` (días hábiles, default 10) y sin
`alerta_enviada_en` para este tramo → mail a los destinatarios de CONFIG (a completar) +
notificación por `notificar` al backend común de app-ingeco (módulo `EXPEDIENTES`,
destinatarios: las personas con el módulo asignado). Se marca `alerta_enviada_en`; se limpia
cuando el expediente se mueve.

### API JSON (`doPost`, ContentService)

| accion | payload | devuelve |
|---|---|---|
| `estado` | — | ESTADO_ACTUAL completo + resumen (totales por etapa/oficina) + avisos de diagnóstico |
| `ficha` | expediente | fila de ESTADO_ACTUAL + MOVIMIENTOS + GESTIONES del expediente |
| `estadisticas` | — | OFICINAS, tiempo total inicio→Tesorería (mediana, p25, p75), ranking |
| `gestion` | expediente, tipo, texto, sesion | agrega fila en GESTIONES (verifica `sesion` con `validar_sesion_modulo`) |
| `forzar_corrida` | sesion (admin) | ejecuta una pasada ahora |

Todo con `Content-Type: text/plain` y respuesta JSON, patrón Demarcación Vial / Autovías.

## 6. App (PWA estática, GitHub Pages, repo `web/` → `marcoskatz-cmd.github.io/expedientes-ingeco`)

- `<script src=".../app-ingeco/guard.js" data-modulo="EXPEDIENTES">` en el head. Sin PIN
  propio. Si no viene de la app (`INGECO_USUARIO` null) muestra "Abrí este sistema desde la
  app INGECO" y no carga datos.
- Módulo `EXPEDIENTES` se da de alta en app-ingeco → Admin → Módulos (embebido).
- HTML/CSS/JS plano, mobile-first, español llano, Barlow como el resto, **sin rojo-verde**:
  teal = bien, ámbar = atención, gris = sin dato.
- Pantallas (barra inferior):
  1. **Tablero**: $ a cobrar por etapa, $ por oficina, cantidad quietos > umbral, próximos
     cobros estimados (30 días). Auto-refresh cada 5 min.
  2. **Lista**: oficina, días ahí, días restantes estimados, semáforo (teal/ámbar/gris).
     Filtros: prioridad, etapa, oficina. Buscador por nombre o número.
  3. **Ficha**: línea de tiempo (importado y bot con distinto estilo), monto, observaciones,
     proyección con su calidad, gestiones manuales con botón "Agregar gestión" (tipo por
     selector fijo + texto).
  4. **Estadísticas**: mediana de días por oficina (barras), tiempo total inicio→Tesorería,
     ranking de oficinas lentas, cantidad de casos por oficina.
  5. **Ayuda**: cómo se usa, qué significa cada semáforo y cómo se calcula la proyección.
- Cartel de diagnóstico arriba de todo cuando LOG tiene errores de la última corrida.

## 7. Proyección de días restantes

Para cada expediente activo:

1. Ruta = RUTAS filtrada por su `tipo_contrato` (si no hay ruta para ese tipo → `calidad=debil`, se usa la ruta "Contratación Directa").
2. `paso_en_ruta` = posición de `oficina_actual` (canónica) en la ruta. Si no está en la ruta
   → etapa "Fuera de ruta", sin proyección, se muestra en ámbar.
3. `dias_restantes_est` = (mediana de la oficina actual − días que ya lleva, mínimo 0)
   + Σ mediana de cada oficina posterior en la ruta.
   Para cada oficina: si `casos` ≥ 5 se usa `mediana_dias` de OFICINAS; si no, `dias_default`
   de RUTAS y la estimación queda `debil`.
4. `fecha_cobro_est` = hoy + días restantes en días hábiles.
5. `etapa` viene de la columna `etapa` de RUTAS para el paso actual.

Los expedientes que retroceden no se tratan especialmente: se registra el movimiento y se
recalcula el paso.

## 8. Fuera de alcance (v1)

Expedientes de Vialidad provincial, alta/edición del maestro desde la app, historial
anterior a lo que hay en `trazabilidad`, push nativo propio (va por app-ingeco).

## 9. Repo y deploy

```
expedientes-ingeco/
  backend/   Apps Script (clasp): Config.js, Smt.js (API municipio), Maestro.js, Motor.js
             (comparación + movimientos), Proyeccion.js, Alertas.js, WebApp.js (doPost),
             Importar.js (trazabilidad, una vez), Triggers.js
  web/       index.html, app.js, estilos.css, manifest, sw.js (sin caché HTTP)
  docs/
```

Deploy: `clasp push` + `clasp deploy -i <deploymentId>` para el backend; `git subtree push
--prefix web origin gh-pages` para la web. Repo privado `marcoskatz-cmd/expedientes-ingeco`.
Script Properties: `SMT_CUIL`, `SMT_CLAVE`, `SHEET_MAESTRO`, `SHEET_DATOS`, `CLAVE_EXPEDIENTES`
(para `notificar` en app-ingeco).

## 10. Pruebas

- `Smt.js`: función de prueba que loguea y consulta un expediente conocido (240034/2026) y
  loguea la respuesta cruda, para confirmar los nombres de campos del login.
- Motor: casos sin cambio, cambio de oficina, cambio solo de fecha, expediente inexistente,
  oficina nueva no mapeada.
- Proyección: ruta completa con datos, ruta con oficinas sin casos (débil), oficina fuera de ruta.
- Importación: filas duplicadas, sin fecha, sin oficina.
- Web: abrir desde la app con ticket, abrir sin ticket, cargar una gestión, modo celular.
