/**
 * momentum.js — Momentum 12-1 et 6-1, via l'historique Yahoo Finance. AUTONOME.
 *
 * POURQUOI CETTE MESURE. César calcule déjà ce momentum manuellement, chaque
 * trimestre, via TradingView, sur 37 positions. Il exige la CONCORDANCE des deux
 * fenêtres avant d'agir : les deux positives ou les deux négatives, jamais un
 * signal isolé. Cette fonction automatise l'extraction, pas la décision.
 *
 * LA MÉTHODE. 12-1 exclut le dernier mois (effet de retournement à court terme
 * bien documenté) : rendement du prix à t-12 mois jusqu'à t-1 mois. Le 6-1 fait
 * de même sur 6 mois. On lit l'historique quotidien sur 2 ans et on interpole
 * les prix aux dates cibles.
 *
 * RÉSERVE ASSUMÉE, IDENTIQUE À prix.js : API non documentée, non contractuelle.
 * Chaque titre échoue indépendamment.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

function prixAuPlusProche(closes, timestamps, cible) {
  let meilleur = null, meilleurEcart = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const ecart = cible - timestamps[i];
    if (ecart >= 0 && ecart < meilleurEcart) { meilleurEcart = ecart; meilleur = closes[i]; }
  }
  return meilleur;
}

async function momentumYahoo(symbole) {
  const r = await fetch(
    "https://query1.finance.yahoo.com/v8/finance/chart/" + symbole + "?interval=1d&range=2y",
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if (!res || !res.timestamp) throw new Error("pas d'historique");

  const ts = res.timestamp;
  const closes = res.indicators.quote[0].close;
  const maintenant = ts[ts.length - 1];
  const JOUR = 86400;

  const p_t1m  = prixAuPlusProche(closes, ts, maintenant - 30 * JOUR);
  const p_t6m  = prixAuPlusProche(closes, ts, maintenant - 182 * JOUR);
  const p_t12m = prixAuPlusProche(closes, ts, maintenant - 365 * JOUR);

  if (!p_t1m || !p_t6m || !p_t12m) throw new Error("historique insuffisant (moins de 12 mois)");

  const m12_1 = (p_t1m / p_t12m - 1) * 100;
  const m6_1  = (p_t1m / p_t6m  - 1) * 100;

  return {
    m12_1: Math.round(m12_1 * 10) / 10,
    m6_1: Math.round(m6_1 * 10) / 10,
    concordant: (m12_1 > 0) === (m6_1 > 0),
    calcule_le: new Date().toISOString(),
  };
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ erreur: "POST attendu." }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return json({ erreur: "JSON invalide." }, 400); }

  const items = body.tickers;
  if (!Array.isArray(items) || !items.length) return json({ erreur: "Aucun ticker." }, 400);
  if (items.length > 8) return json({ erreur: "Lot trop gros (max 8)." }, 400);

  const resultats = await Promise.all(items.map(async (it) => {
    const t = String(it.ticker), place = it.place || "KRX";
    const essais = place === "TSE" ? [t + ".T"] : [t + ".KS", t + ".KQ"];
    for (const sym of essais) {
      try {
        const m = await momentumYahoo(sym);
        return Object.assign({ ticker: t, ok: true, symbole: sym }, m);
      } catch (e) { /* essai suivant */ }
    }
    return { ticker: t, ok: false, erreur: "aucun symbole n'a répondu (" + essais.join(", ") + ")" };
  }));

  return json({ ok: true, source: "Yahoo Finance (non officiel, best-effort)", resultats: resultats });
};
