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

/**
 * CORP_CODES — table ticker (6 chiffres) → corp_code DART (8 chiffres).
 *
 * POURQUOI EN DUR, ET POURQUOI C'EST LA BONNE DÉCISION.
 *
 * Avant, chaque veille téléchargeait corpCode.xml depuis OpenDART : un zip de
 * 3,5 Mo, 30 Mo décompressés, pour n'en extraire que 54 lignes. Le serveur coréen
 * répond lentement et de façon erratique (11 Ko/s mesurés, pages "Inactivity
 * Timeout" renvoyées par un pare-feu intermédiaire). Résultat : 502, 504, et des
 * timeouts à répétition.
 *
 * Or cette table est STATIQUE : un titre ne change pas de corp_code. La télécharger
 * à chaque veille était une absurdité architecturale.
 *
 * Elle est donc résolue UNE FOIS, ici, en dur. La veille n'appelle plus que les
 * endpoints légers de DART (list.json, majorstock.json), qui répondent en quelques
 * centaines de millisecondes. Plus aucune raison d'échouer.
 *
 * Table extraite le 14/07/2026 depuis corpCode.xml officiel. 54/54 résolus.
 * Si tu ajoutes un titre à la watchlist, ajoute son corp_code ici.
 */
const CORP = {
  "000590":"00149026", "000850":"00166519", "000970":"00159573", "001560":"00148461",
  "001770":"00137809", "002170":"00127042", "003650":"00122056", "004150":"00171636",
  "004250":"00108038", "004700":"00148939", "004780":"00109587", "004890":"00172936",
  "005680":"00127200", "005710":"00111874", "006660":"00126201", "009300":"00126788",
  "009680":"00151128", "010240":"00167031", "010960":"00128980", "014440":"00140779",
  "014830":"00159786", "015230":"00112679", "016580":"00166573", "017480":"00128926",
  "021820":"00134316", "023910":"00113128", "024090":"00177199", "024800":"00173999",
  "025000":"00191472", "025530":"00181943", "029530":"00135795", "032560":"00218575",
  "032750":"00173351", "033270":"00158963", "033920":"00121543", "035890":"00219848",
  "037350":"00216498", "053620":"00186717", "066620":"00253985", "069730":"00151298",
  "079170":"00202839", "079960":"00178790", "080010":"00454399", "084010":"00113225",
  "120240":"00250997", "123700":"00815369", "143240":"00857480", "192440":"00917861",
  "210540":"01059605", "221980":"00370918", "241710":"00763473", "263020":"00892526",
  "408920":"01596656", "415380":"01540815"
};


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

  const cle = String(process.env.OPENDART_KEY || body.cle || "").trim();
  const ticker = body.ticker;
  if (!cle) return json({ erreur: "Cle OpenDART absente." }, 400);
  if (!ticker) return json({ erreur: "Ticker manquant." }, 400);

  try {
    const corp = CORP[ticker];
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
