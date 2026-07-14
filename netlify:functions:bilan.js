/**
 * bilan.js — Tire le bilan officiel DART d'un titre. AUTONOME.
 *
 * Raison d'etre : le piege Korea United Pharm (ecart de 2,5x sur les capitaux
 * propres via agregateur, these inversee). Le bilan vient de DART, jamais d'un
 * agregateur.
 *
 * LIMITE ASSUMEE : le mapping des comptes coreens est heuristique. Les postes
 * bruts sont renvoyes a cote, pour verification. Ne jamais batir une VANN sur un
 * mapping non verifie.
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

const num = (v) => {
  const n = parseFloat(String(v || "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

const trouve = (liste, motifs, exclure) => {
  exclure = exclure || [];
  for (const it of liste) {
    const nm = (it.account_nm || "").replace(/\s/g, "");
    if (exclure.some((x) => nm.indexOf(x) >= 0)) continue;
    if (motifs.some((x) => nm.indexOf(x) >= 0)) {
      const v = num(it.thstrm_amount);
      if (v != null) return v;
    }
  }
  return null;
};

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ erreur: "POST attendu." }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ erreur: "JSON invalide." }, 400); }

  const cle = process.env.OPENDART_KEY || body.cle;
  const ticker = body.ticker;
  if (!cle) return json({ erreur: "Cle OpenDART absente." }, 400);
  if (!ticker) return json({ erreur: "Ticker manquant." }, 400);

  try {
    const map = await codes(cle);
    const corp = map[ticker];
    if (!corp) return json({ erreur: "Ticker " + ticker + " absent de la table DART." }, 404);

    const an = new Date().getFullYear();
    const essais = [
      [an, "11013", "T1"], [an - 1, "11011", "annuel"],
      [an - 1, "11014", "T3"], [an - 2, "11011", "annuel"],
    ];

    let data = null, exercice = null, periode = null;
    for (const e of essais) {
      const r = await fetch("https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?" +
        new URLSearchParams({ crtfc_key: cle, corp_code: corp, bsns_year: String(e[0]),
          reprt_code: e[1], fs_div: "CFS" }));
      const d = await r.json();
      if (d.status === "000" && d.list && d.list.length) {
        data = d.list; exercice = e[0]; periode = e[2]; break;
      }
    }
    if (!data) return json({ erreur: "Aucun etat financier trouve sur DART pour ce titre." }, 404);

    const bs = data.filter((x) => x.sj_div === "BS");
    const comptes = {
      actif_total:      trouve(bs, ["\uc790\uc0b0\ucd1d\uacc4"]),
      actif_courant:    trouve(bs, ["\uc720\ub3d9\uc790\uc0b0"], ["\ube44\uc720\ub3d9"]),
      tresorerie:       trouve(bs, ["\ud604\uae08\ubc0f\ud604\uae08\uc131\uc790\uc0b0"]),
      placements_ct:    trouve(bs, ["\ub2e8\uae30\uae08\uc735\uc0c1\ud488", "\ub2e8\uae30\ud22c\uc790\uc790\uc0b0"]),
      creances:         trouve(bs, ["\ub9e4\ucd9c\ucc44\uad8c"]),
      stocks:           trouve(bs, ["\uc7ac\uace0\uc790\uc0b0"]),
      passif_total:     trouve(bs, ["\ubd80\ucc44\ucd1d\uacc4"]),
      passif_courant:   trouve(bs, ["\uc720\ub3d9\ubd80\ucc44"], ["\ube44\uc720\ub3d9"]),
      capitaux_propres: trouve(bs, ["\uc790\ubcf8\ucd1d\uacc4"]),
      autocontrole:     trouve(bs, ["\uc790\uae30\uc8fc\uc2dd"]),
    };

    const tresor = (comptes.tresorerie || 0) + (comptes.placements_ct || 0);
    const calcul = {
      net_cash: comptes.passif_total != null ? tresor - comptes.passif_total : null,
      vann: (comptes.actif_courant != null && comptes.passif_total != null)
        ? comptes.actif_courant - comptes.passif_total : null,
      vant: comptes.capitaux_propres,
    };

    return json({
      ok: true, ticker: ticker, corp_code: corp, exercice: exercice, periode: periode,
      comptes: comptes, calcul: calcul,
      avertissement: "Mapping des comptes heuristique. La VANT ne deduit pas les incorporels. Verifier les postes bruts avant d'en tirer une decote.",
      brut: bs.slice(0, 40).map((x) => ({ compte: x.account_nm, montant: num(x.thstrm_amount) })),
    });
  } catch (e) {
    return json({ erreur: String(e.message || e) }, 500);
  }
};
