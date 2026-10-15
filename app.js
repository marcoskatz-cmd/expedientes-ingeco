const API_URL = 'https://script.google.com/macros/s/__DEPLOYMENT_ID__/exec';
const $ = s => document.querySelector(s);
let DATA = null, VISTA = 'tablero', Q = '';
const DEV = location.search.includes('dev=1');

async function api(accion, payload) {
  // dev=1: lee respuestas simuladas de tests/mock (solo para desarrollo local).
  const r = DEV ? await fetch('../tests/mock/' + accion + '.json')
    : await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion, payload: payload || {} }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Falló la consulta');
  return j;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const semaforo = e => e.error || !e.oficina_actual ? 'gris' : (Number(e.dias_quieto) > DATA.umbral ? 'ambar' : 'teal');

function sinAcceso() {
  $('#vista').innerHTML = '<p class="vacio">Abrí este sistema desde la app INGECO.</p>';
}

async function cargar() {
  try {
    DATA = await api('estado');
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

function barras(obj, total) {
  return '<div class="barras">' + Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="fila"><span>${esc(k) || 'Sin dato'}</span><div class="barra"><i style="width:${total ? v / total * 100 : 0}%"></i></div><b>${pesos(v)}</b></div>`).join('') + '</div>';
}

function renderTablero() {
  const act = DATA.estados.filter(e => e.oficina_actual);
  const porEtapa = {}, porOficina = {};
  act.forEach(e => { porEtapa[e.etapa] = (porEtapa[e.etapa] || 0) + Number(e.monto); porOficina[e.oficina_actual] = (porOficina[e.oficina_actual] || 0) + Number(e.monto); });
  const quietos = act.filter(e => Number(e.dias_quieto) > DATA.umbral);
  const total = act.reduce((s, e) => s + Number(e.monto), 0);
  const prox = act.filter(e => e.dias_restantes_est !== '' && Number(e.dias_restantes_est) <= 22).reduce((s, e) => s + Number(e.monto), 0);
  const sinDato = DATA.estados.length - act.length;
  $('#vista').innerHTML = `
    <section class="tiles">
      <div class="tile"><small>A cobrar</small><b>${pesos(total)}</b><span>${act.length} expedientes${sinDato ? ' · ' + sinDato + ' sin dato' : ''}</span></div>
      <div class="tile ${quietos.length ? 'ambar' : ''}"><small>Quietos +${DATA.umbral} días</small><b>${quietos.length}</b><span>${pesos(quietos.reduce((s, e) => s + Number(e.monto), 0))}</span></div>
      <div class="tile teal"><small>Cobro estimado 30 días</small><b>${pesos(prox)}</b></div>
    </section>
    <h2>Por etapa</h2>${barras(porEtapa, total)}
    <h2>Por oficina</h2>${barras(porOficina, total)}`;
}

function renderLista() {
  const q = Q.toLowerCase();
  const lista = DATA.estados.filter(e => !q || (e.nombre_obra + ' ' + e.expediente + ' ' + e.oficina_actual).toLowerCase().includes(q))
    .sort((a, b) => Number(b.dias_quieto || 0) - Number(a.dias_quieto || 0));
  $('#vista').innerHTML = `<input id="buscar" placeholder="Buscar obra, expediente u oficina" value="${esc(Q)}">
    <ul class="lista">${lista.map(e => `<li class="${semaforo(e)}" data-exp="${esc(e.expediente)}">
      <b>${esc(e.nombre_obra)}</b><span>${esc(e.expediente)} · ${pesos(e.monto)}</span>
      <span>${e.oficina_actual ? esc(e.oficina_actual) + ' · ' + e.dias_quieto + ' días' : 'Sin dato: ' + esc(e.error)}</span>
      <span>${e.dias_restantes_est !== '' && e.dias_restantes_est != null ? 'Faltan ~' + e.dias_restantes_est + ' días hábiles (' + e.fecha_cobro_est + ')' + (e.calidad_estimacion === 'debil' ? ' · estimación débil' : '') : esc(e.etapa || '')}</span>
    </li>`).join('') || '<li class="vacio">Nada que mostrar</li>'}</ul>`;
  const inp = $('#buscar');
  inp.oninput = ev => { Q = ev.target.value; const pos = inp.selectionStart; renderLista(); const i2 = $('#buscar'); i2.focus(); i2.setSelectionRange(pos, pos); };
  document.querySelectorAll('.lista li[data-exp]').forEach(li => li.onclick = () => ficha(li.dataset.exp));
}

async function ficha(exp) {
  $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  let f;
  try { f = await api('ficha', { expediente: exp }); } catch (e) { $('#vista').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; return; }
  const e = f.estado, u = window.INGECO_USUARIO;
  $('#vista').innerHTML = `<button class="volver" id="volver">← Volver</button>
    <h2>${esc(e.nombre_obra)}</h2><p>${esc(e.expediente)} · ${pesos(e.monto)} · ${esc(e.tipo_contrato)}</p>
    <p class="estado ${semaforo(e)}">${e.oficina_actual ? 'En <b>' + esc(e.oficina_actual) + '</b> desde ' + e.desde + ' (' + e.dias_quieto + ' días hábiles)' : 'Sin dato: ' + esc(e.error)}</p>
    <p>${e.dias_restantes_est !== '' && e.dias_restantes_est != null ? 'Cobro estimado: <b>' + e.fecha_cobro_est + '</b> (~' + e.dias_restantes_est + ' días hábiles' + (e.calidad_estimacion === 'debil' ? ', estimación débil' : '') + ')' : 'Sin proyección: ' + esc(e.etapa || '')}</p>
    <h3>Recorrido</h3><ol class="tiempo">${f.movimientos.map(m => `<li class="${esc(m.origen)}"><b>${m.fecha_pase}</b> ${esc(m.oficina)}${m.dias_en_oficina_anterior !== '' ? ' <small>(' + m.dias_en_oficina_anterior + ' días en la anterior)</small>' : ''}</li>`).join('') || '<li>Sin movimientos registrados</li>'}</ol>
    <h3>Gestiones</h3><ul class="gest">${f.gestiones.map(g => `<li><b>${g.fecha}</b> ${esc(g.tipo)} — ${esc(g.texto)} <small>${esc(g.nombre)}</small></li>`).join('') || '<li>Ninguna todavía</li>'}</ul>
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
  $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  let s;
  try { s = await api('estadisticas'); } catch (e) { $('#vista').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; return; }
  const ofs = s.oficinas.filter(o => o.casos).sort((a, b) => b.mediana_dias - a.mediana_dias);
  const max = Math.max(1, ...ofs.map(o => Number(o.mediana_dias)));
  $('#vista').innerHTML = `<section class="tiles"><div class="tile"><small>Inicio → Tesorería (mediana)</small><b>${s.total.mediana} días</b><span>${s.total.casos} casos · p25 ${s.total.p25} · p75 ${s.total.p75}</span></div></section>
    <h2>Días hábiles por oficina (mediana)</h2><div class="barras">${ofs.map(o => `<div class="fila"><span>${esc(o.nombre_canonico)}</span><div class="barra"><i style="width:${o.mediana_dias / max * 100}%"></i></div><b>${o.mediana_dias} d · ${o.casos} casos</b></div>`).join('') || '<p class="vacio">Todavía no hay historia suficiente.</p>'}</div>`;
}

document.querySelectorAll('.barra button').forEach(b => b.onclick = () => { VISTA = b.dataset.v; document.querySelectorAll('.barra button').forEach(x => x.classList.toggle('activo', x === b)); render(); });

if (!window.INGECO_USUARIO && !DEV) sinAcceso(); else { cargar(); setInterval(cargar, 5 * 60 * 1000); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
