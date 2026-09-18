# NSA — Site de gestion de tournoi (version connectée)

Même design et mêmes fonctionnalités que le prototype `nsa-site.html`, mais toutes
les données sont désormais dans une base **Supabase**. Ce que l'admin modifie est
écrit en base : les visiteurs le voient, y compris après la déconnexion de l'admin,
sur n'importe quel appareil.

```
index.html            la page (structure identique au prototype)
assets/styles.css     le CSS du prototype, repris tel quel
assets/config.js      vos identifiants Supabase (à remplir)
assets/app.js         l'application + la couche base de données
supabase/schema.sql   à exécuter une fois dans Supabase
vercel.json           configuration du déploiement
```

Aucune étape de build, aucune dépendance npm : c'est un site statique qui parle
directement à Supabase depuis le navigateur.

---

## 1. Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com) → **New project**.
2. Choisir un nom, un mot de passe de base de données, et la région la plus proche
   de vos utilisateurs (par exemple *Frankfurt* ou *Paris*).
3. Attendre la fin de l'initialisation (1 à 2 minutes).

## 2. Créer les tables

1. Dans le projet : **SQL Editor** → **New query**.
2. Coller l'intégralité de `supabase/schema.sql` et cliquer sur **Run**.

Ce script crée les tables (`teams`, `players`, `ties`, `sliders`, `settings`), les
règles de sécurité, le bucket d'images `media`, les 15 confrontations vides du
tableau pour chaque compétition et les réglages par défaut. Il peut être relancé
sans risque.

> Si la partie « storage » renvoie une erreur de permissions, créez le bucket à la
> main : **Storage** → **New bucket** → nom `media`, case **Public bucket** cochée.

## 3. Créer le compte administrateur

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email et mot de passe de votre choix (ex. `admin@nsa.org`), et cocher
   **Auto Confirm User**.
3. **Authentication** → **Sign In / Providers** : laisser « Email » activé et
   **désactiver les inscriptions publiques** (*Allow new users to sign up* → off),
   pour que personne ne puisse se créer un compte et écrire dans la base.

Ce compte remplace les identifiants en dur du prototype. Pour en changer le mot de
passe plus tard : **Authentication** → **Users** → menu « … » de l'utilisateur.

## 4. Renseigner les clés dans le site

**Project Settings** → **API**, puis recopier dans `assets/config.js` :

```js
window.NSA_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  STORAGE_BUCKET: "media",
};
```

La clé `anon` est faite pour être publique : ce qui protège les données, ce sont
les règles RLS du script SQL (lecture pour tous, écriture uniquement si connecté).
**Ne jamais mettre la clé `service_role` dans ce fichier.**

## 5. Tester en local

```bash
cd nsa-site
python3 -m http.server 5173
```

Puis ouvrir `http://localhost:5173`.

- Pour entrer dans le panneau admin : taper `nsaadmin` au clavier, ou ouvrir
  `http://localhost:5173/#admin` (l'astuce des 15 taps sur le pied de page reste
  disponible sur mobile).
- Onglet **Manage Teams** : le bouton « Générer 16 équipes de démonstration » crée
  le jeu de données du prototype si la compétition est vide. Sinon, ajoutez vos
  vraies équipes.
- Vérifier la persistance : modifier un score, se déconnecter, recharger dans une
  fenêtre de navigation privée — la modification est toujours là.

## 6. Déployer sur Vercel

**Avec GitHub (recommandé)**

1. Créer un dépôt et y pousser ce dossier :
   ```bash
   git init && git add . && git commit -m "NSA site"
   git remote add origin https://github.com/VOTRE-COMPTE/nsa-site.git
   git push -u origin main
   ```
2. Sur [vercel.com](https://vercel.com) : **Add New** → **Project** → importer le dépôt.
3. Framework Preset : **Other**. Build Command et Output Directory : laisser vides.
4. **Deploy**. L'URL publique (`https://nsa-site.vercel.app`) est disponible en
   une minute environ.

**Sans GitHub**

```bash
npm i -g vercel
cd nsa-site
vercel        # préversion
vercel --prod # mise en production
```

**Nom de domaine** : dans Vercel, **Settings** → **Domains** → ajouter votre domaine
et suivre les instructions DNS.

## 7. Après le déploiement

Dans Supabase, **Authentication** → **URL Configuration** : ajouter l'URL Vercel
dans *Site URL* et *Redirect URLs*. Puis vérifier sur l'URL publique que les
images (logo, carrousel, trophée) s'affichent bien.

Pour toute modification ultérieure : `git push` suffit, Vercel redéploie tout seul.

---

## Ce qui change par rapport au prototype

| Prototype | Cette version |
|---|---|
| Données en mémoire, perdues au rechargement | Tables PostgreSQL chez Supabase |
| Identifiants en dur dans le code | Compte Supabase Auth, session persistante |
| Images en `blob:` locales | Fichiers dans Supabase Storage, URL publiques |
| Chaque visiteur voyait son propre état | Une seule source de vérité partagée |
| — | Mise à jour en direct chez les visiteurs (Realtime), sans recharger |
| — | Indicateur « Enregistrement… / Enregistré » et messages d'erreur |

Deux ajustements de comportement, tout le reste est identique :

- Les scores sont écrits en base après une courte pause de frappe (0,45 s) plutôt
  qu'à chaque touche, et le champ en cours garde le focus pendant le re-rendu.
- Supprimer une équipe demande une confirmation, puisque l'effacement est définitif
  (ses joueurs partent avec, et elle est retirée des confrontations).

## Sauvegardes

Supabase sauvegarde quotidiennement sur les offres payantes. Sur l'offre gratuite,
faites un export manuel avant chaque grande échéance : **Database** → **Backups**,
ou `pg_dump` avec la chaîne de connexion de **Project Settings** → **Database**.
