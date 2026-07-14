/**
 * scan.js — Relais OpenDART. AUTONOME.
 *
 * QUATRE CONTRAINTES, apprises a la dure :
 *
 * 1. CORS. OpenDART ne renvoie pas d'en-tetes CORS : aucun navigateur ne peut
 *    l'appeler directement. Cette fonction fait l'appel cote serveur.
 *
 * 2. AUCUNE DEPENDANCE NPM. Un deploiement Netlify par glisser-deposer ne lance
 *    aucun build, donc aucun `npm install`. Un import npm = fonction absente = 404.
 *
 * 3. AUCUN IMPORT LOCAL. Netlify traite CHAQUE fichier .js du dossier functions
 *    comme une fonction a part entiere. Un module partage sans handler par defaut
 *    fait echouer le bundling, et peut faire tomber TOUTES les fonctions.
 *    D'ou la duplication du socle ci-dessous. Moins elegant, impossible a casser.
 *
 * 4. TIMEOUT 10 SECONDES. 54 titres = 108 appels : impossible en sequence.
 *    L'app envoie des LOTS de 8, traites ici EN PARALLELE.
 *
 * ATTESTATION : list.json renvoie TOUS les depots de la fenetre, sans presumer du
 * type. Aucun filtre par mots-cles. C'est ce qui aurait attrape le franchissement
 * VIP sur Sindoh du 06/07/2026, que la veille par mots-cles avait manque.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

// ZIP natif : on lit le repertoire central pour obtenir la taille compressee EXACTE.
// Decompresser jusqu'a la fin du buffer ferait echouer le flux sur la fin d'archive.
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

let CACHE = null;
async function codes(cle) {
  if (CACHE) return CACHE;
  const r = await fetch("https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=" + cle);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    let msg;
    try { msg = JSON.parse(new TextDecoder().decode(buf)).message; }
    catch (e) { msg = new TextDecoder().decode(buf).slice(0, 120); }
    throw new Error("Cle OpenDART refusee : " + msg);
  }
  const xml = await dezipper(buf);
  const map = {};
  const re = /<corp_code>([^<]*)<\/corp_code>[\s\S]*?<stock_code>([^<]*)<\/stock_code>/g;
  let m;
  while ((m = re.exec(xml))) {
    const c = m[1].trim(), s = m[2].trim();
    if (s && c) map[s] = c;
  }
  CACHE = map;
  return map;
}

const api = async (ep, p) =>
  (await fetch("https://opendart.fss.or.kr/api/" + ep + ".json?" + new URLSearchParams(p))).json();

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ erreur: "POST attendu." }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ erreur: "JSON invalide." }, 400); }

  const cle = process.env.OPENDART_KEY || body.cle;
  const tickers = body.tickers, bgn = body.bgn, end = body.end;

  if (!cle) return json({ erreur: "Cle OpenDART absente. Definis OPENDART_KEY dans les variables d'environnement Netlify, ou saisis-la dans Reglages." }, 400);
  if (!Array.isArray(tickers) || !tickers.length) return json({ erreur: "Aucun ticker." }, 400);
  if (tickers.length > 12) return json({ erreur: "Lot trop gros (max 12) : le timeout de 10 s serait depasse." }, 400);

  try {
    // Les corp_codes viennent de l'app (fonction `codes`, appelée UNE fois et mise
    // en cache). On ne retelecharge la table QUE si l'app ne les fournit pas :
    // c'est ce retelechargement a chaque lot qui causait le timeout 504.
    const map = (body.codes && Object.keys(body.codes).length) ? body.codes : await codes(cle);
    const non_resolus = [];

    const bruts = await Promise.all(tickers.map(async (t) => {
      const corp = map[t];
      if (!corp) { non_resolus.push(t); return null; }
      const r = { ticker: t, corp_code: corp, filings: [], majorstock: [], erreurs: [] };

      const deux = await Promise.all([
        api("list", { crtfc_key: cle, corp_code: corp, bgn_de: bgn, end_de: end,
          page_no: "1", page_count: "100" }),
        api("majorstock", { crtfc_key: cle, corp_code: corp }),
      ]);
      const l = deux[0], m = deux[1];

      // 013 = aucune donnee dans la fenetre : RAS atteste, pas une erreur.
      if (l.status === "000") r.filings = l.list || [];
      else if (l.status !== "013") r.erreurs.push("list:" + l.status);

      if (m.status === "000") {
        r.majorstock = (m.list || []).map((x) => {
          const d = (x.rcept_dt || "").replace(/-/g, "");
          return Object.assign({}, x, { in_window: d >= bgn && d <= end });
        });
      } else if (m.status !== "013") r.erreurs.push("majorstock:" + m.status);

      return r;
    }));

    const resultats = bruts.filter(Boolean);

    return json({
      ok: true,
      fenetre: { bgn: bgn, end: end },
      attestes: resultats.filter((r) => !r.erreurs.length).length,
      total: tickers.length,
      non_resolus: non_resolus,
      resultats: resultats,
    });
  } catch (e) {
    return json({ erreur: String(e.message || e) }, 500);
  }
};
