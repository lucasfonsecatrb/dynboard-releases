/* DynBoard — quadro de referências em vídeo ligado por cabos. */
(async function () {
'use strict';
const store = window.DynStore, Z = window.DynZip;
const DESK = store.kind === 'desktop';
const PAL = ['#EE4E9B', '#F5B800', '#2B50E8', '#17A26A', '#F2541B', '#8A5CF6'];
const CAB = ['#F2541B', '#2B50E8', '#F5B800', '#EE4E9B', '#17A26A', '#1B1C1F'];
const PLAT = [
  { k: 'youtube', name: 'YouTube', re: /youtu\.?be/i, t: 'Vídeo do YouTube' },
  { k: 'instagram', name: 'Instagram', re: /instagram\./i, t: 'Reel do Instagram' },
  { k: 'tiktok', name: 'TikTok', re: /tiktok\./i, t: 'Vídeo do TikTok' },
  { k: 'vimeo', name: 'Vimeo', re: /vimeo\./i, t: 'Vídeo do Vimeo' },
  { k: 'pinterest', name: 'Pinterest', re: /pinterest\.|pin\.it/i, t: 'Pin do Pinterest' },
  { k: 'x', name: 'X', re: /(\/\/|\.|^)(twitter|x)\.com/i, t: 'Post do X' },
  { k: 'behance', name: 'Behance', re: /behance\./i, t: 'Projeto do Behance' },
  { k: 'web', name: 'Web', re: /.*/, t: 'Referência da web' }];
const FILE_PLAT = { k: 'file', name: 'Arquivo', t: 'Vídeo' };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const platOf = k => k === 'file' ? FILE_PLAT : (PLAT.find(p => p.k === k) || PLAT[PLAT.length - 1]);
const detect = url => PLAT.find(p => p.re.test(url));
function domain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u || ''; } }
const fmtDur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const slug = s => (s || 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'projeto';
function thumbBg(seed) {
  const h = hash(seed), a = h % 360, b = (a + 50 + (h >> 4) % 140) % 360;
  return `radial-gradient(circle at ${15 + h % 70}% ${20 + (h >> 3) % 60}%,hsla(${a},90%,62%,.95),transparent 55%),radial-gradient(circle at ${(h >> 5) % 100}% ${(h >> 7) % 100}%,hsla(${b},88%,56%,.9),transparent 52%),linear-gradient(135deg,hsl(${a},50%,22%),hsl(${b},55%,14%))`;
}
function toast(t, act) {
  const el = $('#toast'); el.textContent = t; el.classList.toggle('act', !!act);
  if (act) { const b = document.createElement('button'); b.textContent = act.label; b.onclick = () => { el.classList.remove('on', 'act'); act.fn(); }; el.appendChild(b); }
  el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on', 'act'), act ? 5000 : 2600);
}
function busy(text) {
  const d = document.createElement('div'); d.className = 'busy'; d.innerHTML = `<div>${esc(text)}</div>`; document.body.appendChild(d);
  return () => d.remove();
}
const errText = e => {
  const m = String(e && e.message || e || '');
  if (/NOT_DYNBOARD|NOT_A_ZIP|BAD_ZIP/.test(m)) return 'Esse arquivo não é um projeto do DynBoard.';
  if (/NEWER_VERSION/.test(m)) return 'Esse arquivo foi feito numa versão mais nova do DynBoard. Atualize o app.';
  if (/ZIP_TOO_BIG/.test(m)) return 'O projeto passa de 4 GB. Exporte como "só links" ou divida em projetos menores.';
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Algo deu errado.';
};

/* ---------- preferências locais ---------- */
let prefs = {};
try { prefs = JSON.parse(localStorage.getItem('dynboard.prefs') || '{}'); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem('dynboard.prefs', JSON.stringify(prefs)); } catch (e) {} };

/* ---------- dados ---------- */
const S = { projects: {}, order: [], trash: {} };
const TRASH_DAYS = 30;
function normalize(p) {
  p.nodes = p.nodes || []; p.edges = p.edges || []; p.strokes = p.strokes || []; if (p.parent === undefined) p.parent = null; p.color = p.color || PAL[0]; p.name = p.name || 'Sem nome';
  for (const n of p.nodes) if (n.type === 'image') { n.tags = n.tags || []; n.notes = n.notes || ''; if (n.status !== 'done') n.status = n.file ? 'done' : 'missing'; }
  for (const n of p.nodes) if (n.type === 'video') {
    n.tags = n.tags || []; n.notes = n.notes || '';
    if (n.status === 'downloading' || n.status === 'importing' || n.status === 'queued') n.status = n.file ? 'done' : (n.url ? 'link' : 'missing');
    if (!n.status) n.status = n.file ? 'done' : (n.url ? 'link' : 'missing');
  }
  return p;
}
function sortOrder() { S.order = Object.keys(S.projects).sort((a, b) => (S.projects[b].updated || 0) - (S.projects[a].updated || 0)); }
try {
  for (const p of await store.loadAll()) {
    normalize(p);
    if (p.trashed && Date.now() - p.trashed > TRASH_DAYS * 864e5) { store.deleteProject(p.id).catch(() => {}); continue; }
    if (p.trashed) S.trash[p.id] = p; else S.projects[p.id] = p;
  }
} catch (e) { console.error(e); }
sortOrder();
/* Limpeza: apaga arquivos de mídia que nenhum card usa mais (cards apagados, downloads cancelados, arquivos trocados).
   Roda só ao abrir o app, para o Ctrl+Z da sessão sempre conseguir trazer um card de volta com o vídeo. */
if (store.gcMedia) setTimeout(() => { for (const P of [...Object.values(S.projects), ...Object.values(S.trash)]) store.gcMedia(P.id, Z.mediaOf(P)).catch(() => {}); }, 4000);

const dirty = new Set();
function markDirty(pid = cur) { if (!pid || !S.projects[pid]) return; dirty.add(pid); clearTimeout(markDirty.t); markDirty.t = setTimeout(flush, 400); }
function touch(pid = cur) { const P = S.projects[pid]; if (!P) return; P.updated = Date.now(); markDirty(pid); }
async function flush() {
  clearTimeout(markDirty.t);
  const ids = [...dirty]; dirty.clear();
  for (const id of ids) if (S.projects[id]) { try { await store.saveProject(S.projects[id]); } catch (e) { toast('Não foi possível salvar: ' + errText(e)); } }
}
window.addEventListener('beforeunload', () => { flush(); });
if (store.onBeforeClose) store.onBeforeClose(() => flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* ---------- arquivos de mídia ---------- */
const murl = new Map(), mpending = new Set();
const mkey = (pid, name) => pid + '/' + name;
function loadMedia(pid, name) {
  const k = mkey(pid, name);
  if (murl.has(k) || mpending.has(k)) return;
  mpending.add(k);
  store.mediaURL(pid, name).then(u => {
    mpending.delete(k);
    if (!u) return;
    murl.set(k, u);
    if (pid === cur) { for (const n of proj().nodes) if (n.file === name || n.thumb === name) refreshNode(n.id); if (sel && sel.kind === 'node') { const m = getNode(sel.id); if (m && (m.file === name || m.thumb === name) && !$('#panel video, #panel .pimg img')) renderPanel(); } }
  }).catch(() => mpending.delete(k));
}
function forgetMedia(pid) { for (const k of [...murl.keys()]) if (k.startsWith(pid + '/')) murl.delete(k); }

let cur = null, sel = null, trail = [], playing = new Set(), sizes = {}, drag = null, tmp = null, rewiring = null, query = '';
let msel = new Set(), ssel = new Set(); /* seleção múltipla: cards e rabiscos */
const vp = $('#vp'), world = $('#world'), wires = $('#wires'), nodesEl = $('#nodes'), ink = $('#ink');
const proj = () => S.projects[cur];
const V = () => proj().view;
const getNode = id => proj().nodes.find(n => n.id === id);
const nodeIn = (pid, id) => S.projects[pid] && S.projects[pid].nodes.find(n => n.id === id);
const imgH = n => Math.round(Math.max(110, Math.min(340, 226 * (n.w && n.h ? n.h / n.w : 0.62))));
const vidH = n => Math.round(Math.max(100, Math.min(360, 226 * (n.w && n.h ? n.h / n.w : 0.5625))));
function approx(n) { return n.type === 'image' ? { w: 236, h: imgH(n) + 50 } : n.type === 'video' ? { w: 236, h: vidH(n) + 84 } : n.type === 'folder' ? { w: 214, h: 150 } : { w: 214, h: 90 }; }
const size = n => { const s = sizes[n.id]; return s && s.w > 0 && s.h > 0 ? s : approx(n); };
function toWorld(cx, cy) { const r = vp.getBoundingClientRect(), v = V(); return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }; }
function vpCenter() { const r = vp.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
const refs = P => P.nodes.filter(n => n.type === 'video' || n.type === 'image').length;
const isImg = f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
const isVid = f => /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(f.name);

/* ---------- navegação ---------- */
function route(id) {
  if (!S.projects[id]) id = S.projects[prefs.last] ? prefs.last : S.order[0];
  if (drawMode) setDrawMode(null);
  cur = id || null; sel = null; msel = new Set(); ssel = new Set();
  if (cur) { prefs.last = cur; for (const a of ancestors(cur)) delete prefs.collapsed[a]; savePrefs(); }
  const i = trail.indexOf(cur); if (i >= 0) trail = trail.slice(0, i);
  renderSide(); showBoard();
}
function openProject(id, via) {
  if (via && cur && cur !== id) trail.push(cur); else if (!via) trail = [];
  if (innerWidth <= 820) { document.body.classList.add('nosb'); syncSb(); }
  flush(); route(id);
}
function createProject(name) {
  const id = uid('p');
  S.projects[id] = { id, name, color: PAL[Object.keys(S.projects).length % PAL.length], updated: Date.now(), created: Date.now(), nodes: [], edges: [], strokes: [], parent: null, view: null };
  sortOrder(); markDirty(id); return id;
}

/* ---------- barra lateral ---------- */
/* Hierarquia: cada projeto pode ter um "pai", como os objetos no Cinema 4D. */
const parentOf = id => { const p = S.projects[id] && S.projects[id].parent; return p && p !== id && S.projects[p] ? p : null; };
const byName = (a, b) => S.projects[a].name.localeCompare(S.projects[b].name, 'pt-BR', { numeric: true, sensitivity: 'base' });
const childrenOf = id => Object.keys(S.projects).filter(c => parentOf(c) === id).sort(byName);
function descendants(id) { const out = [], q = [id]; while (q.length) { for (const c of childrenOf(q.shift())) { out.push(c); q.push(c); } } return out; }
function ancestors(id) { const out = []; let p = parentOf(id); while (p && !out.includes(p)) { out.unshift(p); p = parentOf(p); } return out; }
prefs.collapsed = prefs.collapsed || {};
function rowHTML(id, depth) {
  const P = S.projects[id], kids = childrenOf(id).length, open = !prefs.collapsed[id];
  return `<div class="pi ${id === cur ? 'on' : ''}" data-p="${id}" role="button" tabindex="0" draggable="true" style="padding-left:${4 + depth * 16}px">
    ${kids ? `<button class="car ${open ? 'exp' : ''}" data-car="${id}" aria-label="${open ? 'Fechar' : 'Abrir'} subprojetos"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '<span class="car0"></span>'}
    <i style="background:${P.color}"></i><span class="nm">${esc(P.name)}</span><span class="ct num">${refs(P)}</span><button class="rm" data-menu="${id}" title="Opções do projeto" aria-label="Opções de ${esc(P.name)}">⋯</button></div>`;
}
function renderSide() {
  const box = $('#plist');
  if (!S.order.length) { box.innerHTML = `<div class="none">Você ainda não tem projetos.</div>`; return; }
  if (query) {
    const ids = S.order.filter(id => S.projects[id].name.toLowerCase().includes(query)).sort(byName);
    box.innerHTML = ids.length ? ids.map(id => rowHTML(id, 0)).join('') : `<div class="none">Nenhum projeto com esse nome.</div>`;
    return;
  }
  const walk = (id, depth) => rowHTML(id, depth) + (prefs.collapsed[id] ? '' : childrenOf(id).map(c => walk(c, depth + 1)).join(''));
  box.innerHTML = Object.keys(S.projects).filter(id => !parentOf(id)).sort(byName).map(id => walk(id, 0)).join('');
}
function setParent(id, parent) {
  const P = S.projects[id]; if (!P) return;
  parent = parent || null;
  if (parent && (parent === id || descendants(id).includes(parent))) { toast('Não dá para colocar um projeto dentro dele mesmo.'); return; }
  if ((P.parent || null) === parent) return;
  P.parent = parent; markDirty(id);
  if (parent) delete prefs.collapsed[parent]; savePrefs();
  renderSide(); if (cur) renderTitle();
  toast(parent ? `“${P.name}” agora está dentro de “${S.projects[parent].name}”` : `“${P.name}” voltou para o topo`);
}
$('#plist').addEventListener('click', e => {
  const car = e.target.closest('[data-car]');
  if (car) { e.stopPropagation(); const id = car.dataset.car; if (prefs.collapsed[id]) delete prefs.collapsed[id]; else prefs.collapsed[id] = true; savePrefs(); renderSide(); return; }
  const m = e.target.closest('[data-menu]'); if (m) { e.stopPropagation(); projectMenu(m.dataset.menu); return; }
  const p = e.target.closest('[data-p]'); if (p) openProject(p.dataset.p);
});
$('#plist').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.pi')) openProject(e.target.dataset.p); });
/* arrastar projeto para dentro de outro */
let dragPid = null;
$('#plist').addEventListener('dragstart', e => {
  const row = e.target.closest('.pi'); if (!row) return;
  dragPid = row.dataset.p; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-dynproject', dragPid);
  row.classList.add('dragsrc'); $('#side').classList.add('dragging-proj');
});
function endProjDrag() { dragPid = null; $('#side').classList.remove('dragging-proj', 'droptop'); document.querySelectorAll('.pi.dragsrc,.pi.dropin').forEach(el => el.classList.remove('dragsrc', 'dropin')); }
document.addEventListener('dragend', endProjDrag);
$('#plist').addEventListener('dragover', e => {
  if (!dragPid) return;
  const row = e.target.closest('.pi'), root = !row && e.target.closest('#plist');
  document.querySelectorAll('.pi.dropin').forEach(el => el.classList.remove('dropin')); $('#side').classList.remove('droptop');
  if (row && row.dataset.p !== dragPid && !descendants(dragPid).includes(row.dataset.p)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('dropin'); }
  else if (root && parentOf(dragPid)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; $('#side').classList.add('droptop'); }
});
$('#plist').addEventListener('drop', e => {
  if (!dragPid) return; e.preventDefault(); e.stopPropagation();
  const row = e.target.closest('.pi'), id = dragPid; endProjDrag();
  setParent(id, row && row.dataset.p !== id ? row.dataset.p : null);
});
function projectMenu(id) {
  const P = S.projects[id], blocked = new Set([id, ...descendants(id)]);
  const opts = Object.keys(S.projects).filter(x => !blocked.has(x)).sort(byName);
  const label = x => [...ancestors(x), x].map(a => S.projects[a].name).join(' / ');
  modal({ title: esc(P.name), ok: 'Salvar', body: `
    <div class="fld"><label for="m-par">Fica dentro de</label><select id="m-par" name="par"><option value="">Nenhum (no topo da lista)</option>${opts.map(x => `<option value="${x}" ${parentOf(id) === x ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}</select></div>
    <div class="muted">Dica: você também pode arrastar o projeto na lista e soltar em cima de outro. Para tirar de dentro, solte no espaço vazio da lista.</div>
    <button type="button" class="btn del" id="m-delp">Excluir projeto…</button>`,
    onOpen: () => { $('#m-delp').onclick = () => { closeModal(); delProjectModal(id); }; },
    onOk: f => { setParent(id, f.par.value || null); } });
}
$('#q').oninput = e => { query = e.target.value.trim().toLowerCase(); renderSide(); };
function syncSb() { $('#sb-open').hidden = !document.body.classList.contains('nosb'); }
$('#sb-close').onclick = () => { document.body.classList.add('nosb'); prefs.nosb = true; savePrefs(); syncSb(); };
$('#sb-open').onclick = () => { document.body.classList.remove('nosb'); prefs.nosb = false; savePrefs(); syncSb(); };
if (innerWidth <= 820 || prefs.nosb) document.body.classList.add('nosb');
syncSb();
$('#newp').onclick = newProjectModal;
$('#btn-import').onclick = () => startImport();
$('#btn-settings').onclick = settingsModal;
$('#btn-trash').onclick = trashModal;
renderTrashBtn();
$('#envnote').textContent = DESK ? '' : 'Versão web: os projetos ficam guardados neste aparelho.';
$('#gobtn').textContent = DESK ? 'Baixar' : 'Adicionar';

/* ---------- quadro ---------- */
function showBoard() {
  const has = !!cur;
  ['titlechip', 'rightchip', 'dock'].forEach(i => $('#' + i).hidden = !has); $('#help').hidden = true;
  if (!has) {
    nodesEl.innerHTML = ''; wires.innerHTML = ''; ink.innerHTML = ''; $('#back').hidden = true; renderPanel();
    const em = $('#empty'); em.hidden = false;
    em.innerHTML = `<h3>Crie seu primeiro projeto</h3><p>Cada projeto é um quadro onde você junta e liga as referências em vídeo. Se alguém te mandou um arquivo .dynboard, importe ele.</p><div style="display:flex;gap:8px;justify-content:center"><button class="btn pri" id="em-new">Novo projeto</button><button class="btn" id="em-imp">Importar .dynboard</button></div>`;
    $('#em-new').onclick = newProjectModal; $('#em-imp').onclick = () => startImport(); return;
  }
  const P = proj(), fresh = !P.view; if (fresh) P.view = { x: 0, y: 0, k: 1 };
  renderTitle();
  const bk = $('#back'), prev = trail[trail.length - 1]; bk.hidden = !S.projects[prev]; if (!bk.hidden) $('span', bk).textContent = S.projects[prev].name;
  renderBoard(); if (fresh) fit(false); renderPanel();
}
function renderTitle() {
  const P = proj(); if (!P) return;
  $('#pdot').style.background = P.color; const pn = $('#pname'); if (document.activeElement !== pn) { pn.value = P.name; pn.size = Math.max(6, P.name.length); }
  $('#anc').innerHTML = ancestors(cur).map(a => `<button class="anc" data-go="${a}" title="Abrir ${esc(S.projects[a].name)}">${esc(S.projects[a].name)}</button><span class="asep">/</span>`).join('');
}
$('#anc').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) openProject(b.dataset.go); });
$('#pname').oninput = e => { proj().name = e.target.value; e.target.size = Math.max(6, e.target.value.length); touch(); renderSide(); };
$('#pname').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
$('#back').onclick = () => { const id = trail.pop(); if (id) route(id); };
$('#helpbtn').onclick = () => { $('#help').hidden = !$('#help').hidden; };
$('#btn-export').onclick = exportModal;
function updCounts() {
  if (!cur) return; const P = proj();
  $('#counts').textContent = plural(refs(P), 'referência', 'referências') + ', ' + plural(P.edges.length, 'cabo', 'cabos');
  const em = $('#empty'); em.hidden = P.nodes.length > 0 || P.strokes.length > 0;
  if (!em.hidden) em.innerHTML = `<h3>Quadro vazio</h3><p>${DESK ? 'Cole um link de vídeo na barra abaixo. Ele é baixado e vira um card que você liga aos outros.' : 'Cole um link ou adicione um vídeo do seu aparelho. Cada um vira um card que você liga aos outros.'}</p>`;
  renderSide();
}

const VBTN = '<button class="vbtn" data-act="view" title="Ver grande" aria-label="Ver grande"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button>';
const PLAY_SVG = '<div class="play"><svg viewBox="0 0 24 24" width="17"><path d="M8 5v14l11-7z" fill="#1B1C1F"/></svg></div>';
const LINK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
function thumbHTML(n, pid = cur, card = false) {
  const p = platOf(n.platform), seed = n.url || n.id, h = hash(seed);
  let tu = null; if (n.thumb) { tu = murl.get(mkey(pid, n.thumb)); if (!tu) loadMedia(pid, n.thumb); }
  let vu = null; if (playing.has(n.id) && n.file) { vu = murl.get(mkey(pid, n.file)); if (!vu) loadMedia(pid, n.file); }
  const over = n.status === 'link' ? `<div class="ph-icon">${LINK_SVG}Só o link</div>` : n.status === 'missing' ? `<div class="ph-icon">Sem arquivo</div>` : n.status === 'error' ? `<div class="ph-icon">Não baixou</div>` : '';
  return `<div class="thumb ${n.status === 'downloading' || n.status === 'importing' || n.status === 'queued' ? 'loading' : ''} ${vu ? 'playing' : ''}" style="background:${thumbBg(seed)};${card ? `height:${vidH(n)}px` : ''}">
  ${tu ? `<img src="${esc(tu)}" alt="" draggable="false">` : `<svg class="shp" viewBox="0 0 236 128" preserveAspectRatio="none"><circle cx="${40 + h % 160}" cy="${28 + (h >> 4) % 60}" r="${14 + (h >> 8) % 34}" fill="rgba(255,255,255,.12)"/><path d="M0 ${86 + (h >> 3) % 30} Q118 ${40 + (h >> 6) % 50} 236 ${80 + (h >> 9) % 38} L236 128 L0 128Z" fill="rgba(0,0,0,.3)"/></svg>`}
  ${vu ? `<video class="inl" src="${esc(vu)}" muted loop autoplay playsinline></video>` : ''}
  <span class="src">${p.name}</span>${n.dur ? `<span class="dur num">${fmtDur(n.dur)}</span>` : ''}${n.status === 'done' && !vu ? PLAY_SVG : ''}${n.status === 'done' && n.file ? VBTN : ''}${over}</div>`;
}
function stateHTML(n) {
  const attach = '<button class="sbtn ghost" data-act="attach">Anexar arquivo</button>';
  switch (n.status) {
    case 'done': return `<div class="nmeta">${n.url ? esc(domain(n.url)) : 'Arquivo do aparelho'}</div>`;
    case 'downloading': return `<div class="dl"><div class="bar"><b style="width:${n.progress || 0}%"></b></div><span class="num">Baixando ${Math.floor(n.progress || 0)}%</span></div>`;
    case 'importing': return `<div class="state">Preparando o arquivo… vídeos grandes podem demorar.</div>`;
    case 'queued': return `<div class="nmeta">${esc(domain(n.url))}</div><div class="state">Na fila para baixar</div>`;
    case 'error': return `<div class="state err">Não deu para baixar.</div><div class="state">${store.canDownload ? '<button class="sbtn" data-act="download">Tentar de novo</button>' : ''}${attach}</div>`;
    case 'missing': return `<div class="state">O arquivo não veio junto.</div><div class="state">${attach}</div>`;
    default: return `<div class="nmeta">${esc(domain(n.url))}</div><div class="state">${store.canDownload ? '<button class="sbtn" data-act="download">Baixar</button>' : ''}${attach}</div>`;
  }
}
const JACK = '<div class="jack" title="Arraste até outro card para ligar"></div>';
function nodeEl(n) {
  let h;
  if (n.type === 'video') h = `<div class="node video">${thumbHTML(n, cur, true)}<div class="nbody"><div class="ntitle">${esc(n.title)}</div>${stateHTML(n)}${n.tags.length ? `<div class="tags">${n.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>${JACK}</div>`;
  else if (n.type === 'image') {
    let u = null; if (n.file) { u = murl.get(mkey(cur, n.file)); if (!u) loadMedia(cur, n.file); }
    const inner = u ? `<img src="${esc(u)}" alt="" draggable="false">` : `<div class="ph-icon">${n.status === 'importing' ? 'Adicionando…' : 'Sem arquivo'}</div>`;
    h = `<div class="node image"><div class="imgw ${n.status === 'importing' ? 'loading' : ''}" style="height:${imgH(n)}px;background:${thumbBg(n.id)}">${inner}${u ? VBTN : ''}</div><div class="nbody"><div class="ntitle">${esc(n.title)}</div>${n.tags.length ? `<div class="tags">${n.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>${JACK}</div>`;
  }
  else if (n.type === 'folder') {
    const T = S.projects[n.target]; const vids = T ? T.nodes.filter(x => x.type === 'video') : [];
    h = `<div class="node folder" style="--fc:${T ? T.color : '#9a9b96'}"><div><div class="ntitle">${esc(n.title)}</div><div class="nmeta">${T ? esc(T.name) : S.trash[n.target] ? 'Projeto está na lixeira' : 'Projeto não está neste aparelho'}</div></div>
    <div class="stack">${vids.length ? vids.slice(0, 4).map(v => `<i style="background:${thumbBg(v.url || v.id)}"></i>`).join('') : '<em>Ainda sem referências</em>'}</div>
    ${T ? `<button class="open" data-open="${n.target}">Abrir projeto</button>` : ''}${JACK}</div>`;
  } else h = `<div class="node note"><div class="ntext">${esc(n.text)}</div>${JACK}</div>`;
  const w = document.createElement('div'); w.innerHTML = h; const el = w.firstElementChild; el.dataset.id = n.id; el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
  if (msel.has(n.id)) el.classList.add('sel');
  return el;
}
function measure(el) { sizes[el.dataset.id] = { w: el.offsetWidth, h: el.offsetHeight }; }
function renderBoard() { nodesEl.innerHTML = ''; sizes = {}; proj().nodes.forEach(n => nodesEl.appendChild(nodeEl(n))); [...nodesEl.children].forEach(measure); renderWires(); renderInk(); applyView(); updCounts(); }
function refreshNode(id) {
  const old = nodesEl.querySelector(`[data-id="${id}"]`); const n = getNode(id); if (!old || !n) return;
  const el = nodeEl(n); if (old.classList.contains('dragging')) el.classList.add('dragging');
  old.replaceWith(el); measure(el); renderWires();
}
function remeasure() { if (!cur) return; [...nodesEl.children].forEach(measure); renderWires(); }
try { new ResizeObserver(() => remeasure()).observe(vp); } catch (e) {}
if (document.fonts) document.fonts.ready.then(remeasure);
nodesEl.addEventListener('load', e => {
  if (e.target.tagName !== 'IMG') return; const el = e.target.closest('.node'); if (!el) return;
  const n = getNode(el.dataset.id);
  if (n && n.type === 'video' && !n.w && e.target.closest('.thumb') && e.target.naturalWidth) { n.w = e.target.naturalWidth; n.h = e.target.naturalHeight; markDirty(); refreshNode(n.id); return; }
  measure(el); renderWires();
}, true);

/* ---------- cabos ---------- */
function ctr(n) { const s = size(n); return { x: n.x + s.w / 2, y: n.y + s.h / 2 }; }
function edgePt(n, to) { const s = size(n), c = ctr(n), dx = to.x - c.x, dy = to.y - c.y; if (!dx && !dy) return c; const k = Math.min((s.w / 2 + 7) / Math.abs(dx || 1e-9), (s.h / 2 + 7) / Math.abs(dy || 1e-9)); return { x: c.x + dx * k, y: c.y + dy * k }; }
function cable(A, B) { const d = Math.hypot(B.x - A.x, B.y - A.y), sag = Math.min(110, d * .28), cx = (A.x + B.x) / 2, cy = (A.y + B.y) / 2 + sag; return { d: `M${A.x} ${A.y} Q${cx} ${cy} ${B.x} ${B.y}` }; }
const edgeColor = e => CAB[e.c ?? hash(e.id) % 5];
let PORTS = new Map();
function sideOf(n, to) { const s = size(n), c = ctr(n), dx = to.x - c.x, dy = to.y - c.y; return Math.abs(dx) / (s.w / 2) >= Math.abs(dy) / (s.h / 2) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't'); }
function computePorts() {
  PORTS = new Map(); const groups = {};
  for (const e of proj().edges) {
    if (e.id === rewiring) continue; const a = getNode(e.a), b = getNode(e.b); if (!a || !b) continue;
    for (const [n, m, end] of [[a, b, 'a'], [b, a, 'b']]) { const oc = ctr(m), sd = sideOf(n, oc), k = n.id + sd; (groups[k] = groups[k] || { n, sd, items: [] }).items.push({ e, end, key: sd === 'l' || sd === 'r' ? oc.y : oc.x }); }
  }
  for (const g of Object.values(groups)) {
    g.items.sort((p, q) => p.key - q.key); const s = size(g.n), N = g.items.length, m = 16, n = g.n;
    g.items.forEach((it, i) => {
      let t = (i + 1) / (N + 1), x, y, nx = 0, ny = 0;
      if (g.sd === 'r') t = t <= .5 ? .1 + .56 * t : .34 + .56 * t;
      if (g.sd === 'l' || g.sd === 'r') { y = n.y + m + (s.h - 2 * m) * t; x = g.sd === 'l' ? n.x - 7 : n.x + s.w + 7; nx = g.sd === 'l' ? -1 : 1; }
      else { x = n.x + m + (s.w - 2 * m) * t; y = g.sd === 't' ? n.y - 7 - (n.type === 'folder' ? 16 : 0) : n.y + s.h + 7; ny = g.sd === 't' ? -1 : 1; }
      PORTS.set(it.e.id + it.end, { x, y, nx, ny });
    });
  }
}
function endsOf(e) { const A = PORTS.get(e.id + 'a'), B = PORTS.get(e.id + 'b'); if (A && B) return { A, B }; const a = getNode(e.a), b = getNode(e.b); return { A: edgePt(a, ctr(b)), B: edgePt(b, ctr(a)) }; }
function wire(A, B) {
  const d = Math.hypot(B.x - A.x, B.y - A.y), L = Math.max(30, Math.min(150, d * .4)), sag = Math.min(60, d * .12);
  const c1 = { x: A.x + (A.nx || 0) * L, y: A.y + (A.ny || 0) * L + sag }, c2 = { x: B.x + (B.nx || 0) * L, y: B.y + (B.ny || 0) * L + sag };
  return { d: `M${A.x} ${A.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`, mx: (A.x + 3 * c1.x + 3 * c2.x + B.x) / 8, my: (A.y + 3 * c1.y + 3 * c2.y + B.y) / 8 };
}
function renderWires() {
  if (!cur) return; let o = ''; computePorts();
  for (const e of proj().edges) {
    if (e.id === rewiring) continue; const a = getNode(e.a), b = getNode(e.b); if (!a || !b) continue;
    const { A, B } = endsOf(e), c = wire(A, B), col = edgeColor(e);
    o += `<g class="${sel && sel.kind === 'edge' && sel.id === e.id ? 'sel' : ''}"><path class="shade" d="${c.d}"/><path class="w" stroke="${col}" d="${c.d}"/>${e.label ? `<text x="${c.mx}" y="${c.my - 9}">${esc(e.label)}</text>` : ''}<path class="hit" data-id="${e.id}" d="${c.d}"/>
    <circle class="plug" cx="${A.x}" cy="${A.y}" r="5.5" fill="${col}"/><circle class="plug" cx="${B.x}" cy="${B.y}" r="5.5" fill="${col}"/>
    <circle class="grab" data-id="${e.id}" data-end="a" cx="${A.x}" cy="${A.y}" r="13"><title>Puxe para soltar o cabo</title></circle><circle class="grab" data-id="${e.id}" data-end="b" cx="${B.x}" cy="${B.y}" r="13"><title>Puxe para soltar o cabo</title></circle></g>`;
  }
  if (tmp) {
    if (tmp.dashed) o += `<path class="tmp" d="${tmp.d}"/>`;
    else o += `<g><path class="shade" d="${tmp.d}"/><path class="w loose ${tmp.gone ? 'gone' : ''}" stroke="${tmp.color}" d="${tmp.d}"/><circle class="plug" cx="${tmp.A.x}" cy="${tmp.A.y}" r="5.5" fill="${tmp.color}"/><circle class="loose-plug" cx="${tmp.x}" cy="${tmp.y}" r="8" fill="${tmp.color}"/></g>`;
  }
  wires.innerHTML = o;
}

/* ---------- rabiscos ---------- */
const INK_COLORS = ['#1B1C1F', '#C4121C', '#F2541B', '#F5B800', '#17A26A', '#2B50E8', '#EE4E9B', '#FFFFFF'];
const INK_SIZES = [3, 6, 12];
let drawMode = null, drawing = null;
const pen = { c: INK_COLORS.includes(prefs.inkC) ? prefs.inkC : INK_COLORS[1], w: INK_SIZES.includes(prefs.inkW) ? prefs.inkW : INK_SIZES[1] };
const r1 = v => Math.round(v * 10) / 10;
function strokePath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]} l0.01 0`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; d += ` Q${x} ${y} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`; }
  const l = pts[pts.length - 1]; return d + ` L${l[0]} ${l[1]}`;
}
const strokeEl = st => (ssel.has(st.id) ? `<path d="${strokePath(st.p)}" stroke="#F2541B" stroke-opacity=".35" stroke-width="${st.w + 10}"/>` : '') + `<path d="${strokePath(st.p)}" stroke="${st.c}" stroke-width="${st.w}"${st.c === '#FFFFFF' ? ' style="filter:drop-shadow(0 0 1px rgba(0,0,0,.45))"' : ''}/>`;
function renderInk() {
  if (!cur) { ink.innerHTML = ''; return; }
  ink.innerHTML = proj().strokes.map(strokeEl).join('') + (drawing ? `<path id="live" d="${strokePath(drawing.p)}" stroke="${drawing.c}" stroke-width="${drawing.w}"/>` : '');
}
function liveInk() { const el = $('#live'); if (el && drawing) el.setAttribute('d', strokePath(drawing.p)); else renderInk(); }
function setDrawMode(mode) {
  drawMode = mode; drawing = null;
  vp.classList.toggle('drawing', !!mode); vp.classList.toggle('erasing', mode === 'eraser'); document.body.classList.toggle('drawing-on', !!mode);
  $('#tb-draw').classList.toggle('on', !!mode); $('#drawbar').hidden = !mode; $('#ink-eraser').classList.toggle('on', mode === 'eraser');
  if (mode) { select(null); $('#help').hidden = true; }
  renderDrawbar(); renderInk();
}
function renderDrawbar() {
  $('#ink-colors').innerHTML = INK_COLORS.map(c => `<button class="sw-c ${pen.c === c && drawMode === 'pen' ? 'on' : ''}" data-pc="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('');
  $('#ink-sizes').innerHTML = INK_SIZES.map(w => `<button class="sw-s ${pen.w === w ? 'on' : ''}" data-pw="${w}" aria-label="Espessura ${w}"><i style="width:${w + 2}px;height:${w + 2}px"></i></button>`).join('');
}
$('#ink-colors').onclick = e => { const b = e.target.closest('[data-pc]'); if (!b) return; pen.c = b.dataset.pc; prefs.inkC = pen.c; savePrefs(); setDrawMode('pen'); };
$('#ink-sizes').onclick = e => { const b = e.target.closest('[data-pw]'); if (!b) return; pen.w = +b.dataset.pw; prefs.inkW = pen.w; savePrefs(); if (drawMode !== 'pen') setDrawMode('pen'); else renderDrawbar(); };
$('#ink-eraser').onclick = () => setDrawMode(drawMode === 'eraser' ? 'pen' : 'eraser');
$('#ink-done').onclick = () => setDrawMode(null);
$('#ink-undo').onclick = () => undoAct();
$('#ink-clear').onclick = () => {
  const P = proj(); if (!P.strokes.length) return;
  checkpoint(); P.strokes = []; ssel = new Set(); touch(); renderInk(); updCounts();
  undoToast('Rabiscos apagados');
};
$('#tb-draw').onclick = () => setDrawMode(drawMode ? null : 'pen');
function eraseAt(w, removed) {
  const P = proj(), k = V().k;
  const hit = P.strokes.filter(st => { const thr = 9 / k + st.w / 2; return st.p.some(([x, y]) => Math.hypot(x - w.x, y - w.y) < thr); });
  if (!hit.length) return;
  if (!removed.length) checkpoint();
  removed.push(...hit); const gone = new Set(hit); P.strokes = P.strokes.filter(st => !gone.has(st));
  renderInk();
}

/* ---------- vista ---------- */
function applyView() { const v = V(); world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`; vp.style.backgroundSize = `${26 * v.k}px ${26 * v.k}px`; vp.style.backgroundPosition = `${v.x}px ${v.y}px`; $('#zl').textContent = Math.round(v.k * 100) + '%'; }
function animateView(x, y, k) {
  const v = V(), x0 = v.x, y0 = v.y, k0 = v.k, t0 = performance.now();
  (function f(t) { let p = Math.min(1, (t - t0) / 340); p = 1 - Math.pow(1 - p, 3); v.x = x0 + (x - x0) * p; v.y = y0 + (y - y0) * p; v.k = k0 + (k - k0) * p; applyView(); if (p < 1) requestAnimationFrame(f); else markDirty(); })(t0);
}
function fit(anim = true) {
  const P = proj(), r = vp.getBoundingClientRect(); let t;
  if (!P.nodes.length && !P.strokes.length) t = { x: r.width / 2, y: r.height / 2, k: 1 };
  else {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    P.nodes.forEach(n => { const s = size(n); x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.w); y1 = Math.max(y1, n.y + s.h); });
    P.strokes.forEach(st => st.p.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    const pad = 80, k = Math.max(.25, Math.min(1, Math.min(r.width / (x1 - x0 + pad * 2), (r.height - 130) / (y1 - y0 + pad * 2))));
    t = { x: r.width / 2 - (x0 + x1) / 2 * k, y: r.height / 2 - 6 - (y0 + y1) / 2 * k, k };
  }
  if (anim) animateView(t.x, t.y, t.k); else { Object.assign(V(), t); applyView(); markDirty(); }
}
function zoomAt(cx, cy, f) { const v = V(), r = vp.getBoundingClientRect(), mx = cx - r.left, my = cy - r.top; const k = Math.max(.2, Math.min(2.2, v.k * f)); v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; applyView(); markDirty(); }
function focusNode(id) { const n = getNode(id); if (!n) return; const c = ctr(n), r = vp.getBoundingClientRect(), k = Math.max(.7, V().k); animateView((r.width - (innerWidth > 600 ? 310 : 0)) / 2 - c.x * k, r.height / 2 - c.y * k, k); select('node', id); }
function paintSel() { nodesEl.querySelectorAll('.node').forEach(el => el.classList.toggle('sel', msel.has(el.dataset.id))); renderWires(); renderInk(); renderPanel(); }
function setSelection(nodes, strokes = []) {
  msel = new Set(nodes); ssel = new Set(strokes);
  const total = msel.size + ssel.size;
  sel = total === 0 ? null : (msel.size === 1 && !ssel.size ? { kind: 'node', id: [...msel][0] } : { kind: 'multi' });
  paintSel();
}
function select(kind, id) {
  if (kind === 'node') { if (sel && sel.kind === 'node' && sel.id === id && msel.size === 1) return; setSelection([id]); return; }
  if (kind === 'edge') { if (sel && sel.kind === 'edge' && sel.id === id) return; msel = new Set(); ssel = new Set(); sel = { kind: 'edge', id }; paintSel(); return; }
  if (!sel && !msel.size && !ssel.size) return;
  setSelection([]);
}
function toggleInSel(id) { const m = new Set(msel); if (m.has(id)) m.delete(id); else m.add(id); setSelection([...m], [...ssel]); }
function selectAll() { if (!cur) return; setSelection(proj().nodes.map(n => n.id), proj().strokes.map(s => s.id)); }
function togglePlay(id) {
  const n = getNode(id); if (!n || n.status !== 'done' || !n.file) return;
  if (playing.has(id)) playing.delete(id); else playing.add(id);
  refreshNode(id);
}

/* ---------- interação ---------- */
const touches = new Map();
vp.addEventListener('pointerdown', e => {
  if (e.button === 1 && cur) { const v = V(); drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }; vp.classList.add('panning'); vp.setPointerCapture(e.pointerId); e.preventDefault(); return; }
  if (e.button > 0 || !cur) return; const t = e.target; $('#help').hidden = true;
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      if (drag && drag.mode === 'node') nodesEl.querySelectorAll('.node.dragging').forEach(el => el.classList.remove('dragging'));
      tmp = null; rewiring = null; drawing = null; renderInk(); vp.classList.remove('panning', 'rewiring');
      const [p1, p2] = [...touches.values()], v = V(), r = vp.getBoundingClientRect();
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      drag = { mode: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, k0: v.k, wx: (cx - r.left - v.x) / v.k, wy: (cy - r.top - v.y) / v.k };
      vp.setPointerCapture(e.pointerId); renderWires(); return;
    }
  }
  if (drawMode) {
    if (t.closest('button,a,input,textarea,select')) return;
    const w = toWorld(e.clientX, e.clientY);
    if (drawMode === 'pen') { drawing = { id: uid('s'), c: pen.c, w: pen.w, p: [[r1(w.x), r1(w.y)]] }; drag = { mode: 'draw' }; renderInk(); }
    else { drag = { mode: 'erase', removed: [] }; eraseAt(w, drag.removed); }
    vp.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  const hd = t.closest('.jack'); if (hd) { drag = { mode: 'link', from: hd.closest('.node').dataset.id }; vp.setPointerCapture(e.pointerId); e.preventDefault(); return; }
  if (t.closest('button,a,input,textarea,select')) return;
  const nd = t.closest('.node');
  if (nd) {
    const n = getNode(nd.dataset.id);
    if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleInSel(n.id); return; }
    if (!msel.has(n.id)) select('node', n.id);
    const w = toWorld(e.clientX, e.clientY), P = proj();
    const group = P.nodes.filter(x => msel.has(x.id)).map(x => ({ n: x, x: x.x, y: x.y }));
    const strokes = P.strokes.filter(s => ssel.has(s.id)).map(s => ({ s, p: s.p.map(q => q.slice()) }));
    drag = { mode: 'node', id: n.id, group, strokes, wx: w.x, wy: w.y, sx: e.clientX, sy: e.clientY, moved: false, thumb: !!t.closest('.thumb') && msel.size === 1 };
    vp.setPointerCapture(e.pointerId); return;
  }
  const gr = t.closest('.grab'); if (gr) { startRewire(gr.dataset.id, gr.dataset.end, e); return; }
  const hit = t.closest('.hit');
  if (hit) {
    const ed = proj().edges.find(x => x.id === hit.dataset.id), w = toWorld(e.clientX, e.clientY), { A, B } = endsOf(ed);
    const da = Math.hypot(w.x - A.x, w.y - A.y), db = Math.hypot(w.x - B.x, w.y - B.y);
    if (Math.min(da, db) * V().k < 70) { startRewire(ed.id, da < db ? 'a' : 'b', e); return; }
    select('edge', ed.id); return;
  }
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    const w = toWorld(e.clientX, e.clientY); drag = { mode: 'marquee', x0: w.x, y0: w.y, sx: e.clientX, sy: e.clientY, add: true };
    vp.setPointerCapture(e.pointerId); return;
  }
  select(null); const v = V(); drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }; vp.classList.add('panning'); vp.setPointerCapture(e.pointerId);
});
function marqueeBox(d, e) { const w = toWorld(e.clientX, e.clientY); return { x0: Math.min(d.x0, w.x), y0: Math.min(d.y0, w.y), x1: Math.max(d.x0, w.x), y1: Math.max(d.y0, w.y) }; }
function finishMarquee(d, e) {
  if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  const b = marqueeBox(d, e), P = proj();
  const nodes = P.nodes.filter(n => { const s = size(n); return n.x < b.x1 && n.x + s.w > b.x0 && n.y < b.y1 && n.y + s.h > b.y0; }).map(n => n.id);
  const strokes = P.strokes.filter(st => st.p.some(([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)).map(st => st.id);
  setSelection([...new Set([...msel, ...nodes])], [...new Set([...ssel, ...strokes])]);
}
let hlEl = null;
function hilite(e, exclude) {
  const tg = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node');
  if (hlEl && hlEl !== tg) hlEl.classList.remove('target');
  hlEl = tg && tg.dataset.id !== exclude ? tg : null; if (hlEl) hlEl.classList.add('target');
}
vp.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  if (drag.mode === 'pinch') {
    if (touches.size < 2) return; const [p1, p2] = [...touches.values()], v = V(), r = vp.getBoundingClientRect();
    const k = Math.max(.2, Math.min(2.2, drag.k0 * Math.hypot(p1.x - p2.x, p1.y - p2.y) / drag.d0)), cx = (p1.x + p2.x) / 2 - r.left, cy = (p1.y + p2.y) / 2 - r.top;
    v.k = k; v.x = cx - drag.wx * k; v.y = cy - drag.wy * k; applyView();
  }
  else if (drag.mode === 'draw') {
    if (!drawing) return; const w = toWorld(e.clientX, e.clientY), l = drawing.p[drawing.p.length - 1];
    if (Math.hypot(w.x - l[0], w.y - l[1]) * V().k >= 2) { drawing.p.push([r1(w.x), r1(w.y)]); liveInk(); }
  }
  else if (drag.mode === 'erase') eraseAt(toWorld(e.clientX, e.clientY), drag.removed);
  else if (drag.mode === 'pan') { const v = V(); v.x = drag.vx + e.clientX - drag.sx; v.y = drag.vy + e.clientY - drag.sy; applyView(); }
  else if (drag.mode === 'node') {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    if (!drag.moved) { drag.moved = true; checkpoint(); }
    const w = toWorld(e.clientX, e.clientY), dx = w.x - drag.wx, dy = w.y - drag.wy;
    for (const g of drag.group) { g.n.x = g.x + dx; g.n.y = g.y + dy; const el = nodesEl.querySelector(`[data-id="${g.n.id}"]`); if (el) { el.style.left = g.n.x + 'px'; el.style.top = g.n.y + 'px'; el.classList.add('dragging'); } }
    if (drag.strokes.length) { for (const st of drag.strokes) st.s.p = st.p.map(([x, y]) => [r1(x + dx), r1(y + dy)]); renderInk(); }
    renderWires();
  }
  else if (drag.mode === 'marquee') {
    const r = vp.getBoundingClientRect(), m = $('#marquee'); m.hidden = false;
    Object.assign(m.style, { left: Math.min(drag.sx, e.clientX) - r.left + 'px', top: Math.min(drag.sy, e.clientY) - r.top + 'px', width: Math.abs(e.clientX - drag.sx) + 'px', height: Math.abs(e.clientY - drag.sy) + 'px' });
  }
  else if (drag.mode === 'link') { const w = toWorld(e.clientX, e.clientY), a = edgePt(getNode(drag.from), w); tmp = { dashed: true, d: cable(a, w).d }; hilite(e, drag.from); renderWires(); }
  else if (drag.mode === 'rewire') {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    if (!drag.moved) { drag.moved = true; rewiring = drag.id; vp.classList.add('rewiring'); if (sel && sel.kind === 'edge' && sel.id === drag.id) select(null); }
    const w = toWorld(e.clientX, e.clientY), A = edgePt(getNode(drag.keep), w); hilite(e, drag.keep);
    tmp = { d: cable(A, w).d, A, x: w.x, y: w.y, color: drag.color, gone: !hlEl }; renderWires();
  }
});
function startRewire(id, end, e) {
  const ed = proj().edges.find(x => x.id === id); if (!ed) return;
  drag = { mode: 'rewire', id, end, keep: end === 'a' ? ed.b : ed.a, orig: ed[end], color: edgeColor(ed), sx: e.clientX, sy: e.clientY, moved: false };
  vp.setPointerCapture(e.pointerId); e.preventDefault();
}
function retract(d, done) {
  const k = getNode(d.keep); if (!tmp || !k) { done(); return; } const x0 = tmp.x, y0 = tmp.y, t0 = performance.now();
  (function f(t) {
    let p = Math.min(1, (t - t0) / 200); p = p * p; const c = ctr(k), x = x0 + (c.x - x0) * p, y = y0 + (c.y - y0) * p, A = edgePt(k, { x, y });
    tmp = { ...tmp, A, x, y, d: cable(A, { x, y }).d, gone: true }; renderWires(); if (p < 1) requestAnimationFrame(f); else done();
  })(t0);
}
function endDrag(e) {
  touches.delete(e.pointerId);
  if (!drag) return;
  if (drag.mode === 'pinch') { if (touches.size < 2) { drag = null; markDirty(); } return; }
  const d = drag; drag = null;
  if (d.mode === 'draw') { if (drawing) { checkpoint(); proj().strokes.push(drawing); drawing = null; touch(); renderInk(); updCounts(); } return; }
  if (d.mode === 'erase') { if (d.removed.length) { touch(); updCounts(); } return; }
  if (d.mode === 'marquee') { $('#marquee').hidden = true; finishMarquee(d, e); return; }
  if (d.mode === 'pan') { vp.classList.remove('panning'); markDirty(); }
  else if (d.mode === 'node') { nodesEl.querySelectorAll('.node.dragging').forEach(el => el.classList.remove('dragging')); if (d.moved) touch(); else if (d.thumb) togglePlay(d.id); }
  else if (d.mode === 'link') {
    tmp = null; if (hlEl) hlEl.classList.remove('target'); hlEl = null;
    const tg = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY)?.closest('.node') : null;
    if (tg && tg.dataset.id !== d.from) connect(d.from, tg.dataset.id, true); renderWires();
  }
  else if (d.mode === 'rewire') {
    if (hlEl) hlEl.classList.remove('target'); hlEl = null; vp.classList.remove('rewiring');
    if (!d.moved) { select('edge', d.id); return; }
    const P = proj(), ed = P.edges.find(x => x.id === d.id), tg = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY)?.closest('.node') : null, tid = tg && tg.dataset.id;
    const finish = () => { tmp = null; rewiring = null; renderWires(); updCounts(); };
    if (e.type !== 'pointerup') { finish(); return; }
    if (tid && tid !== d.keep) {
      if (tid === d.orig) { finish(); return; }
      if (P.edges.some(x => x.id !== ed.id && ((x.a === d.keep && x.b === tid) || (x.b === d.keep && x.a === tid)))) { removeEdge(ed.id, 'Já estavam ligados, cabo extra removido'); finish(); return; }
      checkpoint(); ed[d.end] = tid; touch(); finish(); select('edge', ed.id); toast('Cabo religado'); return;
    }
    retract(d, () => { removeEdge(ed.id, 'Cabo removido'); finish(); });
  }
}
vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);
function connect(a, b, msg) {
  const P = proj(); if (P.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) { if (msg) toast('Esses dois cards já estão ligados'); return; }
  checkpoint(); const e = { id: uid('e'), a, b, c: P.edges.length % 5, label: '' }; P.edges.push(e); touch(); updCounts();
  if (msg) { select('edge', e.id); toast('Cabo ligado'); } else renderWires();
}
vp.addEventListener('click', e => {
  const b = e.target.closest('[data-open]'); if (b && S.projects[b.dataset.open]) { openProject(b.dataset.open, true); return; }
  const a = e.target.closest('[data-act]'); if (a) { const nd = a.closest('.node'); if (nd) nodeAction(a.dataset.act, nd.dataset.id); }
});
vp.addEventListener('dblclick', e => {
  if (!cur || drawMode) return;
  /* o quadro captura o ponteiro para arrastar, então o alvo real vem da posição do mouse */
  const under = document.elementFromPoint(e.clientX, e.clientY) || e.target;
  if (under.closest('button,a,input,textarea,.jack')) return;
  const f = under.closest('.node.folder');
  if (f) { const n = getNode(f.dataset.id); if (S.projects[n.target]) openProject(n.target, true); return; }
  const mv = under.closest('.node.video,.node.image'); if (mv) { openViewer(mv.dataset.id); return; }
  if (!under.closest('.node')) { const w = toWorld(e.clientX, e.clientY); addNote(w.x - 107, w.y - 40); }
});
vp.addEventListener('wheel', e => { if (!cur) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015))); }, { passive: false });
document.addEventListener('paste', e => {
  if (!cur || e.target.closest?.('input,textarea')) return;
  const files = [...(e.clipboardData.files || [])].filter(f => isImg(f) || isVid(f));
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); addLinks(t); }
});
document.addEventListener('keydown', e => {
  if (viewerId) {
    const k = e.key.toLowerCase();
    if (k === 'escape') closeViewer();
    else if (k === 'arrowleft') stepViewer(-1);
    else if (k === 'arrowright') stepViewer(1);
    else if (k === ' ') { e.preventDefault(); togglePlayV(); }
    else if (k === ',') stepFrame(-1);
    else if (k === '.') stepFrame(1);
    else if (k === 'l') toggleLoop();
    else if (k === '1' || k === '2' || k === '3') setRate(RATES[+k - 1]);
    return;
  }
  if (e.key === 'Escape') { if ($('#scrim').classList.contains('on')) closeModal(); else if (drawMode) setDrawMode(null); else if (cur) { $('#help').hidden = true; select(null); } return; }
  if (!cur || e.target.closest('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redoAct(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoAct(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'd' || e.key === 'D') { setDrawMode(drawMode ? null : 'pen'); return; }
    if ((e.key === 'e' || e.key === 'E') && drawMode) { setDrawMode(drawMode === 'eraser' ? 'pen' : 'eraser'); return; }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); if (sel.kind === 'edge') delEdge(sel.id); else delItems([...msel], [...ssel]); }
});

/* ---------- arrastar arquivos para a janela ---------- */
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; $('#drop').hidden = false; });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  const files = [...(e.dataTransfer.files || [])];
  const dyn = files.find(f => /\.dynboard$/i.test(f.name));
  if (dyn) { importFrom(dyn); return; }
  if (!cur) return;
  const pos = e.target.closest && e.target.closest('#vp') ? toWorld(e.clientX, e.clientY) : null;
  const media = files.filter(f => isImg(f) || isVid(f));
  if (media.length) { addFiles(media, pos); if (media.length < files.length) toast('Alguns arquivos ficaram de fora: o quadro aceita vídeos e imagens.'); return; }
  if (files.length) { toast('Esse tipo de arquivo não entra no quadro. Use vídeos ou imagens.'); return; }
  const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (t) addLinks(t, pos);
});

/* ---------- desfazer / refazer ----------
   Cada mudança guarda uma "foto" do quadro antes de acontecer. Ctrl+Z volta, Ctrl+Y (ou Ctrl+Shift+Z) refaz.
   Arquivos de vídeo não somem ao apagar um card: a limpeza de arquivos sem uso roda só ao abrir o app. */
const hist = {};
const LIVE = ['file', 'thumb', 'size', 'dur', 'status', 'progress', 'error', 'w', 'h'];
const snapOf = P => JSON.stringify({ nodes: P.nodes, edges: P.edges, strokes: P.strokes });
function checkpoint(pid = cur) {
  const P = S.projects[pid]; if (!P) return;
  const h = hist[pid] || (hist[pid] = { u: [], r: [] }), s = snapOf(P);
  if (h.u[h.u.length - 1] === s) return;
  h.u.push(s); if (h.u.length > 100) h.u.shift(); h.r = [];
}
function applySnap(P, s) {
  const d = JSON.parse(s), live = new Map(P.nodes.map(n => [n.id, n]));
  for (const n of d.nodes) {
    const c = live.get(n.id);
    if (c && (c.type === 'video' || c.type === 'image')) for (const k of LIVE) { if (k in c) n[k] = c[k]; else delete n[k]; }
    else if (!c && (n.status === 'downloading' || n.status === 'queued' || n.status === 'importing')) n.status = n.file ? 'done' : (n.url ? 'link' : 'missing');
  }
  P.nodes = d.nodes; P.edges = d.edges; P.strokes = d.strokes;
}
function stepHist(dir) {
  if (!cur) return; const h = hist[cur], from = dir < 0 ? 'u' : 'r', to = dir < 0 ? 'r' : 'u';
  if (!h || !h[from].length) { toast(dir < 0 ? 'Nada para desfazer' : 'Nada para refazer'); return; }
  const P = proj(); h[to].push(snapOf(P)); applySnap(P, h[from].pop());
  msel = new Set(); ssel = new Set(); sel = null; tmp = null; drawing = null;
  touch(); renderBoard(); renderPanel();
}
const undoAct = () => stepHist(-1), redoAct = () => stepHist(1);
function undoToast(msg) { toast(msg, { label: 'Desfazer', fn: undoAct }); }

/* ---------- ações ---------- */
function addLinks(text, pos) {
  const urls = text.split(/\s+/).filter(Boolean); let ok = 0; const base = pos || vpCenter();
  urls.forEach((u, i) => { if (addLink(u, { x: base.x + i * 44, y: base.y + i * 44 })) ok++; });
  if (!ok) toast('Isso não é um link. Cole o endereço do vídeo.');
  else if (store.canDownload) toast(ok > 1 ? `${ok} links adicionados. Baixando ${DL_MAX} por vez.` : 'Baixando o vídeo…');
}
function addLink(raw, c) {
  let u = raw.trim(); if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let url; try { url = new URL(u); } catch (e) { return false; } if (!url.hostname.includes('.')) return false;
  const p = detect(url.href), pid = cur;
  const n = { id: uid('n'), type: 'video', x: c.x - 118 + (Math.random() - .5) * 70, y: c.y - 105 + (Math.random() - .5) * 70, url: url.href, platform: p.k, title: p.t, dur: 0, status: 'link', progress: 0, tags: [], notes: '' };
  checkpoint(); proj().nodes.push(n); const el = nodeEl(n); nodesEl.appendChild(el); measure(el);
  if (sel && sel.kind === 'node') connect(sel.id, n.id, false);
  touch(); renderWires(); updCounts();
  if (store.canDownload) startDownload(pid, n.id);
  else toast('Link salvo. Para ter o vídeo aqui, anexe o arquivo ou baixe pelo app de computador.');
  return true;
}
/* Fila: no máximo 2 downloads ao mesmo tempo, para não travar internet lenta. */
const DL_MAX = 2, dlQueue = []; let dlActive = 0;
function startDownload(pid, nid) {
  const n = nodeIn(pid, nid); if (!n || !n.url || n.status === 'downloading' || n.status === 'queued') return;
  n.status = 'queued'; n.progress = 0; n.error = '';
  if (pid === cur) { refreshNode(nid); if (sel && sel.id === nid) renderPanel(); }
  dlQueue.push({ pid, nid }); pumpDownloads();
}
function pumpDownloads() {
  while (dlActive < DL_MAX && dlQueue.length) {
    const j = dlQueue.shift(), n = nodeIn(j.pid, j.nid);
    if (!n || n.status !== 'queued') continue;
    dlActive++; runDownload(j.pid, j.nid).finally(() => { dlActive--; pumpDownloads(); });
  }
}
function runDownload(pid, nid) {
  const n = nodeIn(pid, nid);
  n.status = 'downloading'; n.progress = 0;
  if (pid === cur) refreshNode(nid);
  return store.download(pid, nid, n.url).then(r => {
    const m = nodeIn(pid, nid); if (!m) return;
    m.status = 'done'; m.file = r.file; m.thumb = r.thumb || m.thumb; m.size = r.size || 0; m.dur = r.duration || m.dur; if (r.w && r.h) { m.w = r.w; m.h = r.h; }
    if (r.title && m.title === platOf(m.platform).t) m.title = r.title;
    touch(pid); if (pid === cur) { refreshNode(nid); if (sel && sel.id === nid) renderPanel(); }
    toast('Baixado: ' + m.title);
  }).catch(e => {
    const m = nodeIn(pid, nid); if (!m || m.status !== 'downloading') return;
    m.status = 'error'; m.error = errText(e); touch(pid);
    if (pid === cur) { refreshNode(nid); if (sel && sel.id === nid) renderPanel(); }
    toast('Não deu para baixar: ' + m.error);
  });
}
if (store.onProgress) {
  const pend = new Map(); let raf = 0;
  store.onProgress(({ pid, nid, progress }) => {
    const n = nodeIn(pid, nid); if (!n || n.status !== 'downloading') return; n.progress = progress;
    if (pid !== cur) return; pend.set(nid, 1);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; for (const id of pend.keys()) if (!(drag && drag.id === id)) refreshNode(id); pend.clear(); const ps = $('#pstat'); if (ps && sel) { const m = getNode(sel.id); if (m && m.status === 'downloading') ps.textContent = 'Baixando ' + Math.floor(m.progress) + '%'; } });
  });
}
let attachTo = null, filesPos = null;
function pickFiles(nid) { attachTo = nid ? { pid: cur, nid } : null; filesPos = null; const i = $('#fileVideo'); i.multiple = !nid; i.value = ''; i.click(); }
$('#fileVideo').onchange = e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  if (attachTo) { attachFile(attachTo.pid, attachTo.nid, files[0]); attachTo = null; return; }
  addFiles(files, filesPos);
};
function addFiles(files, pos) {
  const base = pos || vpCenter(), pid = cur; checkpoint();
  files.forEach((f, i) => {
    const title = f.name && f.name !== 'image.png' ? f.name.replace(/\.[^.]+$/, '') : 'Imagem colada';
    const n = isImg(f)
      ? { id: uid('n'), type: 'image', x: base.x - 118 + i * 44, y: base.y - 100 + i * 44, title, status: 'importing', tags: [], notes: '' }
      : { id: uid('n'), type: 'video', x: base.x - 118 + i * 44, y: base.y - 105 + i * 44, url: '', platform: 'file', title, dur: 0, status: 'importing', tags: [], notes: '' };
    proj().nodes.push(n); const el = nodeEl(n); nodesEl.appendChild(el); measure(el);
    attachFile(pid, n.id, f, true);
  });
  touch(); renderWires(); updCounts();
}
async function attachFile(pid, nid, file, isNew) {
  const n = nodeIn(pid, nid); if (!n) return;
  const prev = { status: n.status, file: n.file, thumb: n.thumb };
  n.status = 'importing'; if (pid === cur) refreshNode(nid);
  try {
    const kind = n.type === 'image' ? 'image' : 'video';
    const r = await store.attachFile(pid, nid, file, kind);
    const m = nodeIn(pid, nid); if (!m) return;
    forgetMedia(pid);
    if (kind === 'image') {
      Object.assign(m, { file: r.file, size: r.size || file.size, status: 'done' });
      const u = await store.mediaURL(pid, r.file);
      await new Promise(res => { const im = new Image(); im.onload = () => { m.w = im.naturalWidth; m.h = im.naturalHeight; res(); }; im.onerror = res; im.src = u; });
    } else { Object.assign(m, { file: r.file, thumb: r.thumb || null, size: r.size || file.size, dur: r.duration || m.dur, status: 'done' }); if (r.w && r.h) { m.w = r.w; m.h = r.h; } }
    touch(pid); if (pid === cur) { refreshNode(nid); if (sel && sel.id === nid) renderPanel(); }
    if (!isNew) toast('Arquivo anexado');
  } catch (e) {
    const m = nodeIn(pid, nid); if (!m) return; Object.assign(m, prev);
    if (m.status === 'importing') m.status = m.url ? 'link' : 'missing';
    if (pid === cur) refreshNode(nid);
    toast('Não deu para adicionar o arquivo: ' + errText(e));
  }
}
function nodeAction(act, nid) {
  if (act === 'download') startDownload(cur, nid);
  else if (act === 'attach') pickFiles(nid);
  else if (act === 'view') openViewer(nid);
}
function addNote(x, y) {
  const c = x == null ? vpCenter() : null; const n = { id: uid('n'), type: 'note', x: x ?? c.x - 107, y: y ?? c.y - 45, text: '' };
  checkpoint(); proj().nodes.push(n); const el = nodeEl(n); nodesEl.appendChild(el); measure(el);
  if (sel && sel.kind === 'node') connect(sel.id, n.id, false); touch(); updCounts(); select('node', n.id); setTimeout(() => $('#f-text')?.focus(), 240);
}
function delItems(nodeIds, strokeIds = []) {
  const P = proj(), ids = new Set(nodeIds), sids = new Set(strokeIds);
  if (!ids.size && !sids.size) return;
  checkpoint();
  for (const n of P.nodes) if (ids.has(n.id) && (n.status === 'downloading' || n.status === 'queued')) { if (n.status === 'downloading' && store.cancelDownload) store.cancelDownload(cur, n.id); n.status = 'link'; }
  P.nodes = P.nodes.filter(n => !ids.has(n.id)); P.edges = P.edges.filter(e => !ids.has(e.a) && !ids.has(e.b)); P.strokes = P.strokes.filter(s => !sids.has(s.id));
  ids.forEach(id => playing.delete(id)); msel = new Set(); ssel = new Set(); sel = null;
  touch(); renderBoard(); renderPanel();
  const total = ids.size + sids.size;
  if (total > 1) undoToast(plural(total, 'item removido', 'itens removidos'));
  else if (sids.size) undoToast('Rabisco removido');
  else { const t = [...ids][0], n = (hist[cur].u.length && JSON.parse(hist[cur].u[hist[cur].u.length - 1]).nodes.find(x => x.id === t)) || {}; undoToast(n.type === 'video' ? 'Referência removida' : n.type === 'image' ? 'Imagem removida' : n.type === 'folder' ? 'Pasta removida' : 'Nota removida'); }
}
function delNode(id) { delItems([id]); }
function removeEdge(id, msg) {
  const P = proj(), i = P.edges.findIndex(e => e.id === id); if (i < 0) return;
  checkpoint(); P.edges.splice(i, 1);
  if (sel && sel.id === id) { sel = null; renderPanel(); }
  touch(); undoToast(msg);
}
function delEdge(id) { removeEdge(id, 'Cabo removido'); renderWires(); updCounts(); }
function organize() {
  const P = proj(), ns = P.nodes; if (ns.length < 2) return; checkpoint();
  const pts = ns.map(n => { const s = size(n); return { n, x: n.x + s.w / 2, y: n.y + s.h / 2, w: s.w, h: s.h, ox: n.x, oy: n.y }; }); const idx = new Map(pts.map((p, i) => [p.n.id, i]));
  const E = P.edges.map(e => [idx.get(e.a), idx.get(e.b)]).filter(x => x[0] != null && x[1] != null);
  for (let it = 0; it < 500; it++) {
    const cool = 1 - it / 500, F = pts.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j]; const dx = b.x - a.x, dy = b.y - a.y, d2 = Math.max(dx * dx + dy * dy, 400), d = Math.sqrt(d2); const f = 2.4e6 / d2;
      F[i].x -= dx / d * f; F[i].y -= dy / d * f; F[j].x += dx / d * f; F[j].y += dy / d * f;
      const ox = (a.w + b.w) / 2 + 60 - Math.abs(dx), oy = (a.h + b.h) / 2 + 60 - Math.abs(dy);
      if (ox > 0 && oy > 0) { if (ox < oy) { const s = (dx < 0 ? -1 : 1) * ox / 2; F[i].x -= s * 4; F[j].x += s * 4; } else { const s = (dy < 0 ? -1 : 1) * oy / 2; F[i].y -= s * 4; F[j].y += s * 4; } }
    }
    E.forEach(([i, j]) => { const a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 400) * .6; F[i].x += dx / d * f; F[i].y += dy / d * f; F[j].x -= dx / d * f; F[j].y -= dy / d * f; });
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    pts.forEach((p, i) => { F[i].x += (cx - p.x) * .3; F[i].y += (cy - p.y) * .3; const m = 40 * cool + 2; p.x += Math.max(-m, Math.min(m, F[i].x * .02)); p.y += Math.max(-m, Math.min(m, F[i].y * .02)); });
  }
  /* passada final: separa de vez qualquer par de cards que ainda esteja encostado */
  for (let it = 0; it < 300; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y;
      const ox = (a.w + b.w) / 2 + 40 - Math.abs(dx), oy = (a.h + b.h) / 2 + 40 - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (ox < oy) { const s = (dx < 0 ? -1 : 1) * ox / 2; a.x -= s; b.x += s; } else { const s = (dy < 0 ? -1 : 1) * oy / 2; a.y -= s; b.y += s; }
    }
    if (!moved) break;
  }
  const t0 = performance.now();
  (function f(t) {
    let p = Math.min(1, (t - t0) / 550); p = 1 - Math.pow(1 - p, 3);
    pts.forEach(q => { q.n.x = q.ox + (q.x - q.w / 2 - q.ox) * p; q.n.y = q.oy + (q.y - q.h / 2 - q.oy) * p; const el = nodesEl.querySelector(`[data-id="${q.n.id}"]`); if (el) { el.style.left = q.n.x + 'px'; el.style.top = q.n.y + 'px'; } });
    renderWires(); if (p < 1) requestAnimationFrame(f); else { touch(); fit(); }
  })(t0);
}

/* ---------- painel ---------- */
const nodeName = n => n.type === 'note' ? (n.text.split('\n')[0] || 'Nota') : n.title;
function connsHTML(id) {
  const es = proj().edges.filter(e => e.a === id || e.b === id);
  if (!es.length) return `<div class="muted">Nenhum cabo ainda. Arraste a bolinha da lateral do card até outro card.</div>`;
  return `<div class="conns">${es.map(e => { const n = getNode(e.a === id ? e.b : e.a); return n ? `<button data-focus="${n.id}"><i style="background:${edgeColor(e)}"></i><span>${esc(nodeName(n))}</span></button>` : ''; }).join('')}</div>`;
}
const X = '<button class="icon" data-x aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
function statusText(n) {
  return n.status === 'done' ? 'Baixado' + (n.size ? ', ' + mb(n.size) : '') : n.status === 'queued' ? 'Na fila' : n.status === 'downloading' ? 'Baixando ' + Math.floor(n.progress || 0) + '%' : n.status === 'importing' ? 'Adicionando…' : n.status === 'error' ? 'Não deu para baixar' : n.status === 'missing' ? 'Sem arquivo' : 'Só o link';
}
function renderPanel() {
  const pn = $('#panel'); if (!cur || !sel) { pn.classList.remove('on'); pn.innerHTML = ''; return; }
  let h = '', n = null, e = null;
  if (sel.kind === 'multi') {
    const ns = proj().nodes.filter(x => msel.has(x.id)), media = ns.filter(x => x.type === 'video' || x.type === 'image');
    const parts = [];
    const cnt = (t, a, b) => { const k = ns.filter(x => x.type === t).length; if (k) parts.push(plural(k, a, b)); };
    cnt('video', 'vídeo', 'vídeos'); cnt('image', 'imagem', 'imagens'); cnt('note', 'nota', 'notas'); cnt('folder', 'pasta', 'pastas');
    if (ssel.size) parts.push(plural(ssel.size, 'rabisco', 'rabiscos'));
    pn.innerHTML = `<div class="ph">${msel.size + ssel.size} selecionados${X}</div><div class="pb">
      <div class="muted">${parts.join(', ')}. Arraste qualquer um para mover todos juntos.</div>
      ${media.length ? `<div class="fld"><label for="m-tag">Adicionar tag a ${media.length > 1 ? 'todos' : 'ele'}</label><div style="display:flex;gap:6px"><input id="m-tag" placeholder="Ex.: figurino"><button class="btn" id="m-tagb">Adicionar</button></div></div>` : ''}
      <button class="btn del" id="m-del">Remover selecionados</button>
      <div class="muted">Shift+clique adiciona ou tira um card. Shift+arrastar no vazio seleciona por área. Ctrl+A seleciona tudo.</div></div>`;
    pn.classList.add('on');
    const addTag = () => { const t = $('#m-tag').value.trim().replace(/^#/, ''); if (!t) return; checkpoint(); for (const x of media) if (!x.tags.includes(t)) x.tags.push(t); touch(); media.forEach(x => refreshNode(x.id)); $('#m-tag').value = ''; toast(`Tag “${t}” adicionada`); };
    if ($('#m-tagb')) { $('#m-tagb').onclick = addTag; $('#m-tag').onkeydown = ev => { if (ev.key === 'Enter') addTag(); }; }
    $('#m-del').onclick = () => delItems([...msel], [...ssel]);
    pn.querySelector('[data-x]').onclick = () => select(null);
    return;
  }
  if (sel.kind === 'edge') {
    e = proj().edges.find(x => x.id === sel.id); if (!e) { pn.classList.remove('on'); return; } const a = getNode(e.a), b = getNode(e.b);
    h = `<div class="ph">Cabo${X}</div><div class="pb"><div class="conns"><button data-focus="${a.id}"><span>${esc(nodeName(a))}</span></button><button data-focus="${b.id}"><span>${esc(nodeName(b))}</span></button></div>
    <div class="fld"><label for="f-label">O que liga os dois</label><input id="f-label" value="${esc(e.label || '')}" placeholder="Ex.: mesma paleta"></div>
    <div class="fld"><label>Cor do cabo</label><div class="sw">${CAB.map((c, i) => `<button data-c="${i}" class="${edgeColor(e) === c ? 'on' : ''}" style="background:${c}" aria-label="Cor ${i + 1}"></button>`).join('')}</div></div>
    <button class="btn del" id="f-del">Remover cabo</button></div>`;
  } else {
    n = getNode(sel.id); if (!n) { pn.classList.remove('on'); return; }
    if (n.type === 'video') {
      const vu = n.file ? murl.get(mkey(cur, n.file)) : null, tu = n.thumb ? murl.get(mkey(cur, n.thumb)) : null;
      if (n.file && !vu) loadMedia(cur, n.file);
      const media = n.status === 'done' && n.file ? (vu ? `<video controls playsinline preload="metadata" src="${esc(vu)}" ${tu ? `poster="${esc(tu)}"` : ''}></video>` : thumbHTML(n)) : thumbHTML(n);
      const acts = [];
      if (store.canDownload && n.url && n.status !== 'done' && n.status !== 'downloading' && n.status !== 'queued') acts.push(`<button class="btn pri" data-pact="download">${n.status === 'error' ? 'Tentar de novo' : 'Baixar vídeo'}</button>`);
      if (n.status === 'done' && n.file) acts.unshift(`<button class="btn pri" data-pact="view">Ver grande</button>`);
      if (n.status !== 'downloading' && n.status !== 'queued') acts.push(`<button class="btn" data-pact="attach">${n.file ? 'Trocar arquivo' : 'Anexar arquivo'}</button>`);
      if (DESK && n.file) acts.push(`<button class="btn" data-pact="reveal">Mostrar na pasta</button>`);
      if (n.url) acts.push(`<a class="btn" href="${esc(n.url)}" target="_blank" rel="noopener">Abrir original</a>`);
      h = `<div class="ph">Referência${X}</div><div class="pb">${media}
      <div class="fld"><label for="f-title">Título</label><input id="f-title" value="${esc(n.title)}"></div>
      <div class="kv"><span>Origem</span><b>${n.url ? esc(domain(n.url)) : 'Arquivo do aparelho'}</b><span>Situação</span><b id="pstat" class="num">${statusText(n)}</b>${n.dur ? `<span>Duração</span><b class="num">${fmtDur(n.dur)}</b>` : ''}${n.error && n.status === 'error' ? `<span>Erro</span><b class="wrap">${esc(n.error)}</b>` : ''}</div>
      <div class="pacts">${acts.join('')}</div>
      <div class="fld"><label for="f-tags">Tags, separadas por vírgula</label><input id="f-tags" value="${esc(n.tags.join(', '))}" placeholder="luz, câmera, cor"></div>
      <div class="fld"><label for="f-notes">Anotações</label><textarea id="f-notes" placeholder="O que interessa nesse vídeo?">${esc(n.notes)}</textarea></div>
      <div class="fld"><label>Ligado a</label>${connsHTML(n.id)}</div><button class="btn del" id="f-del">Remover referência</button></div>`;
    } else if (n.type === 'image') {
      const u = n.file ? murl.get(mkey(cur, n.file)) : null; if (n.file && !u) loadMedia(cur, n.file);
      h = `<div class="ph">Imagem${X}</div><div class="pb"><div class="pimg" style="background:${thumbBg(n.id)}">${u ? `<img src="${esc(u)}" alt="">` : ''}</div>
      <div class="fld"><label for="f-title">Título</label><input id="f-title" value="${esc(n.title)}"></div>
      ${n.w ? `<div class="kv"><span>Tamanho</span><b class="num">${n.w} × ${n.h} px${n.size ? ', ' + mb(n.size) : ''}</b></div>` : ''}
      <div class="pacts">${n.file ? '<button class="btn pri" data-pact="view">Ver grande</button>' : ''}<button class="btn" data-pact="attach">${n.file ? 'Trocar imagem' : 'Escolher imagem'}</button>${DESK && n.file ? '<button class="btn" data-pact="reveal">Mostrar na pasta</button>' : ''}</div>
      <div class="fld"><label for="f-tags">Tags, separadas por vírgula</label><input id="f-tags" value="${esc(n.tags.join(', '))}" placeholder="figurino, cor"></div>
      <div class="fld"><label for="f-notes">Anotações</label><textarea id="f-notes" placeholder="O que interessa nessa imagem?">${esc(n.notes)}</textarea></div>
      <div class="fld"><label>Ligado a</label>${connsHTML(n.id)}</div><button class="btn del" id="f-del">Remover imagem</button></div>`;
    } else if (n.type === 'folder') {
      h = `<div class="ph">Pasta${X}</div><div class="pb">
      <div class="fld"><label for="f-title">Nome da pasta</label><input id="f-title" value="${esc(n.title)}"></div>
      <div class="fld"><label for="f-target">Abre o projeto</label><select id="f-target">${S.projects[n.target] ? '' : '<option value="">Escolha um projeto</option>'}${S.order.filter(id => id !== cur).map(id => `<option value="${id}" ${id === n.target ? 'selected' : ''}>${esc(S.projects[id].name)}</option>`).join('')}</select></div>
      <div class="fld"><label>Ligado a</label>${connsHTML(n.id)}</div><button class="btn del" id="f-del">Remover pasta</button></div>`;
    } else h = `<div class="ph">Nota${X}</div><div class="pb"><div class="fld"><label for="f-text">Texto</label><textarea id="f-text" style="min-height:150px">${esc(n.text)}</textarea></div><div class="fld"><label>Ligado a</label>${connsHTML(n.id)}</div><button class="btn del" id="f-del">Remover nota</button></div>`;
  }
  pn.innerHTML = h; pn.classList.add('on');
  if (n) {
    const bind = (id, fn) => { const el = $('#' + id); if (el) { el.onfocus = () => checkpoint(); el.oninput = () => { fn(el.value); touch(); refreshNode(n.id); }; } };
    bind('f-title', v => n.title = v); bind('f-tags', v => n.tags = v.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean)); bind('f-notes', v => n.notes = v); bind('f-text', v => n.text = v);
    const ft = $('#f-target'); if (ft) ft.onchange = () => { checkpoint(); n.target = ft.value; touch(); refreshNode(n.id); };
    $('#f-del').onclick = () => delNode(n.id);
    pn.querySelectorAll('[data-pact]').forEach(b => b.onclick = () => {
      const a = b.dataset.pact;
      if (a === 'download') { startDownload(cur, n.id); renderPanel(); }
      else if (a === 'attach') pickFiles(n.id);
      else if (a === 'reveal') store.reveal(cur, n.file);
      else if (a === 'view') openViewer(n.id);
    });
    const th = pn.querySelector('.thumb'); if (th && n.status === 'done') th.onclick = () => openViewer(n.id);
    const pi = pn.querySelector('.pimg'); if (pi && n.file) pi.onclick = () => openViewer(n.id);
  } else {
    $('#f-label').onfocus = () => checkpoint();
    $('#f-label').oninput = ev => { e.label = ev.target.value; touch(); renderWires(); };
    pn.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { checkpoint(); e.c = +b.dataset.c; touch(); renderWires(); pn.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
    $('#f-del').onclick = () => delEdge(e.id);
  }
  pn.querySelector('[data-x]').onclick = () => select(null);
  pn.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => focusNode(b.dataset.focus));
}

/* ---------- visualizador grande ---------- */
let viewerId = null;
const viewable = () => proj().nodes.filter(n => (n.type === 'video' || n.type === 'image') && n.file && n.status === 'done').sort((a, b) => (a.x - b.x) || (a.y - b.y));
async function openViewer(id) {
  if (!cur) return; const list = viewable(), n = list.find(x => x.id === id);
  if (!n) { toast('Esse card ainda não tem arquivo para ver.'); return; }
  viewerId = id; const i = list.indexOf(n);
  playing.clear(); nodesEl.querySelectorAll('video.inl').forEach(v => v.pause());
  $('#viewer').hidden = false; document.body.classList.add('viewing');
  $('#v-title').textContent = n.title; $('#v-count').textContent = list.length > 1 ? `${i + 1} de ${list.length}` : '';
  const o = $('#v-orig'); o.hidden = !n.url; if (n.url) o.href = n.url;
  $('#v-prev').hidden = $('#v-next').hidden = list.length < 2;
  const u = await store.mediaURL(cur, n.file); if (viewerId !== id) return;
  $('#v-stage').innerHTML = n.type === 'image' ? `<img src="${esc(u)}" alt="${esc(n.title)}">` : `<video src="${esc(u)}" controls autoplay playsinline></video>`;
  const v = vvid(); $('#v-ctl').hidden = !v;
  if (v) { v.loop = vst.loop; v.playbackRate = vst.rate; v.defaultPlaybackRate = vst.rate; renderVctl(); }
}
const vst = { loop: prefs.vloop !== false, rate: 1 };
const vvid = () => $('#v-stage video');
const RATES = [0.25, 0.5, 1];
function renderVctl() {
  $('#v-loop').classList.toggle('on', vst.loop);
  $('#v-rates').innerHTML = RATES.map(r => `<button class="${vst.rate === r ? 'on' : ''}" data-rate="${r}">${String(r).replace('.', ',')}x</button>`).join('');
}
function setRate(r) { vst.rate = r; const v = vvid(); if (v) { v.playbackRate = r; v.defaultPlaybackRate = r; } renderVctl(); }
function toggleLoop() { vst.loop = !vst.loop; prefs.vloop = vst.loop; savePrefs(); const v = vvid(); if (v) v.loop = vst.loop; renderVctl(); }
function stepFrame(d) { const v = vvid(); if (!v) return; v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d / 30)); }
function togglePlayV() { const v = vvid(); if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }
$('#v-loop').onclick = toggleLoop;
$('#v-rates').onclick = e => { const b = e.target.closest('[data-rate]'); if (b) setRate(+b.dataset.rate); };
$('#v-fb').onclick = () => stepFrame(-1);
$('#v-ff').onclick = () => stepFrame(1);
function stepViewer(d) { const list = viewable(); if (!list.length) return; let i = list.findIndex(x => x.id === viewerId); i = (i + d + list.length) % list.length; openViewer(list[i].id); }
function closeViewer() { if (!viewerId) return; const id = viewerId; viewerId = null; $('#viewer').hidden = true; document.body.classList.remove('viewing'); $('#v-stage').innerHTML = ''; if (cur) refreshNode(id); }
$('#v-close').onclick = closeViewer;
$('#v-prev').onclick = () => stepViewer(-1);
$('#v-next').onclick = () => stepViewer(1);
$('#v-stage').onclick = e => { if (e.target.id === 'v-stage') closeViewer(); };

/* ---------- janelas ---------- */
function modal({ title, body, ok, danger, onOk, onOpen }) {
  const s = $('#scrim');
  s.innerHTML = `<form class="modal" autocomplete="off"><h2>${title}</h2>${body}<div class="row"><button type="button" class="btn" data-x>${ok ? 'Cancelar' : 'Fechar'}</button>${ok ? `<button class="btn ${danger ? 'del' : 'pri'}" type="submit">${ok}</button>` : ''}</div></form>`;
  s.classList.add('on'); const f = $('form', s);
  setTimeout(() => { const el = f.querySelector('input[type=text],input:not([type]),select') || f.querySelector('[type=submit]'); if (el) el.focus(); }, 30);
  f.onsubmit = async e => { e.preventDefault(); if (!onOk) { closeModal(); return; } const r = await onOk(f); if (r !== false) closeModal(); };
  f.querySelector('[data-x]').onclick = closeModal;
  if (onOpen) onOpen(f);
}
function closeModal() { $('#scrim').classList.remove('on'); }
$('#scrim').addEventListener('pointerdown', e => { if (e.target.id === 'scrim') closeModal(); });
function newProjectModal() {
  const opts = Object.keys(S.projects).sort(byName), label = x => [...ancestors(x), x].map(a => S.projects[a].name).join(' / ');
  modal({ title: 'Novo projeto', ok: 'Criar projeto', body: `<div class="fld"><label for="m-name">Nome do projeto</label><input id="m-name" name="pname" placeholder="Ex.: Clipe do single novo"></div>
    ${opts.length ? `<div class="fld"><label for="m-par">Fica dentro de</label><select id="m-par" name="par"><option value="">Nenhum (no topo da lista)</option>${opts.map(x => `<option value="${x}">${esc(label(x))}</option>`).join('')}</select></div>` : ''}`,
    onOk: f => {
      const name = f.pname.value.trim(); if (!name) { f.pname.focus(); return false; }
      const id = createProject(name); if (f.par && f.par.value) { S.projects[id].parent = f.par.value; delete prefs.collapsed[f.par.value]; savePrefs(); }
      openProject(id);
    } });
}
function delProjectModal(id) {
  const P = S.projects[id], kids = childrenOf(id).length;
  modal({ title: 'Mover para a lixeira?', ok: 'Mover para a lixeira', danger: true, body: `<div class="muted">“${esc(P.name)}” fica na lixeira por ${TRASH_DAYS} dias, com os vídeos, e você pode restaurar quando quiser. Depois disso ele é apagado de vez.${kids ? ` Os ${plural(kids, 'subprojeto', 'subprojetos')} dele continuam na lista, um nível acima.` : ''}</div>`,
    onOk: async () => {
      const up = parentOf(id); for (const c of childrenOf(id)) { S.projects[c].parent = up; markDirty(c); }
      await flush();
      P.trashed = Date.now(); delete S.projects[id]; S.trash[id] = P; sortOrder(); trail = trail.filter(x => x !== id);
      try { await store.saveProject(P); } catch (e) { toast('Não foi possível mover: ' + errText(e)); }
      renderTrashBtn();
      if (cur === id) route(null); else { renderSide(); if (cur) renderBoard(); }
      toast(`“${P.name}” foi para a lixeira`, { label: 'Desfazer', fn: () => restoreProject(id) });
    } });
}
async function restoreProject(id) {
  const P = S.trash[id]; if (!P) return;
  delete P.trashed; delete S.trash[id]; S.projects[id] = P; P.updated = Date.now(); sortOrder();
  try { await store.saveProject(P); } catch (e) { toast('Não foi possível restaurar: ' + errText(e)); }
  renderSide(); renderTrashBtn(); if (!cur) route(id); else if (cur) renderBoard();
  toast(`“${P.name}” restaurado`);
}
function renderTrashBtn() { const n = Object.keys(S.trash).length, b = $('#btn-trash'); b.hidden = !n; b.textContent = `Lixeira (${n})`; }
function trashModal() {
  const ids = Object.keys(S.trash).sort((a, b) => S.trash[b].trashed - S.trash[a].trashed);
  const left = P => Math.max(0, Math.ceil(TRASH_DAYS - (Date.now() - P.trashed) / 864e5));
  modal({ title: 'Lixeira', body: ids.length ? `<div class="imp">${ids.map(id => { const P = S.trash[id]; return `<div class="it"><h4><i style="background:${esc(P.color)}"></i>${esc(P.name)}</h4><div class="muted">${plural(refs(P), 'referência', 'referências')}. Apagado de vez em ${plural(left(P), 'dia', 'dias')}.</div><div class="pacts"><button type="button" class="btn" data-restore="${id}">Restaurar</button><button type="button" class="btn del" data-purge="${id}">Apagar de vez</button></div></div>`; }).join('')}</div>` : '<div class="muted">A lixeira está vazia.</div>',
    onOpen: f => {
      f.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { closeModal(); restoreProject(b.dataset.restore); });
      f.querySelectorAll('[data-purge]').forEach(b => b.onclick = async () => {
        const id = b.dataset.purge, P = S.trash[id];
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Confirmar: apagar de vez'; return; }
        delete S.trash[id]; forgetMedia(id);
        try { await store.deleteProject(id); } catch (e) { toast('Não foi possível apagar: ' + errText(e)); }
        renderTrashBtn(); closeModal(); toast(`“${P.name}” apagado de vez`);
        if (Object.keys(S.trash).length) trashModal();
      });
    } });
}
function newFolderModal() {
  const others = S.order.filter(id => id !== cur);
  modal({ title: 'Nova pasta', ok: 'Criar pasta', body: `<div class="muted">A pasta é um card que abre outro projeto. Use para ligar este quadro a ele.</div>
  <div class="fld"><label for="m-target">Abre o projeto</label><select id="m-target" name="tgt">${others.map(id => `<option value="${id}">${esc(S.projects[id].name)}</option>`).join('')}<option value="__new">Criar um projeto novo, dentro deste</option></select></div>
  <div class="fld"><label for="m-name">Nome da pasta</label><input id="m-name" name="fname" placeholder="Ex.: Figurino"></div>`,
    onOk: f => {
      let t = f.tgt.value, name = f.fname.value.trim();
      if (t === '__new') { if (!name) { f.fname.focus(); return false; } t = createProject(name); S.projects[t].parent = cur; delete prefs.collapsed[cur]; savePrefs(); renderSide(); } else if (!name) name = S.projects[t].name;
      const c = vpCenter(), n = { id: uid('n'), type: 'folder', x: c.x - 107 + (Math.random() - .5) * 90, y: c.y - 75 + (Math.random() - .5) * 90, title: name, target: t };
      checkpoint(); proj().nodes.push(n); const el = nodeEl(n); nodesEl.appendChild(el); measure(el);
      if (sel && sel.kind === 'node') connect(sel.id, n.id, false); touch(); updCounts(); select('node', n.id);
    } });
}

/* ---------- exportar / importar .dynboard ---------- */
function exportModal() {
  if (!cur) return;
  const linked = Z.collect(S.projects, cur, true), subs = descendants(cur);
  const pick = f => { const set = new Set([cur]); if (f.linked && f.linked.checked) linked.forEach(x => set.add(x)); if (f.subs && f.subs.checked) subs.forEach(x => set.add(x)); return [...set]; };
  const sizeOf = ids => ids.reduce((s, id) => s + S.projects[id].nodes.reduce((a, n) => a + (n.type === 'video' && n.file ? (n.size || 0) : 0), 0), 0);
  const est = ids => { const b = sizeOf(ids); return b ? ' (cerca de ' + (b > 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : mb(b)) + ')' : ''; };
  modal({ title: 'Exportar projeto', ok: 'Exportar', body: `<div class="muted">Gera um arquivo .dynboard. Quem tiver o DynBoard abre o projeto igualzinho, sem precisar de internet.</div>
  <div class="opts">
    <label class="opt"><input type="radio" name="media" value="full" checked><div><b>Com os vídeos</b><span id="m-est">O arquivo leva tudo junto${est([cur])}.</span></div></label>
    <label class="opt"><input type="radio" name="media" value="links"><div><b>Só os links</b><span>Arquivo bem leve. Quem receber baixa os vídeos de novo pelo app de computador.</span></div></label>
    ${subs.length ? `<label class="opt"><input type="checkbox" name="subs" checked><div><b>Incluir os subprojetos</b><span>Leva junto ${plural(subs.length, 'projeto que está', 'projetos que estão')} dentro deste, mantendo a organização.</span></div></label>` : ''}
    ${linked.length > 1 ? `<label class="opt"><input type="checkbox" name="linked"><div><b>Incluir os projetos das pastas</b><span>Leva junto ${plural(linked.length - 1, 'projeto ligado', 'projetos ligados')} por pastas, para elas não chegarem vazias.</span></div></label>` : ''}
  </div>`,
    onOpen: f => { const upd = () => { $('#m-est').textContent = 'O arquivo leva tudo junto' + est(pick(f)) + '.'; }; if (f.linked) f.linked.onchange = upd; if (f.subs) f.subs.onchange = upd; upd(); },
    onOk: async f => {
      const withMedia = f.media.value === 'full', ids = pick(f);
      await flush();
      const projects = ids.map(id => withMedia ? JSON.parse(JSON.stringify(S.projects[id])) : Z.linksOnly(S.projects[id]));
      closeModal(); const done = busy('Exportando…');
      try {
        const r = await store.exportDynboard({ projects, rootId: cur, withMedia, fileName: slug(proj().name) + '.dynboard' });
        done(); if (r && r.saved) toast('Projeto exportado' + (r.name ? ': ' + r.name : ''));
      } catch (e) { done(); toast('Não deu para exportar: ' + errText(e)); }
    } });
}
async function startImport() {
  if (DESK) { importFrom(null); return; }
  const i = $('#fileDyn'); i.value = ''; i.click();
}
$('#fileDyn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFrom(f); };
async function importFrom(source) {
  let r; const done = busy('Abrindo o arquivo…');
  try { r = await store.openDynboard(source); } catch (e) { done(); toast(errText(e)); return; }
  done(); if (!r) return;
  if (!r.projects.length) { toast('Esse arquivo não tem projetos.'); return; }
  const conflicts = r.projects.filter(p => S.projects[p.id]);
  const rows = r.projects.map(p => {
    const mine = S.projects[p.id], n = (p.nodes || []).filter(x => x.type === 'video').length;
    return `<div class="it"><h4><i style="background:${esc(p.color || PAL[0])}"></i>${esc(p.name)}</h4><div class="muted">${plural(n, 'referência', 'referências')}${r.manifest.media === 'links' ? ', só os links' : ''}${mine ? '. Você já tem este projeto.' : ''}</div>
    ${mine ? `<div class="seg2"><label><input type="radio" name="d_${esc(p.id)}" value="replace">Atualizar o meu</label><label><input type="radio" name="d_${esc(p.id)}" value="copy" checked>Abrir como cópia</label></div>` : ''}</div>`;
  }).join('');
  modal({ title: r.projects.length > 1 ? `Importar ${r.projects.length} projetos` : 'Importar projeto', ok: 'Importar', body: `${conflicts.length ? '<div class="muted">"Atualizar o meu" troca a sua versão pela do arquivo. "Abrir como cópia" mantém as duas.</div>' : ''}<div class="imp">${rows}</div>`,
    onOk: async f => {
      const decisions = {};
      for (const p of r.projects) { const el = f.querySelector(`input[name="d_${CSS.escape(p.id)}"]:checked`); decisions[p.id] = el ? el.value : 'replace'; }
      const items = Z.planImport(r.projects, decisions, () => uid('p'));
      closeModal(); const done2 = busy('Importando…');
      if (items.some(x => x.project.id === cur)) { closeViewer(); playing.clear(); nodesEl.innerHTML = ''; }
      try {
        await store.commitImport(r.handle, items);
        for (const { project } of items) { forgetMedia(project.id); delete S.trash[project.id]; delete project.trashed; S.projects[project.id] = normalize(project); delete hist[project.id]; }
        renderTrashBtn();
        sortOrder(); done2();
        const root = items.find(x => x.srcId === r.manifest.root) || items[0];
        trail = []; route(root.project.id);
        toast(items.length > 1 ? `${items.length} projetos importados` : 'Projeto importado');
      } catch (e) { done2(); toast('Não deu para importar: ' + errText(e)); }
    } });
}
if (store.onOpenPath) store.onOpenPath(p => importFrom(p));
if ('launchQueue' in window) window.launchQueue.setConsumer(async params => { for (const h of params.files || []) { try { importFrom(await h.getFile()); } catch (e) {} } });

/* ---------- atualização do app (só no app de computador instalado) ---------- */
const UPD = DESK && window.dyn && window.dyn.updateInfo ? window.dyn : null;
let updState = null;
function updText(u) {
  if (!u) return '';
  if (!u.enabled) return 'Modo de teste (aberto pela pasta): a atualização automática só vale no app instalado.';
  if (u.state === 'checking') return 'Procurando versão nova…';
  if (u.state === 'downloading') return `Baixando a versão ${u.version}… ${u.percent || 0}%`;
  if (u.state === 'ready') return `Versão ${u.version} pronta. Ela entra sozinha quando você fechar o app.`;
  if (u.state === 'error') return 'Não deu para procurar atualização agora (sem internet?).';
  if (u.state === 'none') return 'Você já está na versão mais nova.';
  return '';
}
function updRender() {
  const u = updState, note = $('#envnote');
  if (u && u.state === 'ready') {
    note.textContent = `Versão ${u.version} pronta: clique para atualizar`;
    note.style.cursor = 'pointer'; note.onclick = () => UPD.installUpdate();
  }
  const st = $('#s-ver-st'), b = $('#s-ver-btn');
  if (st && u) st.textContent = updText(u);
  if (b && u) {
    b.hidden = !u.enabled;
    b.disabled = u.state === 'checking' || u.state === 'downloading';
    b.textContent = u.state === 'ready' ? 'Reiniciar e atualizar' : 'Procurar atualização';
    b.onclick = async () => { if (updState.state === 'ready') UPD.installUpdate(); else { updState = { ...updState, ...(await UPD.checkUpdate()) }; updRender(); } };
  }
}
if (UPD) {
  UPD.updateInfo().then(u => { updState = u; updRender(); }).catch(() => {});
  UPD.onUpdate(d => {
    const was = updState && updState.state;
    updState = { ...(updState || { enabled: true }), ...d };
    updRender();
    if (d.state === 'ready' && was !== 'ready') toast(`Versão ${d.version} do DynBoard pronta`, { label: 'Reiniciar agora', fn: () => UPD.installUpdate() });
  });
}

/* ---------- ajustes ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
async function settingsModal() {
  if (DESK) {
    const s = await store.settings(), tools = await store.toolStatus();
    const browsers = [['', 'Nenhum'], ['chrome', 'Chrome'], ['edge', 'Edge'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['opera', 'Opera']];
    modal({ title: 'Ajustes', body: `
      <div class="fld"><label>Pasta dos projetos</label><div class="setrow"><span class="muted" style="word-break:break-all">${esc(s.libraryDir)}</span></div><div class="pacts" style="margin-top:8px"><button type="button" class="btn" id="s-open">Abrir pasta</button><button type="button" class="btn" id="s-move">Trocar pasta</button></div></div>
      <div class="fld"><label for="s-cookies">Login para Instagram e sites que pedem conta</label><select id="s-cookies">${browsers.map(([v, l]) => `<option value="${v}" ${s.cookiesBrowser === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="muted" style="margin-top:6px">Usa o login que já está salvo no navegador escolhido. Prefira uma conta da gravadora, não a pessoal.</div></div>
      <div class="fld"><label for="s-quality">Qualidade dos vídeos baixados</label><select id="s-quality"><option value="720" ${s.quality === '720' ? 'selected' : ''}>720p: leve, bom para referência</option><option value="1080" ${s.quality === '1080' || !s.quality ? 'selected' : ''}>1080p: equilibrado</option><option value="max" ${s.quality === 'max' ? 'selected' : ''}>Máxima disponível: arquivos bem maiores</option></select></div>
      <div class="fld"><label>Ferramentas de download</label><div class="muted" id="s-tools">yt-dlp: ${esc(tools.ytdlp || 'ainda não instalado (instala sozinho no primeiro download)')}<br>ffmpeg: ${tools.ffmpeg ? 'pronto' : 'não encontrado'}</div><div class="pacts" style="margin-top:8px"><button type="button" class="btn" id="s-upd">Atualizar yt-dlp</button></div></div>
      ${UPD && updState ? `<div class="fld"><label>Versão do DynBoard</label><div class="muted">Versão ${esc(updState.appVersion || '')}</div><div class="muted" id="s-ver-st" style="margin-top:4px"></div><div class="pacts" style="margin-top:8px"><button type="button" class="btn" id="s-ver-btn" hidden></button></div></div>` : ''}`,
      onOpen: () => {
        updRender();
        $('#s-open').onclick = () => store.openLibrary();
        $('#s-move').onclick = async () => { const r = await store.chooseLibrary(); if (r) { toast('Pasta trocada. Os projetos da pasta antiga continuam lá.'); setTimeout(() => location.reload(), 1200); } };
        $('#s-cookies').onchange = e => store.setSettings({ cookiesBrowser: e.target.value });
        $('#s-quality').onchange = e => { store.setSettings({ quality: e.target.value }); toast('Vale para os próximos downloads'); };
        $('#s-upd').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Atualizando…'; try { const t = await store.updateTools(); $('#s-tools').innerHTML = `yt-dlp: ${esc(t.ytdlp || '?')}<br>ffmpeg: ${t.ffmpeg ? 'pronto' : 'não encontrado'}`; toast('yt-dlp atualizado'); } catch (err) { toast('Não deu para atualizar: ' + errText(err)); } e.target.disabled = false; e.target.textContent = 'Atualizar yt-dlp'; };
      } });
  } else {
    const info = await store.storageInfo();
    modal({ title: 'Ajustes', body: `
      <div class="muted">Nesta versão os projetos e vídeos ficam guardados neste aparelho. Ela não baixa vídeos de links: aqui você anexa arquivos do aparelho ou importa projetos .dynboard. Para baixar de links, use o app de computador.</div>
      ${info ? `<div class="fld"><label>Espaço usado</label><div class="muted">${mb(info.used || 0)} de ${(info.quota / 1073741824).toFixed(1).replace('.', ',')} GB disponíveis para o app</div></div>` : ''}
      ${installEvt ? '<button type="button" class="btn pri" id="s-install">Instalar o DynBoard neste aparelho</button>' : '<div class="muted">Para instalar no celular: abra o menu do navegador e toque em "Adicionar à tela inicial" (no iPhone, pelo botão Compartilhar).</div>'}`,
      onOpen: () => { const b = $('#s-install'); if (b) b.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; closeModal(); }; } });
  }
}

/* ---------- barra de ações ---------- */
$('#linkform').onsubmit = e => { e.preventDefault(); const i = $('#linkurl'); if (!i.value.trim()) { i.focus(); return; } addLinks(i.value); i.value = ''; };
$('#tb-file').onclick = () => pickFiles(null);
$('#tb-folder').onclick = newFolderModal;
$('#tb-note').onclick = () => addNote();
$('#tb-org').onclick = organize;
$('#tb-fit').onclick = () => fit();
const zc = f => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); };
$('#tb-zi').onclick = () => zc(1.2); $('#tb-zo').onclick = () => zc(1 / 1.2);

/* ---------- versão web instalável ---------- */
if (!DESK && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

window.__dyn = { S, store, flush, route }; // usado nos testes
route(prefs.last);
})();
