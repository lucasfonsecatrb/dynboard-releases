/* Camada de armazenamento.
   - No app de computador (Electron) usa window.dyn: projetos e vídeos ficam em Documentos/DynBoard.
   - No navegador/celular usa IndexedDB: tudo fica guardado no próprio aparelho.
   As duas versões têm a mesma interface, então o resto do app não precisa saber onde está rodando. */
(function () {
  'use strict';
  const Z = window.DynZip;

  function videoMeta(url) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
      const done = r => { v.removeAttribute('src'); v.load(); resolve(r); };
      v.onerror = () => done(null);
      v.onloadedmetadata = () => {
        const dur = isFinite(v.duration) ? v.duration : 0;
        v.currentTime = Math.min(Math.max(dur * 0.1, 0.5), Math.max(dur - 0.1, 0));
      };
      v.onseeked = () => {
        try {
          const w = 480, h = Math.round(w * (v.videoHeight || 270) / (v.videoWidth || 480));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(v, 0, 0, w, h);
          c.toBlob(b => done({ duration: Math.round(v.duration || 0), thumb: b, w: v.videoWidth, h: v.videoHeight }), 'image/jpeg', 0.82);
        } catch (e) { done({ duration: Math.round(v.duration || 0), thumb: null }); }
      };
      setTimeout(() => done(null), 15000);
    });
  }
  function extOf(name, fallback = '.mp4') { const m = /\.[a-z0-9]{2,5}$/i.exec(name || ''); return m ? m[0].toLowerCase() : fallback; }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  /* ================= Navegador / celular ================= */
  function webStore() {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('dynboard', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('media'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (store, mode, fn) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode), s = t.objectStore(store); let out;
        Promise.resolve(fn(s)).then(v => { out = v; });
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    };
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const urls = new Map();
    const key = (pid, name) => pid + '/' + name;

    const api = {
      kind: 'web',
      canDownload: false,
      async loadAll() { return tx('projects', 'readonly', s => req(s.getAll())); },
      async saveProject(p) { await tx('projects', 'readwrite', s => s.put(JSON.parse(JSON.stringify(p)))); },
      async deleteProject(id) {
        await tx('projects', 'readwrite', s => s.delete(id));
        await tx('media', 'readwrite', s => s.delete(IDBKeyRange.bound(id + '/', id + '/￿')));
      },
      async putMedia(pid, name, blob) { await tx('media', 'readwrite', s => s.put(blob, key(pid, name))); urls.delete(key(pid, name)); },
      async mediaBlob(pid, name) { return tx('media', 'readonly', s => req(s.get(key(pid, name)))); },
      async mediaURL(pid, name) {
        const k = key(pid, name);
        if (urls.has(k)) return urls.get(k);
        const b = await api.mediaBlob(pid, name);
        if (!b) return null;
        const u = URL.createObjectURL(b); urls.set(k, u); return u;
      },
      async deleteMedia(pid, name) { const k = key(pid, name); if (urls.has(k)) URL.revokeObjectURL(urls.get(k)); urls.delete(k); await tx('media', 'readwrite', s => s.delete(k)); },
      /* Anexa um arquivo de vídeo escolhido pela pessoa. */
      async attachFile(pid, nid, file, kind) {
        if (kind === 'image') {
          const name = 'i_' + nid + extOf(file.name, '.png');
          await api.putMedia(pid, name, file);
          return { file: name, size: file.size };
        }
        const name = 'v_' + nid + extOf(file.name);
        await api.putMedia(pid, name, file);
        const meta = await videoMeta(await api.mediaURL(pid, name));
        let thumb = null;
        if (meta && meta.thumb) { thumb = 't_' + nid + '.jpg'; await api.putMedia(pid, thumb, meta.thumb); }
        return { file: name, thumb, size: file.size, duration: meta ? meta.duration : 0, w: meta && meta.w, h: meta && meta.h };
      },
      async exportDynboard({ projects, rootId, withMedia, fileName }) {
        const parts = [];
        const w = new Z.ZipWriter(c => { parts.push(c.slice()); });
        await w.add(Z.paths.manifest, JSON.stringify(Z.manifest(rootId, projects.map(p => p.id), withMedia), null, 2));
        for (const p of projects) {
          await w.add(Z.paths.project(p.id), JSON.stringify(p, null, 2));
          if (!withMedia) continue;
          for (const m of Z.mediaOf(p)) {
            const b = await api.mediaBlob(p.id, m);
            if (b) await w.add(Z.paths.media(p.id, m), [new Uint8Array(await b.arrayBuffer())]);
          }
        }
        await w.finish();
        const blob = new Blob(parts, { type: 'application/x-dynboard' });
        if (window.showSaveFilePicker) {
          try {
            const h = await showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Projeto DynBoard', accept: { 'application/x-dynboard': ['.dynboard'] } }] });
            const ws = await h.createWritable(); await ws.write(blob); await ws.close();
            return { saved: true, name: h.name };
          } catch (e) { if (e.name === 'AbortError') return { saved: false }; }
        }
        saveBlob(blob, fileName);
        return { saved: true, name: fileName };
      },
      /* source: File/Blob */
      async openDynboard(file) {
        const zip = await Z.readZip({ size: file.size, read: async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()) });
        const manifest = Z.checkManifest(await Z.readJSON(zip, Z.paths.manifest));
        const projects = [];
        for (const id of manifest.projects) { const p = await Z.readJSON(zip, Z.paths.project(id)); if (p) projects.push(p); }
        return { manifest, projects, handle: zip };
      },
      async commitImport(zip, items) {
        for (const { srcId, project } of items) {
          const prefix = Z.paths.mediaPrefix(srcId), keep = [];
          for (const e of zip.entries) {
            if (!e.name.startsWith(prefix)) continue;
            const name = e.name.slice(prefix.length);
            if (!/^[\w.\-]+$/.test(name)) continue;
            const data = await Z.readEntry(zip, e);
            const ext = (name.split('.').pop() || '').toLowerCase();
            const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mov: 'video/quicktime', webm: 'video/webm' }[ext] || 'video/mp4';
            await api.putMedia(project.id, name, new Blob([data], { type }));
            keep.push(name);
          }
          await api.saveProject(project);
          await api.gcMedia(project.id, keep);
        }
      },
      async gcMedia(pid, keep) {
        const keepSet = new Set(keep);
        const keys = await tx('media', 'readonly', s => req(s.getAllKeys(IDBKeyRange.bound(pid + '/', pid + '/\uffff'))));
        const gone = keys.filter(k => !keepSet.has(k.slice(pid.length + 1)));
        if (gone.length) await tx('media', 'readwrite', s => { gone.forEach(k => s.delete(k)); });
        return gone.length;
      },
      async storageInfo() {
        try { const e = await navigator.storage.estimate(); return { used: e.usage, quota: e.quota }; } catch (e) { return null; }
      }
    };
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    return api;
  }

  /* ================= App de computador ================= */
  function desktopStore() {
    const d = window.dyn;
    const api = {
      kind: 'desktop',
      canDownload: true,
      loadAll: () => d.loadAll(),
      saveProject: p => d.saveProject(JSON.parse(JSON.stringify(p))),
      deleteProject: id => d.deleteProject(id),
      mediaURL: (pid, name) => d.mediaURL(pid, name),
      deleteMedia: (pid, name) => d.deleteMedia(pid, name),
      async attachFile(pid, nid, file, kind) {
        const path = d.pathForFile(file);
        if (path) return d.importFile(pid, nid, path, kind);
        return d.writeFile(pid, nid, file.name || (kind === 'image' ? 'imagem.png' : 'video.mp4'), new Uint8Array(await file.arrayBuffer()), kind);
      },
      download: (pid, nid, url) => d.download(pid, nid, url),
      cancelDownload: (pid, nid) => d.cancelDownload(pid, nid),
      onProgress: cb => d.onProgress(cb),
      reveal: (pid, name) => d.reveal(pid, name),
      exportDynboard: opts => d.exportDynboard(JSON.parse(JSON.stringify(opts))),
      async openDynboard(fileOrPath) {
        const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath ? d.pathForFile(fileOrPath) : await d.pickDynboard();
        if (!path) return null;
        const r = await d.inspectDynboard(path);
        return { manifest: Z.checkManifest(r.manifest), projects: r.projects, handle: path };
      },
      commitImport: (path, items) => d.commitImport(path, items),
      settings: () => d.getSettings(),
      setSettings: s => d.setSettings(s),
      openLibrary: () => d.openLibrary(),
      chooseLibrary: () => d.chooseLibrary(),
      toolStatus: () => d.toolStatus(),
      updateTools: () => d.updateTools(),
      onOpenPath: cb => d.onOpenPath(cb),
      gcMedia: (pid, keep) => d.gcMedia(pid, keep),
      onBeforeClose: cb => d.onBeforeClose(cb)
    };
    return api;
  }

  window.DynStore = window.dyn ? desktopStore() : webStore();
})();
