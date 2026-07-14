/**
 * ping.js — Diagnostic. Ouvre /.netlify/functions/ping dans ton navigateur.
 *
 * Si tu vois du JSON : les fonctions sont déployées.
 * Si tu vois 404 : elles ne le sont pas (le dossier netlify/ n'est pas à la racine
 * du déploiement, ou netlify.toml manque).
 *
 * Il dit aussi si OPENDART_KEY est bien définie, SANS jamais l'afficher.
 */
export default async () => {
  const cle = process.env.OPENDART_KEY;
  return new Response(JSON.stringify({
    ok: true,
    message: "Les fonctions Netlify sont déployées.",
    opendart_key: cle
      ? "définie (" + cle.length + " caractères)"
      : "ABSENTE — ajoute OPENDART_KEY dans Site settings > Environment variables, puis redéploie.",
    node: process.version,
    decompression_native: (typeof DecompressionStream !== "undefined")
      ? "disponible"
      : "INDISPONIBLE (runtime trop ancien)",
    heure: new Date().toISOString(),
  }, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
};
