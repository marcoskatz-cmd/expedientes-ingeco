const API_URL = 'https://script.google.com/macros/s/AKfycbzI1b3roxHz-4uF6bcwL0jqlOIq_5Erw8gqiq-DdgWm8G_cVLSgeGV3wGzrMhMAKRCieQ/exec';
const $ = s => document.querySelector(s);
const DEV = location.search.includes('dev=1');
let DATA = null, VISTA = 'tablero';
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

async function cargar() {
  try {
    DATA = await api('estado');
    DATA.estados.forEach(e => { e.ofKey = normOf(e.oficina_actual); e.ofNombre = e.oficina_actual ? bonitoOf(e.oficina_actual) : ''; });
    $('#corrida').textContent = DATA.ultima_corrida ? 'Última consulta ' + DATA.ultima_corrida.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/, '$3/$2 $4:$5') : '';
    $('#avisos').innerHTML = DATA.avisos.filter(a => a.nivel === 'ERROR').map(a => `<div class="aviso">${esc(a.mensaje)}</div>`).join('');
    render();
  } catch (e) { $('#vista').innerHTML = `<p class="vacio">No pude traer los datos: ${esc(e.message)}. Probá de nuevo en un rato.</p>`; }
}

function render() {
  if (!DATA) return;
  if (VISTA === 'tablero') renderTablero();
  else if (VISTA === 'lista') renderLista();
  else renderStats();
}

function irALista(filtros) { Object.assign(F, { q: '', etapa: '', oficina: '', quietos: false }, filtros || {}); activar('lista'); }
function activar(v) { VISTA = v; document.querySelectorAll('nav.tabs button').forEach(x => x.classList.toggle('activo', x.dataset.v === v)); render(); window.scrollTo(0, 0); }

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
  return '<ul class="mini">' + items.map(e => `<li data-exp="${esc(e.expediente)}"><div><b title="${esc(e.nombre_obra)}">${esc(e.nombre_obra)}</b><small>${esc(e.expediente)} · ${esc(e.ofNombre || 'sin dato')}</small></div><div class="num">${derecha(e)}</div></li>`).join('') + '</ul>';
}

function renderTablero() {
  const act = DATA.estados.filter(e => e.oficina_actual);
  const porEtapa = {}, porOficina = {};
  act.forEach(e => { acum(porEtapa, e.etapa || 'Sin etapa', e.etapa || 'Sin etapa', e); acum(porOficina, e.ofKey, e.ofNombre, e); });
  const quietos = act.filter(e => Number(e.dias_quieto) > DATA.umbral).sort((a, b) => Number(b.dias_quieto) - Number(a.dias_quieto));
  const total = act.reduce((s, e) => s + Number(e.monto), 0);
  const proxList = act.filter(e => num(e.dias_restantes_est) != null).sort((a, b) => Number(a.dias_restantes_est) - Number(b.dias_restantes_est));
  const prox30 = proxList.filter(e => Number(e.dias_restantes_est) <= 22);
  const sinDato = DATA.estados.filter(e => !e.oficina_actual);
  const sinMonto = act.filter(e => !Number(e.monto)).length;
  const enCobro = act.filter(e => e.etapa === 'Cobro');
  $('#vista').innerHTML = `
    <section class="tiles">
      <div class="tile click" data-ir="{}"><small>A cobrar</small><b>${pesos(total)}</b><span>${act.length} expedientes${sinMonto ? ' · ' + sinMonto + ' sin monto cargado' : ''}</span></div>
      <div class="tile click ${quietos.length ? 'ambar' : ''}" data-ir='{"quietos":true}'><small>Quietos más de ${n(DATA.umbral)} días hábiles</small><b>${quietos.length}</b><span>${pesos(quietos.reduce((s, e) => s + Number(e.monto), 0))}</span></div>
      <div class="tile click teal" data-ir='{"etapa":"Cobro"}'><small>En Tesorería (por cobrar)</small><b>${enCobro.length}</b><span>${pesos(enCobro.reduce((s, e) => s + Number(e.monto), 0))}</span></div>
      <div class="tile teal"><small>Cobro estimado en 30 días</small><b>${pesos(prox30.reduce((s, e) => s + Number(e.monto), 0))}</b><span>${prox30.length} expedientes</span></div>
      ${sinDato.length ? `<div class="tile"><small>Sin dato del municipio</small><b>${sinDato.length}</b><span>no encontrados o con error</span></div>` : ''}
    </section>
    <div class="dos">
      <div class="card"><h2>Próximos cobros estimados</h2>${miniLista(proxList.slice(0, 8), e => `<b>${pesos(e.monto)}</b><br><small>${n(e.fecha_cobro_est)} · ~${n(e.dias_restantes_est)} d${e.calidad_estimacion === 'debil' ? ' · débil' : ''}</small>`)}</div>
      <div class="card"><h2>Más tiempo quietos</h2>${miniLista(quietos.slice(0, 8), e => `<b>${n(e.dias_quieto)} días</b><br><small>${pesos(e.monto)}</small>`)}</div>
      <div class="card"><h2>Por etapa</h2>${barras(porEtapa, total, 'etapa')}</div>
      <div class="card"><h2>Por oficina</h2>${barras(porOficina, total, 'oficina')}</div>
    </div>`;
  document.querySelectorAll('.tile[data-ir]').forEach(t => t.onclick = () => irALista(JSON.parse(t.dataset.ir)));
  document.querySelectorAll('.mini li').forEach(li => li.onclick = () => ficha(li.dataset.exp));
  enlazarBarras();
}

function filtrar() {
  const q = F.q.toLowerCase();
  const lista = DATA.estados.filter(e =>
    (!q || (e.nombre_obra + ' ' + e.expediente + ' ' + e.oficina_actual + ' ' + e.tipo_contrato).toLowerCase().includes(q)) &&
    (!F.etapa || (e.etapa || '') === F.etapa) &&
    (!F.oficina || e.ofKey === F.oficina) &&
    (!F.quietos || Number(e.dias_quieto) > DATA.umbral));
  const col = F.orden;
  const val = e => col === 'fecha_cobro_est' ? fechaKey(e[col]) : (['monto', 'dias_quieto', 'dias_restantes_est'].includes(col) ? (num(e[col]) ?? -1) : String(e[col] || '').toLowerCase());
  lista.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (F.asc ? 1 : -1); });
  return lista;
}

function renderLista() {
  const etapas = [...new Set(DATA.estados.map(e => e.etapa).filter(Boolean))].sort();
  const oficinas = {}; DATA.estados.forEach(e => { if (e.ofKey) oficinas[e.ofKey] = e.ofNombre; });
  const lista = filtrar();
  const cols = [['nombre_obra', 'Obra'], ['monto', 'Monto'], ['oficina_actual', 'Oficina actual'], ['dias_quieto', 'Días ahí'], ['etapa', 'Etapa'], ['dias_restantes_est', 'Faltan (d. háb.)'], ['fecha_cobro_est', 'Cobro est.']];
  const th = cols.map(([k, t]) => `<th data-col="${k}" class="${F.orden === k ? 'orden' + (F.asc ? ' asc' : '') : ''}">${t}</th>`).join('');
  const proy = e => num(e.dias_restantes_est) != null ? `~${n(e.dias_restantes_est)}${e.calidad_estimacion === 'debil' ? ' <span class="chip debil">débil</span>' : ''}` : '';
  const filas = lista.map(e => `<tr class="item ${semaforo(e)}" data-exp="${esc(e.expediente)}">
      <td class="obra">${esc(e.nombre_obra)}<small>${esc(e.expediente)} · ${esc(e.tipo_contrato)}${e.prioridad && e.prioridad !== 'Normal' ? ' · prioridad ' + esc(e.prioridad) : ''}</small></td>
      <td class="num">${pesos(e.monto)}</td>
      <td>${e.oficina_actual ? esc(e.ofNombre) + '<br><small>desde ' + n(e.desde) + '</small>' : '<span class="chip">sin dato</span><br><small>' + esc(e.error) + '</small>'}</td>
      <td class="num">${e.oficina_actual ? `<span class="chip ${semaforo(e)}">${n(e.dias_quieto)}</span>` : ''}</td>
      <td>${esc(e.etapa || '')}</td>
      <td class="num">${proy(e)}</td>
      <td class="num">${n(e.fecha_cobro_est)}</td></tr>`).join('');
  const cards = lista.map(e => `<li class="${semaforo(e)}" data-exp="${esc(e.expediente)}">
      <b>${esc(e.nombre_obra)}</b><span>${esc(e.expediente)} · ${pesos(e.monto)}</span>
      <span>${e.oficina_actual ? esc(e.ofNombre) + ' · ' + n(e.dias_quieto) + ' días' : 'Sin dato: ' + esc(e.error)}</span>
      <span>${num(e.dias_restantes_est) != null ? 'Faltan ~' + n(e.dias_restantes_est) + ' días hábiles (' + n(e.fecha_cobro_est) + ')' + (e.calidad_estimacion === 'debil' ? ' · estimación débil' : '') : esc(e.etapa || '')}</span></li>`).join('');
  $('#vista').innerHTML = `
    <div class="filtros">
      <input id="f-q" placeholder="Buscar obra, expediente, oficina o tipo" value="${esc(F.q)}">
      <select id="f-etapa"><option value="">Todas las etapas</option>${etapas.map(x => `<option ${F.etapa === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="f-of"><option value="">Todas las oficinas</option>${Object.entries(oficinas).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => `<option value="${esc(k)}" ${F.oficina === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <label><input type="checkbox" id="f-quietos" ${F.quietos ? 'checked' : ''}> Solo quietos</label>
      <span class="chip">${lista.length} de ${DATA.estados.length} · ${pesos(lista.reduce((s, e) => s + Number(e.monto), 0))}</span>
    </div>
    <table class="tabla"><thead><tr>${th}</tr></thead><tbody>${filas || '<tr><td colspan="7" class="vacio">Nada que mostrar</td></tr>'}</tbody></table>
    <ul class="lista">${cards || '<li class="vacio">Nada que mostrar</li>'}</ul>`;
  const inp = $('#f-q');
  inp.oninput = ev => { F.q = ev.target.value; const pos = inp.selectionStart; renderLista(); const i2 = $('#f-q'); i2.focus(); i2.setSelectionRange(pos, pos); };
  $('#f-etapa').onchange = ev => { F.etapa = ev.target.value; renderLista(); };
  $('#f-of').onchange = ev => { F.oficina = ev.target.value; renderLista(); };
  $('#f-quietos').onchange = ev => { F.quietos = ev.target.checked; renderLista(); };
  document.querySelectorAll('th[data-col]').forEach(t => t.onclick = () => { if (F.orden === t.dataset.col) F.asc = !F.asc; else { F.orden = t.dataset.col; F.asc = t.dataset.col === 'nombre_obra' || t.dataset.col === 'fecha_cobro_est'; } renderLista(); });
  document.querySelectorAll('[data-exp]').forEach(el => el.onclick = () => ficha(el.dataset.exp));
}

async function ficha(exp) {
  $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  let f;
  try { f = await api('ficha', { expediente: exp }); } catch (e) { $('#vista').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; return; }
  const e = f.estado, u = window.INGECO_USUARIO;
  e.ofNombre = e.oficina_actual ? bonitoOf(e.oficina_actual) : '';
  const movs = f.movimientos.slice().sort((a, b) => fechaKey(a.fecha_pase).localeCompare(fechaKey(b.fecha_pase)));
  const sem = semaforo(e);
  $('#vista').innerHTML = `<button class="volver" id="volver">← Volver</button>
    <h2 style="margin-top:4px">${esc(e.nombre_obra)}</h2>
    <div class="ficha-grid">
      <div>
        <div class="card">
          <dl class="datos">
            <dt>Expediente</dt><dd>${esc(e.expediente)}</dd>
            <dt>Monto</dt><dd>${pesos(e.monto)}${!Number(e.monto) ? ' <small>(sin monto en la planilla)</small>' : ''}</dd>
            <dt>Tipo</dt><dd>${esc(e.tipo_contrato || '—')}</dd>
            <dt>Oficina actual</dt><dd class="estado ${sem}">${e.oficina_actual ? '<b>' + esc(e.ofNombre) + '</b> desde ' + n(e.desde) + ' · ' + n(e.dias_quieto) + ' días hábiles' : 'Sin dato: ' + esc(e.error)}</dd>
            <dt>Etapa</dt><dd>${esc(e.etapa || '—')}${e.paso_en_ruta ? ' <small>(paso ' + n(e.paso_en_ruta) + ' de la ruta)</small>' : ''}</dd>
            <dt>Cobro estimado</dt><dd>${num(e.dias_restantes_est) != null ? '<b>' + n(e.fecha_cobro_est) + '</b> · faltan ~' + n(e.dias_restantes_est) + ' días hábiles' + (e.calidad_estimacion === 'debil' ? ' <span class="chip debil">estimación débil</span>' : '') : 'Sin proyección' + (e.etapa === 'Fuera de ruta' ? ': la oficina no está en la ruta de cobro' : '')}</dd>
            <dt>Última consulta</dt><dd>${n(e.ultima_consulta)}</dd>
          </dl>
        </div>
        <div class="card" style="margin-top:16px"><h2>Recorrido</h2>
          <ol class="tiempo">${movs.map((m, i) => `<li class="${esc(m.origen)}${i === movs.length - 1 ? ' actual' : ''}"><b>${n(m.fecha_pase)}</b> ${esc(bonitoOf(m.oficina))}${m.dias_en_oficina_anterior !== '' && m.dias_en_oficina_anterior != null ? ' <small>(' + n(m.dias_en_oficina_anterior) + ' días en la anterior)</small>' : ''}${m.descripcion_api ? '<span class="coment">' + esc(m.descripcion_api) + '</span>' : ''}</li>`).join('') || '<li>Sin movimientos registrados</li>'}</ol>
          <p><small>En gris: historia importada de la planilla. En negro: detectado por el bot.</small></p>
        </div>
      </div>
      <div class="card"><h2>Gestiones</h2>
        <ul class="gest">${f.gestiones.map(g => `<li><b>${n(g.fecha)}</b> ${esc(g.tipo)} — ${esc(g.texto)} <small>${esc(g.nombre)}</small></li>`).join('') || '<li>Ninguna todavía</li>'}</ul>
        ${u ? `<form id="fgest"><select name="tipo"><option value="llamé">Llamé</option><option value="fui">Fui</option><option value="nota">Nota</option></select>
          <input name="texto" placeholder="Qué pasó" required maxlength="500"><button>Agregar gestión</button></form><p id="okgest"></p>` : '<p class="vacio">Para cargar gestiones abrí desde la app INGECO.</p>'}
      </div>
    </div>`;
  $('#volver').onclick = () => render();
  const form = $('#fgest');
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    form.querySelector('button').disabled = true;
    try { await api('gestion', { expediente: exp, tipo: form.tipo.value, texto: form.texto.value }); $('#okgest').textContent = 'Gestión guardada'; ficha(exp); }
    catch (e) { $('#okgest').textContent = e.message; form.querySelector('button').disabled = false; }
  };
}

async function renderStats() {
  $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  let s;
  try { s = await api('estadisticas'); } catch (e) { $('#vista').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; return; }
  const ofs = s.oficinas.filter(o => Number(o.casos)).sort((a, b) => Number(b.mediana_dias) - Number(a.mediana_dias));
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
  let acumD = 0;
  const lineaHtml = pasos.length ? `
    <div class="linea">${pasos.map(p => `<div class="seg ${esc(p.etapa)}${p.debil ? ' debil' : ''}" style="flex:${Math.max(p.dias, 0.6)}" title="${esc(p.oficina)}: ${n(p.dias)} días hábiles${p.debil ? ' (provisorio)' : ''}">${p.dias >= 2 ? (p.debil ? '"' + n(p.dias) + ' d"' : n(p.dias) + ' d') : ''}</div>`).join('')}</div>
    <div class="leyenda"><span><i style="background:#5eead4"></i>Preliminar</span><span><i style="background:#2dd4bf"></i>Media</span><span><i style="background:var(--teal)"></i>Final</span><span><i style="background:#115e59"></i>Cobro</span><span><i style="background:#999;background-image:repeating-linear-gradient(45deg,transparent 0 3px,#fff 3px 5px)"></i>rayado y "entre comillas": dato provisorio, menos de ${n(s.min_casos || 5)} casos</span></div>
    <ul class="pasos">${pasos.map((p, i) => { acumD += p.dias; return `<li><span class="n">${i + 1}.</span><span>${esc(p.oficina)} <small class="n">${esc(p.etapa)} · ${casosTxt(p.key, p.casos)}</small></span><span class="d">${p.debil ? '<b>"' + n(p.dias) + '"</b> d' : '<b>' + n(p.dias) + '</b> d'}</span><span class="acum">día ${n(acumD)}</span></li>`; }).join('')}</ul>
    <p><small>De punta a punta, un expediente tipo tarda <b>${n(totalTipo)} días hábiles</b> (unas ${n(Math.round(totalTipo / 5))} semanas). Se puede editar la ruta en la hoja RUTAS de la planilla de datos.</small></p>
    ${pasos.some(p => p.etapa === 'Cobro' && p.debil) ? '<p><small><b>Tesorería va "entre comillas"</b>: por Tesorería pasaron ' + n(lleg['TESORERIA GENERAL'] || 0) + ' expedientes, pero la planilla casi nunca registró la fecha en que salieron (se cobraron), así que la duración solo se pudo medir en ' + n((statsOf['TESORERIA GENERAL'] || {}).casos || 0) + '. El bot la mide desde ahora cada vez que un expediente se marca como cobrado en OBRAS INGECO; cuando junte ' + n(s.min_casos || 5) + ' casos el dato pasa a ser firme.</small></p>' : ''}` : '<p class="vacio">No hay ruta cargada.</p>';
  $('#vista').innerHTML = `
    <section class="tiles">
      <div class="tile"><small>Expediente tipo (ruta)</small><b>${n(totalTipo)} días hábiles</b><span>sumando la mediana de cada oficina</span></div>
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
if (!window.INGECO_USUARIO && !DEV) sinAcceso(); else { cargar(); setInterval(cargar, 5 * 60 * 1000); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
