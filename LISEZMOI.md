# Décotes — poste de commandement

## Déployer (et le piège à éviter)

1. **app.netlify.com** → *Add new site* → *Deploy manually*.
2. Ouvre le dossier `decotes-app`, **sélectionne son CONTENU** (`index.html`, le dossier
   `netlify`, `netlify.toml`, `LISEZMOI.md`) et glisse **cette sélection**.
   **PAS le dossier lui-même** : Netlify doit voir `index.html` à la racine, sinon → 404.
3. *Site configuration* → *Environment variables* → ajoute :

   | Nom | Valeur | Requis |
   |---|---|---|
   | `OPENDART_KEY` | ta clé DART (40 caractères) | **oui** |
   | `RESEND_KEY` | clé resend.com, pour la veille par mail | non |
   | `MAIL_DEST` | ton adresse mail | non |

4. *Deploys* → **Trigger deploy** → *Clear cache and deploy site*.

## Vérifier que ça marche : une seule URL

Ouvre dans ton navigateur :

```
https://TON-SITE.netlify.app/.netlify/functions/ping
```

- **Du JSON s'affiche** → les fonctions sont déployées. Il te dit aussi si `OPENDART_KEY`
  est définie (sans jamais l'afficher).
- **404** → les fonctions ne sont pas déployées : le dossier `netlify/` n'était pas à la
  racine de ce que tu as déposé. Recommence l'étape 2.

## Pourquoi zéro dépendance npm

Un déploiement par glisser-déposer **ne lance aucun build**, donc aucun `npm install`.
Toute fonction important un paquet npm échoue et renvoie **404**. Ici, tout est natif au
runtime Node (`DecompressionStream` pour lire le ZIP de la table DART). Rien à installer,
rien à builder, rien qui casse.

## Pourquoi la veille part par lots

Une fonction Netlify **expire à 10 secondes**. Balayer 53 titres d'un coup, c'est 106
appels : impossible. L'app envoie donc des lots de 8, traités en parallèle côté serveur.
Le bouton affiche la progression (8/53, 16/53…).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | l'app. JS natif, zéro dépendance, zéro CDN. Importe les mémos en `.html` ou `.json`. |
| `netlify/functions/dart.js` | socle commun : ZIP natif, table ticker → corp_code. |
| `netlify/functions/scan.js` | le relais DART. Sans lui, aucun scan (OpenDART n'a pas de CORS). |
| `netlify/functions/bilan.js` | tire le bilan primaire d'un titre. |
| `netlify/functions/veille-auto.js` | la veille **automatique**, app fermée. Lundi 8h UTC. |
| `netlify/functions/ping.js` | diagnostic. À ouvrir en cas de doute. |
| `netlify.toml` | déclare les fonctions et le cron. |

## La veille automatique

Tourne sur les serveurs Netlify, sans que tu ouvres quoi que ce soit.
**Une semaine calme ne génère aucun mail** : le silence est déjà une information.
Fréquence : `schedule` dans `netlify.toml`.

Pour les mails : compte gratuit sur **resend.com**, clé dans `RESEND_KEY`, ton adresse dans
`MAIL_DEST`. Sans ça, les signaux sont visibles dans les logs Netlify (*Functions* → *veille-auto*).

## La limite qui ne dépendra jamais du code

Le champ `보유목적` (단순투자 / 일반투자 / 경영참가) **n'est renvoyé par aucune API OpenDART**.
Il n'existe que dans le texte du dépôt. Pour chaque franchissement, l'app affiche un lien
DART et trois boutons : tu ouvres, tu lis, tu cliques. Seul geste manuel, et il est
irréductible. C'est aussi le plus important : **단순투자** est passif et n'arme rien,
**일반투자** précède une AG et arme le trigger.
