const API_URL = 'https://script.google.com/macros/s/AKfycbzI1b3roxHz-4uF6bcwL0jqlOIq_5Erw8gqiq-DdgWm8G_cVLSgeGV3wGzrMhMAKRCieQ/exec';
const $ = s => document.querySelector(s);
const DEV = location.search.includes('dev=1');
let DATA = null, VISTA = 'tablero', EN_FICHA = null, STATS = null;
const FICHAS = {}; // fichas ya vistas: se muestran al instante y se refrescan por detrás
const F = { q: '', etapa: '', oficina: '', quietos: false, orden: 'dias_quieto', asc: false };

async function api(accion, payload) {
  // dev=1: lee respuestas simuladas de tests/mock (solo para desarrollo local).
  const r = DEV ? await fetch('../tests/mock/' + accion + '.json')
    : await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion, payload: Object.assign({ sesion: window.INGECO_SESION || '' }, payload || {}) }) });
  const j = await r.json();
  if (!j.ok) { if (j.sin_sesion) sinAcceso(); throw new Error(j.error || 'Falló la consulta'); }
  return j;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = esc;
const pesos = v => '$ ' + Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const num = v => (v === '' || v == null) ? null : Number(v);
// Las oficinas vienen con mayúsculas y tildes distintas según la fuente: se agrupan por nombre normalizado y se muestran prolijas.
const normOf = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const MINUSC = { DE: 1, DEL: 1, Y: 1, LA: 1, EL: 1, LOS: 1, LAS: 1 };
const ACENTOS = { DIRECCION: 'Dirección', SECRETARIA: 'Secretaría', TESORERIA: 'Tesorería', CONTADURIA: 'Contaduría', FISCALIA: 'Fiscalía', ECONOMIA: 'Economía', PUBLICAS: 'Públicas' };
const bonitoOf = t => normOf(t).split(' ').map((w, i) => ACENTOS[w] || (MINUSC[w] && i ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
const semaforo = e => !e.oficina_actual ? 'gris' : (Number(e.dias_quieto) > DATA.umbral ? 'ambar' : 'teal');
const fechaKey = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + m[2] + m[1] : ''; };

function sinAcceso() { $('#vista').innerHTML = '<p class="vacio">Abrí este sistema desde la app INGECO.</p>'; }

const CACHE_KEY = 'expedientes_estado_v1';
function guardarCache(d) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d })); } catch (e) { } }
function leerCache() { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && c.d ? c : null; } catch (e) { return null; } }
function prepararEstados(d) { d.estados.forEach(e => { e.ofKey = normOf(e.oficina_actual); e.ofNombre = e.oficina_actual ? bonitoOf(e.oficina_actual) : ''; }); return d; }

// Primero muestra lo último que se vio (guardado en este dispositivo) y después trae lo nuevo.
function mostrarCacheSiHay() {
  const c = leerCache();
  if (!c) return false;
  DATA = prepararEstados(c.d);
  $('#corrida').textContent = 'Mostrando datos guardados, actualizando…';
  render();
  return true;
}

let ULTIMO_TXT = '';
async function cargar() {
  try {
    const nuevo = await api('estado');
    const txt = JSON.stringify(nuevo);
    const igual = DATA && txt === ULTIMO_TXT;
    ULTIMO_TXT = txt;
    guardarCache(nuevo);
    if (!igual) { DATA = nuevo; prepararEstados(DATA); }
    $('#corrida').textContent = DATA.ultima_corrida ? 'Última consulta ' + DATA.ultima_corrida.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/, '$3/$2 $4:$5') : '';
    if (igual) return; // nada cambió: no se redibuja (no se pierde el scroll ni lo que estaba abierto)
    $('#avisos').innerHTML = DATA.avisos.filter(a => a.nivel === 'ERROR').map(a => `<div class="aviso">${esc(a.mensaje)}</div>`).join('');
    render();
  } catch (e) {
    if (DATA) { $('#corrida').textContent = 'Sin conexión: mostrando datos guardados'; }
    else $('#vista').innerHTML = `<p class="vacio">No pude traer los datos: ${esc(e.message)}. Probá de nuevo en un rato.</p>`;
  }
}

function render() {
  if (!DATA || EN_FICHA) return; // la actualización automática no te saca de la ficha que estás mirando
  if (VISTA === 'tablero') renderTablero();
  else if (VISTA === 'lista') renderLista();
  else if (VISTA === 'indice') renderIndice();
  else renderStats();
}

function irALista(filtros) { Object.assign(F, { q: '', etapa: '', oficina: '', quietos: false }, filtros || {}); activar('lista'); }
function activar(v, sinHistorial) {
  VISTA = v; EN_FICHA = null;
  document.querySelectorAll('nav.tabs button').forEach(x => x.classList.toggle('activo', x.dataset.v === v));
  if (!sinHistorial) history.pushState({ v }, '', '#' + v);
  render(); window.scrollTo(0, 0);
}
// Botón "atrás" del celular o del navegador: vuelve a la vista anterior dentro del sistema en vez de salir.
window.addEventListener('popstate', ev => {
  const st = ev.state || { v: 'tablero' };
  if (st.v === 'ficha' && st.exp) ficha(st.exp, true); else activar(st.v || 'tablero', true);
});
history.replaceState({ v: 'tablero' }, '', '#tablero');

function barras(obj, total, tipo) {
  const items = Object.entries(obj).sort((a, b) => b[1].monto - a[1].monto);
  if (!items.length) return '<p class="vacio">Sin datos</p>';
  return '<div class="barras">' + items.map(([k, v]) =>
    `<div class="fila" data-k="${esc(k)}" data-tipo="${tipo}" style="cursor:pointer"><span title="${esc(v.nombre)}">${esc(v.nombre) || 'Sin dato'} <small>(${v.cant})</small></span><div class="barra"><i style="width:${total ? v.monto / total * 100 : 0}%"></i></div><b>${pesos(v.monto)}</b></div>`).join('') + '</div>';
}
function acum(obj, key, nombre, e) { const o = obj[key] = obj[key] || { nombre, monto: 0, cant: 0 }; o.monto += Number(e.monto || 0); o.cant++; }
function enlazarBarras() {
  document.querySelectorAll('.fila[data-k]').forEach(f => f.onclick = () => irALista(f.dataset.tipo === 'etapa' ? { etapa: f.dataset.k } : { oficina: f.dataset.k }));
}

function miniLista(items, derecha) {
  if (!items.length) return '<p class="vacio">Nada por ahora</p>';
  return '<ul class="mini">' + items.map(e => `<li data-exp="${esc(e.expediente)}"><div><span class="exp">${esc(e.expediente)}</span><b title="${esc(e.nombre_obra)}">${esc(e.nombre_obra)}</b><small>${esc(e.ofNombre || 'sin dato')}</small></div><div class="num">${derecha(e)}</div></li>`).join('') + '</ul>';
}

function renderTablero() {
  const act = DATA.estados.filter(e => e.oficina_actual);
  const porOficina = {};
  act.forEach(e => acum(porOficina, e.ofKey, e.ofNombre, e));
  const quietos = act.filter(e => Number(e.dias_quieto) > DATA.umbral).sort((a, b) => Number(b.dias_quieto) - Number(a.dias_quieto));
  const total = act.reduce((s, e) => s + Number(e.monto), 0);
  const sinDato = DATA.estados.filter(e => !e.oficina_actual);
  const sinMonto = act.filter(e => !Number(e.monto)).length;
  const enCobro = act.filter(e => e.etapa === 'Cobro');
  $('#vista').innerHTML = `
    <section class="tiles">
      <div class="tile click" data-ir="{}"><small>A cobrar</small><b>${pesos(total)}</b><span>${act.length} expedientes${sinMonto ? ' · ' + sinMonto + ' sin monto cargado' : ''}</span></div>
      <div class="tile click ${quietos.length ? 'ambar' : ''}" data-ir='{"quietos":true}'><small>Quietos más de ${n(DATA.umbral)} días hábiles</small><b>${quietos.length}</b><span>${pesos(quietos.reduce((s, e) => s + Number(e.monto), 0))}</span></div>
      <div class="tile click teal" data-ir='{"etapa":"Cobro"}'><small>En Tesorería (por cobrar)</small><b>${enCobro.length}</b><span>${pesos(enCobro.reduce((s, e) => s + Number(e.monto), 0))}</span></div>
      ${sinDato.length ? `<div class="tile"><small>Sin dato del municipio</small><b>${sinDato.length}</b><span>no encontrados o con error</span></div>` : ''}
    </section>
    <div class="uno">
      <div class="card"><h2>Últimos movimientos</h2><p><small>Los pases que detectó el sistema, del más reciente al más viejo.</small></p>${ultimosMovimientosHtml(DATA.ultimos_movimientos || [])}</div>
      <div class="card"><h2>Por oficina</h2><p><small>Tocá una oficina para ver sus expedientes.</small></p>${porOficinaDesplegable(act, porOficina, total)}</div>
      <div class="card"><h2>Más tiempo quietos</h2>${miniLista(quietos.slice(0, 8), e => `<b>${n(e.dias_quieto)} días quieto</b><br><small>${pesos(e.monto)}</small>`)}</div>
    </div>`;
  document.querySelectorAll('.tile[data-ir]').forEach(t => t.onclick = () => irALista(JSON.parse(t.dataset.ir)));
  document.querySelectorAll('.mini li').forEach(li => li.onclick = () => ficha(li.dataset.exp));
  document.querySelectorAll('.of-cab').forEach(c => c.onclick = () => { const d = c.nextElementSibling; d.hidden = !d.hidden; c.classList.toggle('abierto', !d.hidden); });
  document.querySelectorAll('.of-det li').forEach(li => li.onclick = ev => { ev.stopPropagation(); ficha(li.dataset.exp); });
  document.querySelectorAll('.movs li').forEach(li => li.onclick = () => ficha(li.dataset.exp));
}

function ultimosMovimientosHtml(movs) {
  if (!movs.length) return '<p class="vacio">Todavía no hay movimientos detectados. El sistema consulta al municipio cada hora.</p>';
  return '<ul class="movs">' + movs.map(m => {
    const cobrado = normOf(m.oficina) === 'COBRADO';
    const dias = m.dias_en_oficina_anterior !== '' && m.dias_en_oficina_anterior != null ? ` <small>(estuvo ${n(m.dias_en_oficina_anterior)} días hábiles en la anterior)</small>` : '';
    return `<li data-exp="${esc(m.expediente)}" class="${cobrado ? 'cobrado' : ''}">
      <span class="fecha">${n(m.fecha_pase)}${m.hora_pase ? '<small> ' + esc(m.hora_pase) + ' h</small>' : ''}</span>
      <span class="que"><span class="exp">${esc(m.expediente)}</span><span class="obra" title="${esc(m.nombre_obra)}">${esc(m.nombre_obra) || 'Expediente ya cobrado o fuera de seguimiento'}</span>
        <span class="paso">${cobrado ? '✔ Cobrado' : '→ Pasó a <b>' + esc(bonitoOf(m.oficina)) + '</b>'}${dias}</span>${m.comentarios ? '<small class="coment">' + esc(m.comentarios) + '</small>' : ''}</span>
    </li>`;
  }).join('') + '</ul>';
}

// Lista de oficinas con el monto y, al tocar, los expedientes que están en cada una.
function porOficinaDesplegable(act, porOficina, total) {
  const items = Object.entries(porOficina).sort((a, b) => b[1].monto - a[1].monto);
  if (!items.length) return '<p class="vacio">Sin datos</p>';
  return items.map(([k, v]) => {
    const exps = act.filter(e => e.ofKey === k).sort((a, b) => Number(b.dias_quieto) - Number(a.dias_quieto));
    return `<div class="of">
      <div class="of-cab"><span class="flecha">▸</span><span class="nom">${esc(v.nombre)} <small>(${v.cant})</small></span><div class="barra"><i style="width:${total ? v.monto / total * 100 : 0}%"></i></div><b>${pesos(v.monto)}</b></div>
      <ul class="of-det" hidden>${exps.map(e => `<li data-exp="${esc(e.expediente)}" class="${semaforo(e)}"><span class="nom"><span class="exp">${esc(e.expediente)}</span><span class="obra" title="${esc(e.nombre_obra)}">${esc(e.nombre_obra)}</span><small>desde ${n(e.desde)}</small></span><span class="dias"><span class="chip ${semaforo(e)}">${n(e.dias_quieto)} días</span></span><b>${pesos(e.monto)}</b></li>`).join('')}</ul>
    </div>`;
  }).join('');
}


function pasaFiltros(e) {
  const q = F.q.toLowerCase();
  return (!q || (e.nombre_obra + ' ' + e.expediente + ' ' + e.oficina_actual + ' ' + e.tipo_contrato).toLowerCase().includes(q)) &&
    (!F.etapa || (e.etapa || '') === F.etapa) &&
    (!F.oficina || e.ofKey === F.oficina) &&
    (!F.quietos || Number(e.dias_quieto) > DATA.umbral);
}
// Barra de filtros compartida por Lista e Índice; redibujar() vuelve a pintar la vista actual.
function filtrosHtml(lista) {
  const etapas = [...new Set(DATA.estados.map(e => e.etapa).filter(Boolean))].sort();
  const oficinas = {}; DATA.estados.forEach(e => { if (e.ofKey) oficinas[e.ofKey] = e.ofNombre; });
  return `<div class="filtros">
      <input id="f-q" placeholder="Buscar obra, expediente, oficina o tipo" value="${esc(F.q)}">
      <select id="f-etapa"><option value="">Todas las etapas</option>${etapas.map(x => `<option ${F.etapa === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="f-of"><option value="">Todas las oficinas</option>${Object.entries(oficinas).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => `<option value="${esc(k)}" ${F.oficina === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <label><input type="checkbox" id="f-quietos" ${F.quietos ? 'checked' : ''}> Solo quietos</label>
      <span class="chip">${lista.length} de ${DATA.estados.length} · ${pesos(lista.reduce((s, e) => s + Number(e.monto || 0), 0))}</span>
    </div>`;
}
function enlazarFiltros(redibujar) {
  const inp = $('#f-q');
  // Espera a que se deje de tipear un instante antes de redibujar, así no se traba al escribir.
  inp.oninput = ev => { F.q = ev.target.value; clearTimeout(enlazarFiltros.t); enlazarFiltros.t = setTimeout(() => { const pos = inp.selectionStart; redibujar(); const i2 = $('#f-q'); i2.focus(); i2.setSelectionRange(pos, pos); }, 180); };
  $('#f-etapa').onchange = ev => { F.etapa = ev.target.value; redibujar(); };
  $('#f-of').onchange = ev => { F.oficina = ev.target.value; redibujar(); };
  $('#f-quietos').onchange = ev => { F.quietos = ev.target.checked; redibujar(); };
}

function filtrar() {
  const lista = DATA.estados.filter(pasaFiltros);
  const col = F.orden;
  const val = e => col === 'fecha_cobro_est' ? fechaKey(e[col]) : (['monto', 'dias_quieto', 'dias_restantes_est'].includes(col) ? (num(e[col]) ?? -1) : String(e[col] || '').toLowerCase());
  lista.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (F.asc ? 1 : -1); });
  return lista;
}

function renderLista() {
  const lista = filtrar();
  const cols = [['expediente', 'Expediente'], ['nombre_obra', 'Obra'], ['monto', 'Monto'], ['oficina_actual', 'Oficina actual'], ['dias_quieto', 'Días ahí'], ['etapa', 'Etapa'], ['dias_restantes_est', 'Faltan (d. háb.)'], ['fecha_cobro_est', 'Cobro est.']];
  const th = cols.map(([k, t]) => `<th data-col="${k}" class="${F.orden === k ? 'orden' + (F.asc ? ' asc' : '') : ''}">${t}</th>`).join('');
  const proy = e => num(e.dias_restantes_est) != null ? `~${n(e.dias_restantes_est)}${e.calidad_estimacion === 'debil' ? ' <span class="chip debil">débil</span>' : ''}` : '';
  const filas = lista.map(e => `<tr class="item ${semaforo(e)}" data-exp="${esc(e.expediente)}">
      <td class="num"><span class="exp">${esc(e.expediente)}</span></td>
      <td class="obra">${esc(e.nombre_obra)}<small>${esc(e.tipo_contrato)}${e.prioridad && e.prioridad !== 'Normal' ? ' · prioridad ' + esc(e.prioridad) : ''}</small></td>
      <td class="num">${pesos(e.monto)}</td>
      <td>${e.oficina_actual ? esc(e.ofNombre) + '<br><small>desde ' + n(e.desde) + '</small>' : '<span class="chip">sin dato</span><br><small>' + esc(e.error) + '</small>'}</td>
      <td class="num">${e.oficina_actual ? `<span class="chip ${semaforo(e)}">${n(e.dias_quieto)}</span>` : ''}</td>
      <td>${esc(e.etapa || '')}</td>
      <td class="num">${proy(e)}</td>
      <td class="num">${n(e.fecha_cobro_est)}</td></tr>`).join('');
  const cards = lista.map(e => `<li class="${semaforo(e)}" data-exp="${esc(e.expediente)}">
      <span class="exp">${esc(e.expediente)}</span><b>${esc(e.nombre_obra)}</b><span>${pesos(e.monto)}</span>
      <span>${e.oficina_actual ? esc(e.ofNombre) + ' · ' + n(e.dias_quieto) + ' días hábiles ahí' : 'Sin dato: ' + esc(e.error)}</span>
      <span>${num(e.dias_restantes_est) != null ? 'Faltan ~' + n(e.dias_restantes_est) + ' días hábiles (' + n(e.fecha_cobro_est) + ')' + (e.calidad_estimacion === 'debil' ? ' · estimación débil' : '') : esc(e.etapa || '')}</span></li>`).join('');
  $('#vista').innerHTML = `
    ${filtrosHtml(lista)}
    <table class="tabla"><thead><tr>${th}</tr></thead><tbody>${filas || '<tr><td colspan="8" class="vacio">Nada que mostrar</td></tr>'}</tbody></table>
    <ul class="lista">${cards || '<li class="vacio">Nada que mostrar</li>'}</ul>`;
  enlazarFiltros(renderLista);
  document.querySelectorAll('th[data-col]').forEach(t => t.onclick = () => { if (F.orden === t.dataset.col) F.asc = !F.asc; else { F.orden = t.dataset.col; F.asc = t.dataset.col === 'nombre_obra' || t.dataset.col === 'fecha_cobro_est' || t.dataset.col === 'expediente'; } renderLista(); });
  document.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => ficha(el.dataset.exp));
}

// Índice: una línea por expediente (obra, número y monto) para recorrer todos sin scroll largo.
const IDX = { orden: 'nombre_obra', asc: true };
function renderIndice() {
  const val = e => IDX.orden === 'monto' ? Number(e.monto || 0) : String(e[IDX.orden] || '').toLowerCase();
  const lista = DATA.estados.filter(pasaFiltros)
    .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (IDX.asc ? 1 : -1); });
  const col = (k, t) => `<span data-col="${k}" class="${IDX.orden === k ? 'orden' + (IDX.asc ? ' asc' : '') : ''}">${t}</span>`;
  const cab = col('nombre_obra', 'Obra') + '<span class="der">' + col('expediente', 'Expediente') + col('monto', 'Monto') + '</span>';
  $('#vista').innerHTML = `
    ${filtrosHtml(lista)}
    <div class="indice">
      <div class="idx-cab">${cab}</div>
      ${lista.map(e => `<div class="idx-fila ${semaforo(e)}" data-exp="${esc(e.expediente)}"><span class="obra" title="${esc(e.nombre_obra)}">${esc(e.nombre_obra) || '—'}</span><span class="der"><span class="exp">${esc(e.expediente)}</span><b>${pesos(e.monto)}</b></span></div>`).join('') || '<p class="vacio">Nada que mostrar</p>'}
    </div>`;
  enlazarFiltros(renderIndice);
  document.querySelectorAll('.idx-cab [data-col]').forEach(t => t.onclick = () => { if (IDX.orden === t.dataset.col) IDX.asc = !IDX.asc; else { IDX.orden = t.dataset.col; IDX.asc = t.dataset.col !== 'monto'; } renderIndice(); });
  document.querySelectorAll('.idx-fila').forEach(el => el.onclick = () => ficha(el.dataset.exp));
}

async function ficha(exp, sinHistorial) {
  if (!sinHistorial) history.pushState({ v: 'ficha', exp }, '', '#ficha');
  EN_FICHA = exp;
  window.scrollTo(0, 0);
  // Se muestra enseguida con lo que ya se tiene (la ficha guardada o los datos del listado) y el recorrido llega después.
  const base = DATA && DATA.estados.find(e => String(e.expediente) === String(exp));
  const previa = FICHAS[exp] || (base ? { estado: base, movimientos: null } : null);
  if (previa) pintarFicha(previa); else $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    const f = await api('ficha', { expediente: exp });
    const cambio = JSON.stringify(f) !== JSON.stringify(FICHAS[exp]);
    FICHAS[exp] = f;
    if (EN_FICHA === exp && cambio) pintarFicha(f);
  } catch (e) { if (EN_FICHA === exp && !FICHAS[exp]) $('#vista').innerHTML = `<button class="volver" onclick="history.back()">← Volver</button><p class="vacio">${esc(e.message)}</p>`; }
}

function pintarFicha(f) {
  const e = Object.assign({}, f.estado);
  e.ofNombre = e.oficina_actual ? bonitoOf(e.oficina_actual) : '';
  const movs = (f.movimientos || []).slice().sort((a, b) => fechaKey(a.fecha_pase).localeCompare(fechaKey(b.fecha_pase)));
  const sem = semaforo(e);
  $('#vista').innerHTML = `<button class="volver" id="volver">← Volver</button>
    <p class="exp-grande">Expediente ${esc(e.expediente)}</p>
    <h2 style="margin-top:4px">${esc(e.nombre_obra)}</h2>
    <div class="ficha-grid ficha-sola">
      <div>
        <div class="card">
          <dl class="datos">
            <dt>Expediente</dt><dd>${esc(e.expediente)}</dd>
            <dt>Monto</dt><dd>${pesos(e.monto)}${!Number(e.monto) ? ' <small>(sin monto en la planilla)</small>' : ''}</dd>
            <dt>Tipo</dt><dd>${esc(e.tipo_contrato || '—')}</dd>
            <dt>Oficina actual</dt><dd class="estado ${sem}">${e.oficina_actual ? '<b>' + esc(e.ofNombre) + '</b> desde ' + n(e.desde) + (e.hora_pase ? ' ' + esc(e.hora_pase) + ' h' : '') + ' · ' + n(e.dias_quieto) + ' días hábiles' : 'Sin dato: ' + esc(e.error)}</dd>
            <dt>Etapa</dt><dd>${esc(e.etapa || '—')}${e.paso_en_ruta ? ' <small>(paso ' + n(e.paso_en_ruta) + ' de la ruta)</small>' : ''}</dd>
            <dt>Cobro estimado</dt><dd>${num(e.dias_restantes_est) != null ? '<b>' + n(e.fecha_cobro_est) + '</b> · faltan ~' + n(e.dias_restantes_est) + ' días hábiles' + (e.calidad_estimacion === 'debil' ? ' <span class="chip debil">estimación débil</span>' : '') : 'Sin proyección' + (e.etapa === 'Fuera de ruta' ? ': la oficina no está en la ruta de cobro' : '')}</dd>
            <dt>Última consulta</dt><dd>${n(e.ultima_consulta)}</dd>
          </dl>
        </div>
        <div class="card" style="margin-top:16px"><h2>Recorrido</h2>
          ${f.movimientos ? '' : '<p class="vacio">Cargando recorrido…</p>'}<ol class="tiempo">${movs.map((m, i) => `<li class="${esc(m.origen)}${i === movs.length - 1 ? ' actual' : ''}"><b>${n(m.fecha_pase)}${m.hora_pase ? ' ' + esc(m.hora_pase) + ' h' : ''}</b> ${esc(bonitoOf(m.oficina))}${m.dias_en_oficina_anterior !== '' && m.dias_en_oficina_anterior != null ? ' <small>(' + n(m.dias_en_oficina_anterior) + ' días en la anterior)</small>' : ''}${m.descripcion_api ? '<span class="coment">' + esc(m.descripcion_api) + '</span>' : ''}</li>`).join('') || (f.movimientos ? '<li>Sin movimientos registrados</li>' : '')}</ol>
          <p><small>En gris: historia importada de la planilla. En negro: detectado por el bot.</small></p>
        </div>
      </div>
    </div>`;
  $('#volver').onclick = () => history.back();
}

// Estadísticas: se muestran al instante las últimas traídas y se refrescan por detrás.
async function renderStats() {
  if (STATS) pintarStats(STATS); else $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    const s = await api('estadisticas');
    const cambio = JSON.stringify(s) !== JSON.stringify(STATS);
    STATS = s;
    if (VISTA === 'stats' && !EN_FICHA && cambio) pintarStats(s);
  } catch (e) { if (!STATS && VISTA === 'stats') $('#vista').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; }
}
function pintarStats(s) {
  const porCanon = {}; s.oficinas.forEach(o => { const k = normOf(o.nombre_canonico); if (!porCanon[k] || Number(o.casos) > Number(porCanon[k].casos)) porCanon[k] = o; });
  const ofs = Object.values(porCanon).filter(o => Number(o.casos)).sort((a, b) => Number(b.mediana_dias) - Number(a.mediana_dias));
  const firmes = ofs.filter(o => Number(o.casos) >= (s.min_casos || 5));
  const prov = o => Number(o.casos) < (s.min_casos || 5);
  const max = Math.max(1, ...ofs.map(o => Number(o.mediana_dias)));
  const act = DATA.estados.filter(e => e.oficina_actual);
  const porOf = {}; act.forEach(e => acum(porOf, e.ofKey, e.ofNombre, e));
  // Expediente tipo: la ruta general paso a paso, con la mediana real de cada oficina (o el valor por defecto si hay pocos casos).
  const statsOf = {}; s.oficinas.forEach(o => { statsOf[normOf(o.nombre_canonico)] = o; });
  const lleg = s.llegadas || {};
  const casosTxt = (key, casos) => { const l = lleg[key] || 0; return l > casos ? `${n(l)} pasaron · ${n(casos)} con salida medida` : (casos ? `${n(casos)} caso${casos === 1 ? '' : 's'}` : 'sin casos'); };
  const ruta = (s.rutas || []).filter(r => String(r.tipo_contrato).trim() === '*').sort((a, b) => Number(a.orden) - Number(b.orden));
  const pasos = ruta.map(r => { const key = normOf(r.oficina), st = statsOf[key]; const ok = st && Number(st.casos) >= (s.min_casos || 5); return { oficina: bonitoOf(r.oficina), key, etapa: r.etapa, dias: ok ? Number(st.mediana_dias) : Number(r.dias_default) || 0, casos: st ? Number(st.casos) : 0, debil: !ok }; });
  const totalTipo = pasos.reduce((a, p) => a + p.dias, 0);
  const sinTeso = pasos.filter(p => p.etapa !== 'Cobro').reduce((a, p) => a + p.dias, 0);
  const tesoProv = pasos.some(p => p.etapa === 'Cobro' && p.debil);
  let acumD = 0;
  const lineaHtml = pasos.length ? `
    <div class="linea">${pasos.map(p => `<div class="seg ${esc(p.etapa)}${p.debil ? ' debil' : ''}" style="flex:${Math.max(p.dias, 0.6)}" title="${esc(p.oficina)}: ${n(p.dias)} días hábiles${p.debil ? ' (provisorio)' : ''}">${p.dias >= 2 ? (p.debil ? '"' + n(p.dias) + ' d"' : n(p.dias) + ' d') : ''}</div>`).join('')}</div>
    <div class="leyenda"><span><i style="background:var(--seg-pre)"></i>Preliminar</span><span><i style="background:var(--seg-media)"></i>Media</span><span><i style="background:var(--seg-final)"></i>Final</span><span><i style="background:var(--seg-cobro)"></i>Cobro</span><span><i style="background:var(--texto-3);background-image:repeating-linear-gradient(45deg,transparent 0 3px,var(--superficie) 3px 5px)"></i>rayado y "entre comillas": dato provisorio, menos de ${n(s.min_casos || 5)} casos</span></div>
    <ul class="pasos">${pasos.map((p, i) => { acumD += p.dias; return `<li><span class="n">${i + 1}.</span><span>${esc(p.oficina)} <small class="n">${esc(p.etapa)} · ${casosTxt(p.key, p.casos)}</small></span><span class="d">${p.debil ? '<b>"' + n(p.dias) + '"</b> d' : '<b>' + n(p.dias) + '</b> d'}</span><span class="acum">día ${n(acumD)}</span></li>`; }).join('')}</ul>
    <p><small>Hasta llegar a Tesorería, un expediente tipo tarda <b>${n(sinTeso)} días hábiles</b> (unas ${n(Math.round(sinTeso / 5))} semanas); hasta cobrarse, ${tesoProv ? '"' + n(totalTipo) + '"' : n(totalTipo)}. Se puede editar la ruta en la hoja RUTAS de la planilla de datos.</small></p>
    ${pasos.some(p => p.etapa === 'Cobro' && p.debil) ? '<p><small><b>Tesorería va "entre comillas"</b>: por Tesorería pasaron ' + n(lleg['TESORERIA GENERAL'] || 0) + ' expedientes, pero la planilla casi nunca registró la fecha en que salieron (se cobraron), así que la duración solo se pudo medir en ' + n((statsOf['TESORERIA GENERAL'] || {}).casos || 0) + '. El bot la mide desde ahora cada vez que un expediente se marca como cobrado en OBRAS INGECO; cuando junte ' + n(s.min_casos || 5) + ' casos el dato pasa a ser firme.</small></p>' : ''}` : '<p class="vacio">No hay ruta cargada.</p>';
  $('#vista').innerHTML = `
    <section class="tiles">
      <div class="tile"><small>Expediente tipo hasta llegar a Tesorería</small><b>${n(sinTeso)} días hábiles</b><span>sumando la mediana de cada oficina</span></div>
      <div class="tile"><small>Expediente tipo hasta cobrar</small><b>${tesoProv ? '"' + n(totalTipo) + '"' : n(totalTipo)} días hábiles</b><span>${tesoProv ? 'Tesorería provisoria: ' + n(totalTipo - sinTeso) + ' d entre comillas' : 'incluye Tesorería'}</span></div>
      <div class="tile"><small>Inicio → Tesorería (real, mediana)</small><b>${n(s.total.mediana)} días hábiles</b><span>${n(s.total.casos)} expedientes completos · p25 ${n(s.total.p25)} · p75 ${n(s.total.p75)}</span></div>
      <div class="tile"><small>Oficina más lenta (con datos firmes)</small><b>${firmes[0] ? esc(bonitoOf(firmes[0].nombre_canonico)) : '—'}</b><span>${firmes[0] ? n(firmes[0].mediana_dias) + ' días de mediana · ' + n(firmes[0].casos) + ' casos' : ''}</span></div>
      <div class="tile"><small>Expedientes activos</small><b>${act.length}</b><span>en ${Object.keys(porOf).length} oficinas</span></div>
    </section>
    <div class="card" style="margin-top:16px"><h2>Recorrido del expediente tipo, de principio a fin</h2>${lineaHtml}</div>
    <div class="dos" style="margin-top:16px">
      <div class="card"><h2>Días hábiles por oficina (mediana)</h2>
        <div class="barras">${ofs.map(o => `<div class="fila"><span title="${esc(bonitoOf(o.nombre_canonico))}">${esc(bonitoOf(o.nombre_canonico))}</span><div class="barra"><i style="width:${Number(o.mediana_dias) / max * 100}%${prov(o) ? ';opacity:.4' : ''}"></i></div><b>${prov(o) ? '"' + n(o.mediana_dias) + ' d"' : n(o.mediana_dias) + ' d'} · ${casosTxt(normOf(o.nombre_canonico), Number(o.casos))}</b></div>`).join('') || '<p class="vacio">Todavía no hay historia suficiente.</p>'}</div>
        <p><small>Entre comillas: menos de ${n(s.min_casos || 5)} casos, dato provisorio; no se usa para proyectar y la estimación queda marcada como débil. Los días de una oficina se miden cuando el expediente sale de ella.</small></p>
      </div>
      <div class="card"><h2>Dónde está la plata hoy</h2>${barras(porOf, act.reduce((s, e) => s + Number(e.monto), 0), 'oficina')}</div>
    </div>`;
  enlazarBarras();
}

document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => activar(b.dataset.v));
const btnR = $('#btn-refresh');
if (btnR) btnR.onclick = async () => { const b = btnR; b.disabled = true; b.textContent = 'Actualizando…'; await cargar(); b.disabled = false; b.textContent = '↻ Actualizar'; };
if (window.INGECO_USUARIO && window.INGECO_USUARIO.es_admin && $('#btn-bot')) {
  const bb = $('#btn-bot'); bb.hidden = false;
  bb.onclick = async () => {
    bb.disabled = true; bb.textContent = 'Consultando al municipio… (unos minutos)';
    try { await api('forzar_corrida'); await cargar(); bb.textContent = 'Listo, datos frescos'; }
    catch (e) { bb.textContent = 'No se pudo: ' + e.message; }
    setTimeout(() => { bb.disabled = false; bb.textContent = 'Consultar municipio ahora'; }, 4000);
  };
}
if (!window.INGECO_USUARIO && !DEV) sinAcceso();
else {
  mostrarCacheSiHay();
  // Las estadísticas se traen por detrás apenas carga, así la pestaña abre al instante.
  cargar().then(() => api('estadisticas').then(x => { STATS = x; }).catch(() => { }));
  setInterval(() => { if (document.visibilityState === 'visible') cargar(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cargar(); });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
