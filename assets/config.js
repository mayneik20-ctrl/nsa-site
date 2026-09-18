/* ============================================================================
   NSA — Configuration Supabase
   ----------------------------------------------------------------------------
   Remplacez les deux valeurs ci-dessous par celles de VOTRE projet Supabase :
   Dashboard Supabase > Project Settings > API
     - Project URL        -> SUPABASE_URL
     - anon / public key  -> SUPABASE_ANON_KEY

   La clé "anon" est publique par nature : elle est conçue pour être exposée
   dans le navigateur. Ce qui protège les données, ce sont les règles RLS
   définies dans supabase/schema.sql (lecture pour tous, écriture uniquement
   pour un compte administrateur connecté).
   NE JAMAIS mettre ici la clé "service_role".
============================================================================ */
window.NSA_CONFIG = {
  SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
  SUPABASE_ANON_KEY: "VOTRE_CLE_ANON",
  STORAGE_BUCKET: "media",
};
