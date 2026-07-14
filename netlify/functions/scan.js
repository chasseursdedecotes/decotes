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

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ erreur: "POST attendu." }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ erreur: "JSON invalide." }, 400); }

  const cle = String(process.env.OPENDART_KEY || body.cle || "").trim();
  const tickers = body.tickers, bgn = body.bgn, end = body.end;

  if (!cle) return json({ erreur: "Cle OpenDART absente. Definis OPENDART_KEY dans les variables d'environnement Netlify, ou saisis-la dans Reglages." }, 400);
  if (!Array.isArray(tickers) || !tickers.length) return json({ erreur: "Aucun ticker." }, 400);
  if (tickers.length > 12) return json({ erreur: "Lot trop gros (max 12) : le timeout de 10 s serait depasse." }, 400);

  try {
    // Table en dur : aucun telechargement, aucun timeout possible.
    const map = CORP;
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
