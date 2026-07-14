/**
 * codes.js — Résout ticker (6 chiffres) → corp_code (8 chiffres). AUTONOME.
 *
 * POURQUOI CETTE FONCTION EXISTE.
 * La table DART (corpCode.xml) fait ~20 Mo décompressés. La télécharger et la
 * parser prend plusieurs secondes. Or `scan` la retéléchargeait À CHAQUE LOT :
 * sur un démarrage à froid, 7 lots = 7 téléchargements = timeout 504.
 *
 * Cette table ne change quasiment jamais. On la résout donc UNE FOIS, l'app garde
 * le résultat en cache, et `scan` reçoit les corp_codes tout faits. Le scan ne
 * fait plus que les appels qui comptent.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

async function dezipper(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP illisible.");
  const cd = dv.getUint32(eocd + 16, true);
  const method = dv.getUint16(cd + 10, true);
  const compSize = dv.getUint32(cd + 20, true);
  const localOff = dv.getUint32(cd + 42, true);
  const nameLen = dv.getUint16(localOff + 26, true);
  const extraLen = dv.getUint16(localOff + 28, true);
  const start = localOff + 30 + nameLen + extraLen;
  const corps = bytes.subarray(start, start + compSize);
  if (method === 0) return new TextDecoder("utf-8").decode(corps);
  const flux = new Blob([corps]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(flux).text();
}

let CACHE = null;   // persiste entre invocations chaudes

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ erreur: "POST attendu." }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ erreur: "JSON invalide." }, 400); }

  const cle = process.env.OPENDART_KEY || body.cle;
  const tickers = body.tickers;
  if (!cle) return json({ erreur: "Cle OpenDART absente." }, 400);
  if (!Array.isArray(tickers) || !tickers.length) return json({ erreur: "Aucun ticker." }, 400);

  try {
    if (!CACHE) {
      const r = await fetch("https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=" + cle);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(buf)).message; }
        catch (e) { msg = new TextDecoder().decode(buf).slice(0, 120); }
        throw new Error("Cle OpenDART refusee : " + msg);
      }
      const xml = await dezipper(buf);

      // Parse par decoupage plutot que par regex globale sur 20 Mo :
      // beaucoup plus rapide, et sans risque de backtracking.
      const map = {};
      const blocs = xml.split("<list>");
      for (let i = 1; i < blocs.length; i++) {
        const b = blocs[i];
        const c1 = b.indexOf("<corp_code>");
        const s1 = b.indexOf("<stock_code>");
        if (c1 < 0 || s1 < 0) continue;
        const corp = b.slice(c1 + 11, b.indexOf("</corp_code>", c1)).trim();
        const stock = b.slice(s1 + 12, b.indexOf("</stock_code>", s1)).trim();
        if (stock && corp) map[stock] = corp;
      }
      CACHE = map;
    }

    const codes = {};
    const absents = [];
    for (const t of tickers) {
      if (CACHE[t]) codes[t] = CACHE[t];
      else absents.push(t);
    }

    return json({ ok: true, codes, absents, total: Object.keys(CACHE).length });
  } catch (e) {
    return json({ erreur: String(e.message || e) }, 500);
  }
};
