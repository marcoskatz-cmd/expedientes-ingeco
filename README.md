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
3. Si la oficina o la fecha de pase cambió (el municipio a veces no informa fecha: entonces vale la fecha de detección), guarda un movimiento en MOVIMIENTOS y actualiza Oficina / Ultimo Movimiento en el maestro.
4. Recalcula la mediana de días hábiles por oficina y la proyección de días restantes (ruta esperada por tipo de contrato, hoja RUTAS).
5. Si un expediente supera `umbral_dias_quieto` (CONFIG, default 10 días hábiles) manda mail a `mails_alerta` y un aviso por app-ingeco.
6. De lunes a viernes a las 18 h manda un mail de resumen en una carilla: totales, movimientos del día y la lista completa de
   expedientes pendientes con la oficina donde están, días hábiles ahí, la próxima oficina según la ruta (hoja RUTAS) y el monto;
   los quietos más del umbral van con fondo ámbar. Va a Julia Katz por defecto (`CFG.MAILS_RESUMEN_DEFAULT`).
   **Para cambiar quién lo recibe:** planilla "Expedientes INGECO - Datos", hoja CONFIG, fila `mails_resumen`: mails separados por coma
   (la fila se crea sola en el primer envío). Se prueba con `enviarResumenAhora()` o la acción `setup_resumen`.

## Script Properties (editor de Apps Script → Configuración del proyecto)

| Propiedad | Valor |
|---|---|
| `SMT_CUIL` | CUIL del usuario de Ciudad Digital |
| `SMT_CLAVE` | su clave |
| `SHEET_MAESTRO` | `1Hl8HZqrH6lMwnAGpitA37ZGLg4szTcFGK7vmv92qkBA` |
| `SHEET_DATOS` | id que devuelve `crearPlanillaDatos()` |
| `CLAVE_EXPEDIENTES` | clave del sistema en el backend común de app-ingeco (para `notificar`) |

## Setup (hecho el 15-oct-2026)

Los ids de las planillas están como valores por defecto en `Config.js`; `SMT_CUIL` y `SMT_CLAVE` van en Script Properties.
Las funciones de setup (`crearPlanillaDatos`, `importarRutas`, `importarTrazabilidad`, `correrAhora`, `instalarTrigger`) se pueden
correr desde el editor o por `doPost` con las acciones `setup_*` de `Setup.js`, protegidas por la propiedad `SETUP_SECRET`
(`setup_importar`, `setup_correr`, `setup_trigger`, `setup_resumen`, `setup_log`, `setup_hoja`, `setup_probar`, `setup_rutas`, `setup_reset_alertas`,
`setup_prop`, `setup_config`). Con `SETUP_SECRET` vacía quedan deshabilitadas.

La hoja RUTAS tiene una ruta general de cobro (`tipo_contrato` = `*`) derivada de la trazabilidad histórica; se puede editar o
agregar rutas por tipo de contrato. La hoja "Ruta contratos" del maestro describe la contratación, no el cobro, y no se usa.

## Deploy

```bash
npm test                      # lógica pura (Parse, Diagnostico, Motor, Proyeccion, Importar, Alertas, Resumen)
cd backend && clasp push && clasp deploy -i <deploymentId>
git subtree push --prefix web origin gh-pages
```

Nunca copiar código a mano en el editor online.

## Oficinas nuevas

Si el municipio devuelve una oficina que no está en RUTAS, el LOG avisa "Oficina nueva sin mapear".
En la hoja OFICINAS, columna `nombre_canonico`, se la asigna al nombre que figura en RUTAS (o se la agrega a RUTAS).

## Desarrollo local de la web

Servidor estático en la raíz del repo y abrir `web/?dev=1`: usa las respuestas simuladas de `tests/mock/`.
