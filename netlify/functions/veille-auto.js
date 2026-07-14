/**
 * veille-auto.js — Veille PLANIFIEE. AUTONOME (aucune dependance, aucun import local).
 *
 * Tourne sur les serveurs Netlify, app fermee, Mac eteint.
 * Calendrier dans netlify.toml (par defaut lundi 8h UTC).
 *
 * ELLE NE T'ECRIT QUE S'IL Y A QUELQUE CHOSE. Une semaine calme ne genere aucun
 * mail : le silence est deja une information.
 *
 * VARIABLES D'ENVIRONNEMENT :
 *   OPENDART_KEY  obligatoire
 *   RESEND_KEY    optionnel (resend.com), pour recevoir le digest par mail
 *   MAIL_DEST     optionnel, ton adresse
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


const TICKERS = ["029530", "001560", "009680", "016580", "415380", "010240", "033270", "005680", "010960", "009300", "033920", "221980", "003650", "024800", "004250", "408920", "241710", "005710", "143240", "210540", "002170", "066620", "263020", "080010", "004150", "023910", "015230", "069730", "000590", "014440", "053620", "037350", "192440", "035890", "006660", "017480", "000970", "025000", "032560", "004780", "084010", "024090", "079960", "032750", "025530", "123700", "004890", "001770", "021820", "004700", "000850", "079170", "120240", "014830"];

const NOMS = {"029530": "Sindoh", "001560": "Cheil Grinding Wheel", "009680": "Motonic", "016580": "Whan In Pharm", "415380": "Studio Samick", "010240": "Heungkuk Metaltech", "033270": "Korea United Pharm", "005680": "Samyoung Electronics", "005710": "Daewon Sanup", "143240": "Saramin", "010960": "Samho Development", "009300": "Sam-A Pharm", "033920": "Muhak", "221980": "KD Chem", "003650": "Michang Oil", "263020": "DK&D"};

// Ce qui merite de te reveiller. Le reste est consigne dans les logs, pas notifie.
const CHAUD = {
  "\uc18c\uac01": "Annulation d'actions",
  "\uc790\uae30\uc8fc\uc2dd": "Autocontrole",
  "\ub300\ub7c9\ubcf4\uc720": "Franchissement 5%",
  "\uacf5\uac1c\ub9e4\uc218": "OPA / TOB",
  "\uae30\uc5c5\uac00\uce58": "Value-Up",
  "\uc8fc\uc8fc\uc81c\uc548": "Proposition d'actionnaire",
  "\ucd5c\ub300\uc8fc\uc8fc": "Changement de controle",
  "\uc720\uc0c1\uc99d\uc790": "Dilution",
  "\ud569\ubcd1": "Fusion",
  "\ubd84\ud560": "Scission"
};
const FONDS = ["\ube0c\uc774\uc544\uc774\ud53c","\uc584\ub77c\uc778","\ud50c\ub798\uc2dc\ub77c\uc774\ud2b8",
  "\ubc38\ub958\ud30c\ud2b8\ub108\uc2a4","\ud654\uc774\ud2b8\ubc15\uc2a4","\ud321\ub9ac\uc11c",
  "\ucf00\uc774\uc528\uc9c0\uc544\uc774","\uba38\uc2a4\ud2b8"];

const chaud = (n) => { for (const k in CHAUD) { if (n && n.indexOf(k) >= 0) return CHAUD[k]; } return null; };
const fondsDe = (t) => { if (!t) return null; for (const f of FONDS) { if (t.indexOf(f) >= 0) return f; } return null; };

export default async () => {
  const cle = String(process.env.OPENDART_KEY || "").trim();
  if (!cle) { console.error("OPENDART_KEY absente."); return new Response("cle absente", { status: 500 }); }

  const end = new Date();
  const bgn = new Date(Date.now() - 7 * 864e5);
  const F = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

  const map = CORP;
  const signaux = [];
  let attestes = 0;

  // Lots de 10, paralleles a l'interieur du lot.
  for (let i = 0; i < TICKERS.length; i += 10) {
    const lot = TICKERS.slice(i, i + 10);
    await Promise.all(lot.map(async (t) => {
      const corp = map[t];
      if (!corp) return;
      let ok = true;

      const deux = await Promise.all([
        api("list", { crtfc_key: cle, corp_code: corp, bgn_de: F(bgn), end_de: F(end),
          page_no: "1", page_count: "100" }),
        api("majorstock", { crtfc_key: cle, corp_code: corp }),
      ]);
      const l = deux[0], m = deux[1];

      if (l.status === "000") {
        for (const x of (l.list || [])) {
          const type = chaud(x.report_nm);
          if (!type) continue;                 // consigne, pas notifie
          signaux.push({ t: t, nom: NOMS[t] || t, date: x.rcept_dt, type: type,
            titre: x.report_nm, par: x.flr_nm, fonds: fondsDe(x.flr_nm), no: x.rcept_no });
        }
      } else if (l.status !== "013") ok = false;

      if (m.status === "000") {
        for (const x of (m.list || [])) {
          const d = (x.rcept_dt || "").replace(/-/g, "");
          if (d < F(bgn) || d > F(end)) continue;
          signaux.push({ t: t, nom: NOMS[t] || t, date: x.rcept_dt, type: "Franchissement 5%",
            titre: x.report_tp + " - " + x.stkrt + " % (delta " + x.stkrt_irds + ")",
            par: x.repror, fonds: fondsDe(x.repror), no: x.rcept_no, alire: true });
        }
      } else if (m.status !== "013") ok = false;

      if (ok) attestes++;
    }));
  }

  console.log("Veille : " + attestes + "/" + TICKERS.length + " attestes, " + signaux.length + " signaux.");

  if (!signaux.length) return new Response("RAS - rien cette semaine.", { status: 200 });

  const cleMail = process.env.RESEND_KEY, dest = process.env.MAIL_DEST;
  if (!cleMail || !dest) {
    console.log(JSON.stringify(signaux, null, 2));
    return new Response("signaux trouves, mail non configure", { status: 200 });
  }

  signaux.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const lignes = signaux.map((s) =>
    '<tr><td style="padding:10px 12px;border-bottom:1px solid #eee;color:#888;white-space:nowrap">' + s.date + '</td>' +
    '<td style="padding:10px 12px;border-bottom:1px solid #eee"><b>' + s.type + '</b>' +
    (s.fonds ? ' <span style="background:#fff8e6;color:#9a6700;padding:1px 6px;border-radius:9px;font-size:12px">' + s.fonds + '</span>' : '') +
    (s.alire ? ' <span style="color:#9a6700;font-size:12px">objet a lire sur DART</span>' : '') +
    '<div style="color:#666;font-size:13px;margin-top:2px">' + s.t + ' - ' + s.nom + ' - ' + s.titre +
    (s.par ? ' (' + s.par + ')' : '') + '</div></td>' +
    '<td style="padding:10px 12px;border-bottom:1px solid #eee">' +
    '<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + s.no + '" style="color:#0066cc;text-decoration:none">DART</a></td></tr>'
  ).join("");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + cleMail, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Decotes <onboarding@resend.dev>",
      to: [dest],
      subject: "Decotes - " + signaux.length + " signal" + (signaux.length > 1 ? "s" : "") + " cette semaine",
      html: '<div style="font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;color:#1d1d1f">' +
        '<h2 style="font-weight:600">' + signaux.length + " signal" + (signaux.length > 1 ? "s" : "") + '</h2>' +
        '<p style="color:#6e6e73;font-size:14px">Fenetre ' + F(bgn) + " au " + F(end) + " - " + attestes + "/" + TICKERS.length +
        ' titres attestes sur le flux DART officiel.</p>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px">' + lignes + '</table>' +
        '<p style="color:#a1a1a6;font-size:12px;margin-top:20px">Le champ 보유목적 (단순투자 / 일반투자) n\'est renvoye par aucune API. ' +
        'Pour un franchissement, ouvrir le depot et le lire : c\'est lui qui arme le trigger, pas le pourcentage.</p></div>',
    }),
  });

  return new Response("notifie", { status: 200 });
};

export const config = { schedule: "0 8 * * 1" };   // lundi 8h UTC
