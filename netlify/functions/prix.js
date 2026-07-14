/**
 * prix.js — Cours de marché quasi-temps réel, via Yahoo Finance. AUTONOME.
 *
 * POURQUOI CETTE SOURCE. César privilégie explicitement les cours frais, même non
 * officiels, sur les agrégateurs lents. C'est exactement l'usage : le COURS n'est
 * pas soumis à la règle "bilan primaire obligatoire" (celle-ci ne vaut que pour
 * les postes comptables). Yahoo Finance couvre les tickers coréens et japonais :
 *   - KOSPI  : {ticker}.KS   (ex. 005930.KS)
 *   - KOSDAQ : {ticker}.KQ   (ex. 029530.KQ)
 *   - TSE    : {ticker}.T    (ex. 7203.T)
 *
 * LA RÉSERVE, ASSUMÉE. C'est une API NON documentée, NON contractuelle. Elle peut
 * changer de forme ou bloquer les IP de centres de données sans préavis — le même
 * risque que corpCode.xml cette semaine. C'est pourquoi :
 *   - chaque ticker échoue INDÉPENDAMMENT (un échec n'entraîne pas les autres) ;
 *   - le KOSPI est essayé en premier, le KOSDAQ en repli (la plupart de la
 *     watchlist est KOSDAQ, mais on ne le sait pas à l'avance sans base externe) ;
 *   - la réponse dit toujours la source et l'heure, pour qu'on sache que c'est
 *     un cours de marché, pas un cours de mémo figé.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

async function coursYahoo(symbole) {
  const r = await fetch(
    "https://query1.finance.yahoo.com/v8/finance/chart/" + symbole + "?interval=1d&range=1d",
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if (!res || !res.meta || res.meta.regularMarketPrice == null) throw new Error("pas de prix");
  return {
    prix: res.meta.regularMarketPrice,
    devise: res.meta.currency,
    heure: new Date((res.meta.regularMarketTime || 0) * 1000).toISOString(),
  };
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ erreur: "POST attendu." }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return json({ erreur: "JSON invalide." }, 400); }

  const items = body.tickers; // [{ticker, place}]
  if (!Array.isArray(items) || !items.length) return json({ erreur: "Aucun ticker." }, 400);
  if (items.length > 20) return json({ erreur: "Lot trop gros (max 20)." }, 400);

  const resultats = await Promise.all(items.map(async (it) => {
    const t = String(it.ticker), place = it.place || "KRX";
    const essais = place === "TSE" ? [t + ".T"] : [t + ".KS", t + ".KQ"];

    for (const sym of essais) {
      try {
        const c = await coursYahoo(sym);
        return { ticker: t, ok: true, symbole: sym, prix: c.prix, devise: c.devise, heure: c.heure };
      } catch (e) { /* essai suivant */ }
    }
    return { ticker: t, ok: false, erreur: "aucun symbole Yahoo n'a répondu (" + essais.join(", ") + ")" };
  }));

  return json({
    ok: true,
    source: "Yahoo Finance (non officiel, best-effort)",
    resultats,
  });
};
