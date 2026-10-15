# Expedientes INGECO

Seguimiento de los expedientes de cobro de INGECO en la Municipalidad de San Miguel de Tucumán:
dónde está cada uno, su recorrido entre oficinas y una proyección de cuándo llega a Tesorería.

- Web: https://marcoskatz-cmd.github.io/expedientes-ingeco/ (se abre desde la app INGECO, módulo `EXPEDIENTES`)
- Backend: Apps Script (`backend/`), bot horario 9–17 h lun–vie + API JSON por `doPost`.
- Datos: planilla "Expedientes INGECO - Datos" (la crea `crearPlanillaDatos`). El maestro sigue siendo
  la planilla OBRAS INGECO, hoja `OBRAS DE MUNICIPIO`.
- Diseño: `docs/superpowers/specs/2026-10-15-expedientes-ingeco-design.md`.

## Cómo funciona

1. Cada hora el bot lee los expedientes con Estado $ distinto de "Cobrada" en el maestro.
2. Consulta `POST /expedientes/ultimocurso` en `https://estadisticas.smt.gob.ar:5000` (la API que usa back.smt.gob.ar) por cada uno.
3. Si la oficina o la fecha de pase cambió, guarda un movimiento en MOVIMIENTOS y actualiza Oficina / Ultimo Movimiento en el maestro.
4. Recalcula la mediana de días hábiles por oficina y la proyección de días restantes (ruta esperada por tipo de contrato, hoja RUTAS).
5. Si un expediente supera `umbral_dias_quieto` (CONFIG, default 10 días hábiles) manda mail a `mails_alerta` y un aviso por app-ingeco.

## Script Properties (editor de Apps Script → Configuración del proyecto)

| Propiedad | Valor |
|---|---|
| `SMT_CUIL` | CUIL del usuario de Ciudad Digital |
| `SMT_CLAVE` | su clave |
| `SHEET_MAESTRO` | `1Hl8HZqrH6lMwnAGpitA37ZGLg4szTcFGK7vmv92qkBA` |
| `SHEET_DATOS` | id que devuelve `crearPlanillaDatos()` |
| `CLAVE_EXPEDIENTES` | clave del sistema en el backend común de app-ingeco (para `notificar`) |

## Setup (una vez, desde el editor)

1. `crearPlanillaDatos()` → copiar el id a `SHEET_DATOS`.
2. `probarSmt()` → confirma login y forma de la respuesta (ajustar nombres de campos en `Smt.js` si hace falta).
3. `importarRutas()` y `importarTrazabilidad()`.
4. `correrAhora()` → primera pasada; revisar ESTADO_ACTUAL, MOVIMIENTOS y LOG.
5. `instalarTrigger()`.
6. En app-ingeco → Admin → Módulos: código `EXPEDIENTES`, URL de la web, embebido; asignar personas.

## Deploy

```bash
npm test                      # lógica pura (Parse, Diagnostico, Motor, Proyeccion, Importar, Alertas)
cd backend && clasp push && clasp deploy -i <deploymentId>
git subtree push --prefix web origin gh-pages
```

Nunca copiar código a mano en el editor online.

## Oficinas nuevas

Si el municipio devuelve una oficina que no está en RUTAS, el LOG avisa "Oficina nueva sin mapear".
En la hoja OFICINAS, columna `nombre_canonico`, se la asigna al nombre que figura en RUTAS (o se la agrega a RUTAS).

## Desarrollo local de la web

Servidor estático en la raíz del repo y abrir `web/?dev=1`: usa las respuestas simuladas de `tests/mock/`.
