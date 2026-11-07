# Name List — MERN CRUD on Docker Compose

A deliberately small "Name List" CRUD app split into independent services:

```
                    browser
                       │
                       │ http://localhost:3000
                       ▼
              ┌─────────────────┐
              │    react-app    │  React 19 + Vite dev server
              │   (port 3000)   │  proxies /api/* to the API
              └────────┬────────┘
                       │ namelist-net (custom bridge)
                       ▼
              ┌─────────────────┐
              │   api-server    │  Express 5 + Mongoose
              │   (port 5000)   │  REST API at /api/names
              └────────┬────────┘
                       │ mongodb://…@db:27017/namelist
                       ▼
              ┌─────────────────┐
              │     mongodb     │  MongoDB 8.2
              │   (port 27017)  │  alias: db
              └────────┬────────┘
                       ▼
                 mongo-data (named volume)
```

Only the client, API, and a loopback-only Mongo port are reachable from the
host. MongoDB is never exposed to the LAN.

> **A note on the service count:** the brief asks for "four distinct services"
> but names three (`react-app`, `api-server`, `mongodb`). This implementation
> follows the three named services. If you need a fourth, `mongo-express` is a
> natural optional addition for a database UI.

## Quick start

```bash
cd name-list
cp .env.example .env
# Change MONGO_INITDB_ROOT_PASSWORD and the matching password in MONGO_URI.
docker compose up --build
```

| URL                          | What it is                    |
| ---------------------------- | ----------------------------- |
| http://localhost:3000        | React UI                      |
| http://localhost:5000/health | API + DB health               |
| http://localhost:5000/api/names | REST collection           |
| mongodb://localhost:27017    | MongoDB (loopback only)       |

The first boot creates the root user and the `namelist` database. The app data
lives in the `mongo-data` volume and survives `docker compose down`.

```bash
docker compose ps
docker compose logs -f api-server
docker compose down          # keeps data
docker compose down -v       # DESTROYS the database volume
```

## Project structure

```
name-list/
├── docker-compose.yml          # 3 services, 1 network, 1 persistent volume
├── .env.example                # every configurable value lives here
├── .gitignore                  # ignores .env and node_modules
├── README.md
├── client/
│   ├── Dockerfile              # single-stage Vite dev image
│   ├── .dockerignore
│   ├── package.json
│   ├── package-lock.json
│   ├── index.html
│   ├── vite.config.js          # host 0.0.0.0, /api proxy from env
│   └── src/
│       ├── main.jsx
│       ├── App.jsx             # list / create / rename / delete UI
│       ├── api.js              # the only file that calls fetch()
│       └── index.css
└── server/
    ├── Dockerfile              # single-stage Express image
    ├── .dockerignore
    ├── package.json
    ├── package-lock.json
    └── src/
        ├── index.js            # startup, Mongo connect, graceful shutdown
        ├── app.js              # middleware, health, error handling
        ├── config/
        │   └── db.js           # Mongoose connection
        ├── models/
        │   └── Name.js         # schema + id-only JSON shape
        └── routes/
            └── names.js        # CRUD handlers
```

## Service details

| Service      | Build / image          | Internal | Host (`.env`) | Depends on                         |
| ------------ | ---------------------- | -------- | ------------- | ---------------------------------- |
| `react-app`  | `./client`             | `3000`   | `CLIENT_PORT` | `api-server` healthy               |
| `api-server` | `./server`             | `5000`   | `API_PORT`    | `mongodb` healthy                  |
| `mongodb`    | `mongo:8.2.3`          | `27017`  | `MONGO_PORT`  | —                                  |

- **Custom network:** `namelist-net` (bridge). Only these three services join it.
- **Service discovery:** the API connects to `db`, which is a network alias for
  the service named `mongodb`. This satisfies both "the service is called
  mongodb" and "connect using the name db".
- **Persistence:** `mongo-data` is mounted at `/data/db`.
- **Startup order:** healthchecks + `depends_on.condition: service_healthy` mean
  the API waits for Mongo, and React waits for the API. This avoids the classic
  "connection refused on first boot" race.
- **Secrets:** the database credentials are read by the `mongodb` container from
  `.env` via `env_file` (the official image's `MONGO_INITDB_*` variables).
- **Live updates:** source directories are bind-mounted; named volumes hold
  `/app/node_modules` so the image's dependencies are not hidden. Vite hot-reloads
  the UI. The API uses `npm start` (plain `node`), so restart it after backend
  edits: `docker compose restart api-server`.

## Configuration

Copy `.env.example` → `.env`. It is the single source of truth for ports,
credentials, the Mongo URI, and the CORS origin.

| Variable                     | Used by        | Purpose                                              |
| ---------------------------- | -------------- | ---------------------------------------------------- |
| `COMPOSE_PROJECT_NAME`       | Compose        | Container/network/volume prefix                      |
| `MONGO_INITDB_ROOT_USERNAME` | mongodb        | Root user created on first boot                      |
| `MONGO_INITDB_ROOT_PASSWORD` | mongodb        | Root password created on first boot                  |
| `MONGO_INITDB_DATABASE`      | mongodb        | Database created on first boot                       |
| `MONGO_URI`                  | api-server     | Full connection string, including credentials        |
| `MONGO_PORT`                 | mongodb        | Loopback host port                                   |
| `API_PORT`                   | api-server     | Host API port                                        |
| `CLIENT_ORIGIN`              | api-server     | Allowed CORS origin for direct browser calls         |
| `CLIENT_PORT`                | react-app      | Host UI port                                         |
| `API_PROXY_TARGET`           | react-app      | Internal upstream for Vite's `/api` proxy            |

The Mongo password appears twice: once for the container bootstrap and once
inside `MONGO_URI`. Keep them in sync. If the password contains URI-reserved
characters (`@`, `:`, `/`, `?`, `#`, `%`), percent-encode it in `MONGO_URI`
(for example `@` → `%40`). For local development, an alphanumeric password
avoids the issue entirely.

## API

| Method   | Path             | Body           | Success         |
| -------- | ---------------- | -------------- | --------------- |
| `GET`    | `/health`        | —              | `200` JSON      |
| `GET`    | `/api/names`     | —              | `200` array     |
| `POST`   | `/api/names`     | `{"name":"…"}` | `201` name      |
| `PUT`    | `/api/names/:id` | `{"name":"…"}` | `200` name      |
| `DELETE` | `/api/names/:id` | —              | `204` no body   |

Validation: `name` is required, trimmed, and limited to 100 characters. Invalid
ObjectIds return `400`; unknown IDs return `404`. Errors use `{ "error": "…" }`.

```bash
curl http://localhost:5000/api/names
curl -X POST http://localhost:5000/api/names \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace"}'
```

## Common operations

**Change host ports** — edit `.env`, then `docker compose up -d`. For example
`CLIENT_PORT=8080` and `API_PORT=5050`. The internal ports stay fixed, so the
proxy and healthchecks keep working.

**Watch logs / restart one service**

```bash
docker compose logs -f api-server
docker compose restart api-server
```

**Clean rebuild after changing `package.json`** — the dependency volume is
cached, so remove just that volume (this does not touch Mongo data):

```bash
docker compose build api-server
docker compose down
docker volume rm namelist_server-node-modules
docker compose up -d
```

Do the same with `namelist_client-node-modules` for the client.

**Mongo shell**

```bash
docker compose exec mongodb mongosh \
  -u namelist_admin -p change_me_to_a_long_random_value \
  --authenticationDatabase admin namelist
```

**Rebuild after changing a Dockerfile or dependencies** — see the cached-volume
note above. The images are development-oriented and start the apps with
`npm start`; a production deployment should add a multi-stage build that serves
the React bundle from Nginx and runs the API as a non-root user.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `port is already allocated` | Change `CLIENT_PORT`, `API_PORT`, or `MONGO_PORT` in `.env`. |
| `Authentication failed` after editing credentials | The volume still has the old user. Recreate it with `docker compose down -v` (data loss), or restore the old values. |
| Mongo exits with a kernel compatibility message | `mongo:8.0.x` refuses kernels ≥ 6.19. This project pins the verified `mongo:8.2.3`. |
| API restarts/never becomes healthy | `docker compose logs mongodb api-server`. Check `MONGO_URI` matches the credentials and uses host `db`. |
| Dependency changes are ignored | Rebuild the image and remove the matching `*-node-modules` volume (see above). |
| Mongo URI parse error | Percent-encode special characters in the password inside `MONGO_URI`. |

## Security notes (development defaults)

This is a local-development setup, not a hardened production deployment:

- The app authenticates as MongoDB **root**. In production, create a dedicated
  user with `readWrite` on only the `namelist` database.
- `.env` is git-ignored, but environment variables are still visible to anyone
  who can inspect the containers. Use Docker secrets or a vault in production.
- Mongo is published to loopback and the API is published openly. For
  production, remove the database port entirely and put the API behind a TLS
  reverse proxy; do not publish both directly.
- Images are version-pinned (`mongo:8.2.3`, `node:20-alpine`), but full
  reproducibility would use digests. Node 20 is end-of-life; bump both
  Dockerfiles to `node:22-alpine` when your assignment permits.
- Both app containers run as root and use `npm install` for simplicity. That is
  acceptable for a local dev demo, not for production.
- Vite's dev server runs with `allowedHosts: true` for convenience. Do not use
  the development image as a public entry point.
