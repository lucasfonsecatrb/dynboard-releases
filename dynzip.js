/* DynZip — leitura e gravação de .dynboard (zip) sem dependências.
   Funciona no navegador e no Node (Electron).
   Gravação: método "store" (vídeo já é comprimido; comprimir de novo só gasta tempo).
   Leitura: aceita "store" e "deflate", para abrir zips feitos por outros programas. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DynZip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FORMAT = 'dynboard';
  const VERSION = 1;
  const MAX32 = 0xFFFFFFFF;

  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8, crc = 0) {
    crc = (crc ^ MAX32) >>> 0;
    for (let i = 0; i < u8.length; i++) crc = TABLE[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ MAX32) >>> 0;
  }
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function dosDateTime(d = new Date()) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  /* write(chunk: Uint8Array) pode devolver Promise. */
  class ZipWriter {
    constructor(write) {
      this.write = write;
      this.offset = 0;
      this.entries = [];
      this.dt = dosDateTime();
    }
    async _w(u8) {
      if (!u8.length) return;
      await this.write(u8);
      this.offset += u8.length;
    }
    /* chunks: array ou iterável (assíncrono ou não) de Uint8Array, ou um único Uint8Array/string */
    async add(name, chunks) {
      if (typeof chunks === 'string') chunks = [enc.encode(chunks)];
      else if (chunks instanceof Uint8Array) chunks = [chunks];
      const nameB = enc.encode(name);
      const start = this.offset;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0808, true); // bit 3: tamanho/CRC depois dos dados; bit 11: nome em UTF-8
      h.setUint16(8, 0, true);
      h.setUint16(10, this.dt.time, true);
      h.setUint16(12, this.dt.date, true);
      h.setUint16(26, nameB.length, true);
      await this._w(new Uint8Array(h.buffer));
      await this._w(nameB);
      let crc = 0, size = 0;
      for await (const c of chunks) {
        const u8 = c instanceof Uint8Array ? c : new Uint8Array(c);
        crc = crc32(u8, crc);
        size += u8.length;
        await this._w(u8);
      }
      if (size > MAX32 || this.offset > MAX32) throw new Error('ZIP_TOO_BIG');
      const d = new DataView(new ArrayBuffer(16));
      d.setUint32(0, 0x08074b50, true);
      d.setUint32(4, crc, true);
      d.setUint32(8, size, true);
      d.setUint32(12, size, true);
      await this._w(new Uint8Array(d.buffer));
      this.entries.push({ nameB, crc, size, start });
    }
    async finish() {
      if (this.entries.length > 0xFFFF) throw new Error('ZIP_TOO_MANY');
      const cdStart = this.offset;
      for (const e of this.entries) {
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0808, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, this.dt.time, true);
        c.setUint16(14, this.dt.date, true);
        c.setUint32(16, e.crc, true);
        c.setUint32(20, e.size, true);
        c.setUint32(24, e.size, true);
        c.setUint16(28, e.nameB.length, true);
        c.setUint32(42, e.start, true);
        await this._w(new Uint8Array(c.buffer));
        await this._w(e.nameB);
      }
      const cdSize = this.offset - cdStart;
      if (this.offset > MAX32) throw new Error('ZIP_TOO_BIG');
      const z = new DataView(new ArrayBuffer(22));
      z.setUint32(0, 0x06054b50, true);
      z.setUint16(8, this.entries.length, true);
      z.setUint16(10, this.entries.length, true);
      z.setUint32(12, cdSize, true);
      z.setUint32(16, cdStart, true);
      await this._w(new Uint8Array(z.buffer));
    }
  }

  /* src: { size, read(offset, length) -> Promise<Uint8Array> } */
  async function readZip(src) {
    const tailLen = Math.min(src.size, 65557);
    const tail = await src.read(src.size - tailLen, tailLen);
    let p = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { p = i; break; }
    }
    if (p < 0) throw new Error('NOT_A_ZIP');
    const z = new DataView(tail.buffer, tail.byteOffset + p, 22);
    const count = z.getUint16(10, true), cdSize = z.getUint32(12, true), cdOff = z.getUint32(16, true);
    const cd = await src.read(cdOff, cdSize);
    const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const entries = [];
    let o = 0;
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('BAD_ZIP');
      const method = dv.getUint16(o + 10, true);
      const csize = dv.getUint32(o + 20, true), usize = dv.getUint32(o + 24, true);
      const nlen = dv.getUint16(o + 28, true), xlen = dv.getUint16(o + 30, true), clen = dv.getUint16(o + 32, true);
      const localOff = dv.getUint32(o + 42, true);
      const name = dec.decode(cd.subarray(o + 46, o + 46 + nlen));
      entries.push({ name, method, csize, usize, localOff });
      o += 46 + nlen + xlen + clen;
    }
    const byName = new Map(entries.map(e => [e.name, e]));
    return { entries, byName, src };
  }
  async function dataStart(src, e) {
    const h = await src.read(e.localOff, 30);
    const dv = new DataView(h.buffer, h.byteOffset, 30);
    if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('BAD_ZIP');
    return e.localOff + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return new Uint8Array(require('zlib').inflateRawSync(u8));
  }
  async function readEntry(zip, e) {
    const start = await dataStart(zip.src, e);
    const raw = await zip.src.read(start, e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw new Error('UNSUPPORTED_METHOD');
  }
  /* Entrega o conteúdo em pedaços (para gravar arquivos grandes sem ocupar a memória). */
  async function* entryChunks(zip, e, chunk = 4 * 1024 * 1024) {
    if (e.method !== 0) { yield await readEntry(zip, e); return; }
    const start = await dataStart(zip.src, e);
    for (let off = 0; off < e.csize; off += chunk) yield await zip.src.read(start + off, Math.min(chunk, e.csize - off));
  }
  async function readJSON(zip, name) {
    const e = zip.byName.get(name);
    if (!e) return null;
    return JSON.parse(dec.decode(await readEntry(zip, e)));
  }

  /* ---------- regras do formato ---------- */
  function mediaOf(project) {
    const out = [];
    for (const n of project.nodes || []) if (n.type === 'video' || n.type === 'image') { if (n.file) out.push(n.file); if (n.thumb) out.push(n.thumb); }
    return out;
  }
  /* Projeto raiz + (opcional) os projetos que as pastas dele abrem, em cascata. */
  function collect(all, rootId, withLinked) {
    const seen = new Set([rootId]), queue = [rootId];
    while (withLinked && queue.length) {
      const p = all[queue.shift()];
      if (!p) continue;
      for (const n of p.nodes || []) if (n.type === 'folder' && n.target && all[n.target] && !seen.has(n.target)) { seen.add(n.target); queue.push(n.target); }
    }
    return [...seen].filter(id => all[id]);
  }
  /* Versão "só links": tira os arquivos e deixa o card pronto para baixar de novo. */
  function linksOnly(project) {
    const p = JSON.parse(JSON.stringify(project));
    for (const n of p.nodes) if (n.type === 'video') {
      delete n.file; delete n.thumb; delete n.size;
      n.status = n.url ? 'link' : 'missing';
      n.progress = 0;
    }
    return p;
  }
  function manifest(rootId, ids, withMedia) {
    return { format: FORMAT, version: VERSION, app: 'DynBoard', exported: new Date().toISOString(), root: rootId, projects: ids, media: withMedia ? 'full' : 'links' };
  }
  function checkManifest(m) {
    if (!m || m.format !== FORMAT) throw new Error('NOT_DYNBOARD');
    if (m.version > VERSION) throw new Error('NEWER_VERSION');
    return m;
  }
  /* decisions: { [srcId]: 'replace' | 'copy' }. Devolve [{srcId, project}] com ids finais
     e as pastas reapontadas para as cópias quando a pasta aponta para um projeto do mesmo arquivo. */
  function planImport(incoming, decisions, newId) {
    const map = {};
    for (const p of incoming) map[p.id] = decisions[p.id] === 'copy' ? newId() : p.id;
    return incoming.map(src => {
      const p = JSON.parse(JSON.stringify(src));
      p.id = map[src.id];
      if (decisions[src.id] === 'copy') p.name = p.name + ' (cópia)';
      p.updated = Date.now();
      p.view = null;
      if (p.parent && map[p.parent]) p.parent = map[p.parent];
      for (const n of p.nodes || []) {
        if (n.type === 'folder' && map[n.target]) n.target = map[n.target];
        if (n.type === 'video' && (n.status === 'downloading')) n.status = n.file ? 'done' : 'link';
      }
      return { srcId: src.id, project: p };
    });
  }
  const paths = {
    manifest: 'manifest.json',
    project: id => `projects/${id}/project.json`,
    media: (id, name) => `projects/${id}/media/${name}`,
    mediaPrefix: id => `projects/${id}/media/`
  };

  return { FORMAT, VERSION, crc32, ZipWriter, readZip, readEntry, entryChunks, readJSON, mediaOf, collect, linksOnly, manifest, checkManifest, planImport, paths };
});
