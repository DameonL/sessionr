# sessionr

Mobile-first PWA for traditional musicians: repertoire management, ABC-notation
playback, smart practice tools, and band features. Hosted on Azure Static Web
Apps with an Azure Functions (C#, isolated worker) backend connected to Azure Cosmos DB for NoSQL via
EF Core over Virtual Network.

## Structure

```
/api        Azure Functions .NET isolated worker (EF Core models + DbContext)
/frontend   Vite + Preact + TypeScript app (abcjs, @preact/signals, react-query)
```

## Run locally

Prerequisites: .NET SDK, Node.js, and [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
(`npm install -g azure-functions-core-tools@4`).

```bash
npm install                   # root: the dev runner
npm install --prefix frontend # frontend dependencies
npm run dev                   # starts API (:7071) and frontend (:5173) together
```

Open http://localhost:5173 — Vite proxies `/api` to the Functions host. The
two halves can still be run separately with `func start` in `api/` and
`npm run dev` in `frontend/`.

### Database

When the `CosmosConnectionString` app setting is present, the API connects to Azure Cosmos DB for NoSQL
(production database: `"sessionr"`). When it is absent — the local default — the API falls back to a
SQLite file (`api/sessionapp.dev.db`, gitignored) that is created and seeded
on first start with a dev user (`userId` 1), ten session tunes, and a sample
set, so the whole app runs with zero provisioning.

#### Data Migration & Azure Virtual Network

- **Migration Endpoint:** `POST /api/admin/migrate-sql-to-cosmos` (and the admin control panel on the `/profile` page) copies legacy Azure SQL records (`SqlConnectionString`) to Cosmos DB for NoSQL (`CosmosConnectionString`).
- **Virtual Network:** Azure Functions apps are connected via Regional VNet Integration (`WEBSITE_VNET_ROUTE_ALL=1`) to the database subnet containing the Cosmos DB Private Endpoint (`privatelink.documents.azure.com`).

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/tunes?search=&type=&key=` | Search the global tune library |
| POST | `/api/tunes` | Add a tune to the global library |
| GET | `/api/repertoire/{userId}` | The user's repertoire (with effective ABC) |
| POST | `/api/repertoire/{userId}` | Add a global tune to the repertoire |
| PATCH | `/api/repertoire/items/{userTuneId}` | Update status / target BPM / custom ABC |
| POST | `/api/repertoire/items/{userTuneId}/practiced` | Log a practice session |
| DELETE | `/api/repertoire/items/{userTuneId}` | Remove from repertoire (409 if used in a set) |
| GET | `/api/practice/{userId}/queue` | Daily practice queue (learning → rusty → keep-fresh) |
| GET | `/api/users/{userId}/sets` | The user's sets with playtime + key-transition analysis |
| POST | `/api/users/{userId}/sets` | Create a set from ordered repertoire tunes |
| POST | `/api/users/{userId}/sets/suggest` | Rank next-tune suggestions for a draft set |
| GET | `/api/sets/{setId}` | One set with analysis |
| PUT | `/api/sets/{setId}` | Replace a set's title and tune order |
| DELETE | `/api/sets/{setId}` | Delete a set |

Tunes not practiced in 30 days count as "rusty" and are resurfaced by the
practice queue. Set playtime is a heuristic (seconds per pass by tune type ×
each tune's configured repetitions); key transitions are rated by distance around the circle
of fifths between key signatures (modes normalized, e.g. E dorian ≡ D major).
