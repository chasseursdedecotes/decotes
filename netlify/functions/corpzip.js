/**
 * corpzip.js — Relais BRUT de la table DART. Ne fait RIEN d'autre.
 *
 * POURQUOI CE CHANGEMENT.
 * La version précédente (`codes.js`) téléchargeait le zip, décompressait 20 Mo de
 * XML et le parsait, le tout dans une fonction Netlify limitée à 10 secondes et à
 * une mémoire contrainte. Elle plantait : HTTP 502.
 *
 * Le travail lourd n'a rien à faire ici. Cette fonction se contente de RELAYER les
 * octets du zip (~1,5 Mo), ce qui prend moins d'une seconde et ne consomme presque
 * rien. La décompression et le parsing se font dans le NAVIGATEUR, qui n'a ni
 * limite de temps ni limite de mémoire, et qui sait faire les deux nativement.
 *
 * La seule raison d'être de ce relais reste le CORS : OpenDART ne renvoie pas les
 * en-têtes qui permettraient au navigateur d'appeler directement.
 */
export default async (request) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  let cle = process.env.OPENDART_KEY;
  if (!cle && request.method === "POST") {
    try { cle = (await request.json()).cle; } catch (e) { /* ignore */ }
  }
  if (!cle) {
    return new Response(JSON.stringify({ erreur: "Cle OpenDART absente." }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const r = await fetch("https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=" + cle);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Pas un zip : OpenDART a renvoyé une erreur JSON (clé refusée, quota...).
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return new Response(new TextDecoder().decode(bytes),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  return new Response(buf, {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/zip", "Cache-Control": "public, max-age=86400" },
  });
};
