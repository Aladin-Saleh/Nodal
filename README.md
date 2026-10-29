# Nodal

Application desktop Windows de base de connaissances techniques sous forme de
graphe : nœuds hiérarchiques contenant des documents typés (Markdown, texte,
JSON, code, Mermaid), reliés par des relations nommées. Locale, sans backend,
le code stocké n'est jamais exécuté.

Spécifications : [`docs/cahier_des_charges_techniques_knowledge_graph_v1_2.docx`](docs/).

Un espace de connaissances = **un fichier `.nodal`** (base SQLite unique,
pièces jointes en BLOB).

## État

Lot 1 — Fondation : application Electron sécurisée, persistance SQLite,
migrations, création / ouverture / fermeture d'un espace. Les nœuds, documents,
graphe, recherche et export arrivent dans les lots suivants.

## Stack

- Electron 45 + Electron Forge 8 (Vite 8), makers Squirrel (installateur) et ZIP
- React 19 + TypeScript 6 (strict)
- SQLite via le module intégré **`node:sqlite`** (`DatabaseSync`)
- zod pour la validation des messages IPC
- Vitest + Testing Library, oxlint + oxfmt

### Pourquoi `node:sqlite` plutôt que better-sqlite3

- Fourni par le Node embarqué d'Electron : aucun module natif à recompiler
  pour Electron, packaging simplifié.
- Même API sous Node 22 (tests Vitest) et dans Electron (SQLite 3.53, FTS5 et
  BLOB disponibles).
- `node:sqlite` n'est pas listé dans `builtinModules` sous Node 22 : il est
  déclaré explicitement en `external` dans `vite.main.config.mts`.

## Structure

```
src/
  main/        processus principal : fenêtre, sécurité, IPC, base, espaces
    database/  connexion, migrations versionnées (PRAGMA user_version)
    ipc/       handlers validés (émetteur + zod), enveloppe { ok, data | error }
    workspace/ service et boîtes de dialogue .nodal
  preload/     API minimale exposée via contextBridge (window.nodal)
  shared/      contrat IPC typé, schémas zod, constantes du domaine
  renderer/    interface React
tests/         tests Vitest (base, service, IPC, renderer)
```

## Scripts

| Commande            | Rôle                                           |
| ------------------- | ---------------------------------------------- |
| `npm start`         | lance l'application en développement           |
| `npm test`          | tests unitaires (Vitest)                       |
| `npm run typecheck` | vérification TypeScript                        |
| `npm run lint`      | oxlint + vérification du format (oxfmt)        |
| `npm run lint:fix`  | corrige le lint et formate                     |
| `npm run package`   | application packagée dans `out/`               |
| `npm run make`      | installateur Windows (Squirrel) et archive ZIP |

Prérequis : Node ≥ 22.13 (pour `node:sqlite` dans les tests).
