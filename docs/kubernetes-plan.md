# Kubernetes Scaling Plan — Name List on Minikube

Status: proposed (not yet implemented)
Scope: run the MERN Name List app on Minikube with Metrics Server, Dashboard,
Ingress, and a CPU-based Horizontal Pod Autoscaler.

---

## 1. Target architecture

```text
                         host browser
                              │
                    http://namelist.local
                              │
                    ┌─────────▼──────────┐
                    │  ingress-nginx     │  Minikube ingress addon
                    │  (Ingress)         │
                    └───────┬───────┬────┘
                            │       │
                  /api/*    │       │    /*
                            ▼       ▼
                 ┌────────────┐  ┌────────────┐
                 │ api-svc    │  │ client-svc │
                 │ ClusterIP  │  │ ClusterIP  │
                 └─────┬──────┘  └─────┬──────┘
                       │               │
              ┌────────▼──────┐  ┌─────▼─────────┐
              │ api Deployment│  │client Deploy  │
              │ 2..6 pods     │  │ 2 pods        │
              │ HPA: CPU 60%  │  │ Nginx static  │
              └────────┬──────┘  └───────────────┘
                       │ mongodb://…@mongodb:27017
                       ▼
              ┌──────────────────┐
              │ mongodb StatefulSet│
              │ 1 replica + PVC    │
              └──────────────────┘
                       │
                 PersistentVolume
```

### What scales and what does not

| Workload | Strategy | Reason |
| --- | --- | --- |
| `api-server` | **HPA**, 2 → 6 replicas, CPU target 60% | Stateless Express process. |
| `react-app` | Fixed 2 replicas | Static Nginx container; CPU-based HPA adds little value. Can be added later if desired. |
| `mongodb` | **Not HPA** — single-replica StatefulSet with PVC | Stateful database. Production needs a replica set or a managed MongoDB service. |

Scaling the API does not make MongoDB horizontally scalable; it just lets more
API pods share the same database. That is appropriate for this demo and is
called out as a production risk below.

---

## 2. Key decisions

1. **Keep the simple Dockerfiles for Compose; add separate production images.**
   The current `client/Dockerfile` runs the Vite dev server, which is not a
   production web server. Add:
   - `client/Dockerfile.prod` — build the React bundle, serve it with Nginx.
   - `server/Dockerfile.prod` — install production dependencies only, run as
     the non-root `node` user.
   - Use Node 22 in the production images (Node 20 in the dev Dockerfiles is
     end-of-life).
2. **No Helm.** Use plain Kubernetes YAML + Kustomize, both already available
   through `kubectl`.
3. **Ingress owns routing.** `/api` → API Service, `/` → client Service.
   The React code already uses relative `/api` URLs, so no build-time API URL
   is needed.
4. **CPU-based HPA** using the Metrics Server addon. Custom metrics (RPS,
   latency) are a future enhancement, not part of this plan.
5. **Local images.** Build directly into Minikube's Docker daemon; no registry
   or image push required.
6. **One namespace:** `namelist`. Dashboard and ingress live in their addon
   namespaces.

---

## 3. Prerequisites

Already present on this machine:

| Tool | Version |
| --- | --- |
| Minikube | v1.39.0 |
| kubectl | v1.35.9 |
| Docker | available |
| Host resources | 8 CPUs / ~24 GB RAM |

To be installed or enabled by the plan:

- Minikube cluster (currently stopped).
- `ingress`, `metrics-server`, and `dashboard` addons.
- No Helm, no external load generator required.

Recommended cluster size (leaves room for the host and the existing Compose
stack if it is still running):

```bash
minikube start \
  --driver=docker \
  --cpus=4 \
  --memory=8192 \
  --disk-size=20g
```

Stop the Compose stack first to free CPU/RAM. This keeps the Mongo volume:

```bash
cd name-list
docker compose down
```

---

## 4. Work breakdown

### Phase 0 — Application production readiness (code changes)

**Goal:** make the app safe and observable when run as multiple pods.

1. Split health endpoints:
   - `GET /health/live` — always `200` if the process is alive.
   - `GET /health` — readiness; `200` only when Mongo is connected.
   - Keep `/health` for the existing Compose healthcheck.
   - Use `/health/live` for liveness and `/health` for readiness.
2. Add Mongo connection retry/backoff on startup so an API pod does not
   crash-loop while Mongo is still starting. Alternatively add a
   `wait-for-mongo` initContainer; the plan uses both for belt-and-braces.
3. Add `server/Dockerfile.prod`:
   - `node:22-alpine`
   - `npm ci --omit=dev`
   - copy `src/`
   - `USER node`
   - `CMD ["node", "src/index.js"]`
   - `EXPOSE 5000`
4. Add `client/Dockerfile.prod`:
   - build stage: `npm ci && npm run build`
   - runtime stage: `nginx:1.27-alpine`
   - copy `dist/` and an Nginx config with SPA fallback
   - no `/api` proxy inside Nginx; Ingress routes the API directly
5. Add/update `.dockerignore` files so `node_modules`, `.env`, and build output
   are not sent to the daemon.
6. Add a production-ready `client/nginx.prod.conf`:

   ```nginx
   server {
     listen 80;
     root /usr/share/nginx/html;
     index index.html;

     location / {
       try_files $uri $uri/ /index.html;
     }
   }
   ```

**Acceptance:** production images build locally; API liveness/readiness behave
correctly with Mongo up and down.

### Phase 1 — Minikube + addons

```bash
minikube start --driver=docker --cpus=4 --memory=8192 --disk-size=20g

minikube addons enable ingress
minikube addons enable metrics-server
minikube addons enable dashboard
```

Wait for the components:

```bash
kubectl wait -n ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s

kubectl wait --for=condition=Available \
  apiservice/v1beta1.metrics.k8s.io --timeout=120s
```

**Acceptance:**

- `kubectl get nodes` shows `Ready`.
- `kubectl get pods -n ingress-nginx` shows the controller running.
- `kubectl top nodes` returns CPU/memory values.
- `minikube dashboard --url` returns a dashboard URL.

### Phase 2 — Namespace, configuration, secrets

Create `k8s/base/` resources:

- `namespace.yaml` — `namelist`.
- `configmap.yaml`:

  ```yaml
  NODE_ENV: production
  PORT: "5000"
  CLIENT_ORIGIN: http://namelist.local
  ```

- `secret.example.yaml` — placeholders only, no real credentials.
- A real secret is created from a local, git-ignored env file:

  ```bash
  kubectl create secret generic mongodb-secret \
    -n namelist \
    --from-env-file=k8s/overlays/local/secret.env
  ```

  `secret.env` contains:

  ```dotenv
  MONGO_INITDB_ROOT_USERNAME=…
  MONGO_INITDB_ROOT_PASSWORD=…
  MONGO_INITDB_DATABASE=namelist
  MONGO_URI=mongodb://…:…@mongodb:27017/namelist?authSource=admin
  ```

- Add `k8s/overlays/local/secret.env` to `.gitignore`.
- The API receives `MONGO_URI` via `secretKeyRef`; the Mongo pods receive the
  `MONGO_INITDB_*` keys via `secretKeyRef`.

**Acceptance:** `kubectl get secret -n namelist` shows the secret; no real
credentials are committed.

### Phase 3 — MongoDB

Manifests:

- `mongodb-service.yaml` — headless Service (`clusterIP: None`), port 27017.
- `mongodb-statefulset.yaml`:
  - image `mongo:8.2.3` (same version verified in Compose).
  - 1 replica, `serviceName: mongodb`.
  - `volumeClaimTemplates` → 2 GiB, `storageClassName: standard`.
  - resource requests/limits: 250m / 512Mi (requests), 1 CPU / 1Gi (limits).
  - env from `mongodb-secret`.
  - readiness probe using `mongosh --eval "db.adminCommand({ping:1})"`.
  - `terminationGracePeriodSeconds: 30`.
- Optional: `k8s/base/mongodb-pdb.yaml` is not useful with one replica; omit.

**Acceptance:**

- `kubectl get statefulset,pvc,pods -n namelist` shows Mongo Running and the PVC
  Bound.
- `kubectl exec -n namelist mongodb-0 -- mongosh --quiet --eval "db.runCommand({ping:1})"`
  succeeds.
- Deleting the Mongo pod re-creates it and the PVC/data remain.

### Phase 4 — API Deployment + Service

`api-deployment.yaml`:

- 2 replicas initially (HPA will manage this).
- image `namelist/api:0.1.0`, `imagePullPolicy: IfNotPresent`.
- `strategy.rollingUpdate.maxUnavailable: 0`, `maxSurge: 1`.
- `initContainers` wait for Mongo:

  ```yaml
  - name: wait-for-mongo
    image: busybox:1.36
    command:
      - sh
      - -c
      - until nc -z mongodb 27017; do echo waiting for mongodb; sleep 2; done
  ```

- env: `PORT`, `NODE_ENV`, `CLIENT_ORIGIN` from ConfigMap; `MONGO_URI` from
  Secret.
- probes:

  ```yaml
  readinessProbe:
    httpGet: { path: /health, port: 5000 }
    initialDelaySeconds: 10
    periodSeconds: 10
  livenessProbe:
    httpGet: { path: /health/live, port: 5000 }
    initialDelaySeconds: 20
    periodSeconds: 20
  ```

- resources:

  ```yaml
  requests: { cpu: 100m, memory: 128Mi }
  limits:   { cpu: 500m, memory: 256Mi }
  ```

- `terminationGracePeriodSeconds: 30`.
- `securityContext`: run as non-root, no privilege escalation, drop capabilities.
- `api-service.yaml`: ClusterIP, port 5000 → targetPort 5000.

**Acceptance:**

- 2 API pods become Ready.
- `curl` to the Service from a debug pod returns the name list.
- Killing one API pod does not cause a request failure (Service + 2 replicas).

### Phase 5 — Client Deployment + Service

`client-deployment.yaml`:

- 2 replicas.
- image `namelist/client:0.1.0`, `imagePullPolicy: IfNotPresent`.
- port 80.
- readiness/liveness: HTTP GET `/`.
- resources: requests 25m / 32Mi, limits 100m / 64Mi.
- `client-service.yaml`: ClusterIP, port 80.

**Acceptance:** both client pods Ready; `kubectl port-forward` or Ingress serves
the UI.

### Phase 6 — Ingress

`ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: namelist
  namespace: namelist
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
spec:
  ingressClassName: nginx
  rules:
    - host: namelist.local
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 5000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: client
                port:
                  number: 80
```

Host mapping, choose one:

```bash
# Option A: direct Minikube IP (works with the Docker driver)
echo "$(minikube ip) namelist.local" | sudo tee -a /etc/hosts

# Option B: tunnel (needs sudo; exposes 127.0.0.1)
minikube tunnel
```

**Acceptance:**

```bash
curl http://namelist.local/            # React HTML
curl http://namelist.local/api/names   # JSON array
```

No CORS issue: the browser and API share the `namelist.local` origin.

### Phase 7 — Metrics Server + Dashboard validation

```bash
kubectl top nodes
kubectl top pods -n namelist
kubectl get apiservice v1beta1.metrics.k8s.io -o yaml
```

Dashboard:

```bash
minikube dashboard --url
# or, to keep using the terminal:
kubectl port-forward -n kubernetes-dashboard svc/kubernetes-dashboard 8443:443
```

Do **not** expose the dashboard through the public app Ingress. It is an
admin UI and should remain on localhost / a protected tunnel.

**Acceptance:** `kubectl top` works; the Dashboard shows pods, deployments,
services, ingress, and HPA.

### Phase 8 — HPA + PodDisruptionBudget

`api-hpa.yaml`:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: namelist
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 15
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 120
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

- HPA requires the CPU **requests** above; without them the target is `<unknown>`.
- `api-pdb.yaml` with `minAvailable: 1` protects availability during node
  drains and rolling updates.
- Optional: a second HPA for the client from 2 → 4 replicas. Not required for
  the demo because the frontend is static.

**Acceptance:** `kubectl get hpa -n namelist` shows a real percentage (not
`<unknown>`), and `kubectl get hpa -w` reacts during the load test.

### Phase 9 — Load test and scaling validation

Create `k8s/loadtest-job.yaml` using Fortio (runs entirely in-cluster, so no
extra host tooling):

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: api-load
  namespace: namelist
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: fortio
          image: fortio/fortio:latest
          args:
            - load
            - -t
            - 5m
            - -c
            - "50"
            - -qps
            - "0"
            - http://api:5000/api/names
```

Run:

```bash
kubectl apply -f k8s/loadtest-job.yaml
kubectl get hpa -n namelist -w
kubectl get pods -n namelist -w
```

Expected sequence:

1. API stays at 2 replicas while idle.
2. Under load, CPU utilization exceeds 60% of requests.
3. HPA scales toward 6 replicas within ~30–60 seconds.
4. Removing the load Job lets CPU drop; after the 120-second scale-down
   stabilization window, replicas return to 2.
5. Dashboard shows the HPA and new pods; `kubectl top pods` shows utilization.

Clean up:

```bash
kubectl delete job api-load -n namelist --ignore-not-found
```

### Phase 10 — Cleanup / rollback

```bash
kubectl delete -k k8s/overlays/local
kubectl delete namespace namelist          # only if you want the DB gone
minikube stop                              # keep the cluster for next time
minikube delete                            # remove cluster and its volumes
```

The Compose environment remains available and its `mongo-data` volume is
unaffected by Minikube.

---

## 5. Proposed file layout

```text
name-list/
├── client/
│   ├── Dockerfile                 # existing simple dev image (Compose)
│   ├── Dockerfile.prod            # NEW: build + Nginx
│   └── nginx.prod.conf            # NEW
├── server/
│   ├── Dockerfile                 # existing simple dev image (Compose)
│   └── Dockerfile.prod            # NEW: production, non-root
├── k8s/
│   ├── base/
│   │   ├── namespace.yaml
│   │   ├── configmap.yaml
│   │   ├── mongodb-service.yaml
│   │   ├── mongodb-statefulset.yaml
│   │   ├── api-deployment.yaml
│   │   ├── api-service.yaml
│   │   ├── client-deployment.yaml
│   │   ├── client-service.yaml
│   │   ├── ingress.yaml
│   │   ├── api-hpa.yaml
│   │   ├── api-pdb.yaml
│   │   └── kustomization.yaml
│   ├── overlays/
│   │   └── local/
│   │       ├── kustomization.yaml
│   │       └── secret.env         # git-ignored
│   └── loadtest-job.yaml
├── scripts/
│   ├── minikube-up.sh
│   ├── build-images.sh
│   ├── deploy.sh
│   └── load-test.sh
└── docs/
    └── kubernetes-plan.md         # this document
```

---

## 6. Image build and deployment workflow

```bash
# 1. Build into Minikube's Docker daemon (no registry required)
eval $(minikube -p minikube docker-env)

docker build -f server/Dockerfile.prod -t namelist/api:0.1.0 ./server
docker build -f client/Dockerfile.prod -t namelist/client:0.1.0 ./client

# 2. Create the secret (from the git-ignored local env file)
kubectl create secret generic mongodb-secret \
  -n namelist \
  --from-env-file=k8s/overlays/local/secret.env \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Deploy everything
kubectl apply -k k8s/overlays/local

# 4. Watch rollout
kubectl rollout status deployment/api -n namelist
kubectl rollout status deployment/client -n namelist
```

Use unique tags (`0.1.0`, git SHA) and `imagePullPolicy: IfNotPresent`.
Avoid `latest` with `IfNotPresent`; it can silently run stale images.

---

## 7. Acceptance criteria

| Area | Pass condition |
| --- | --- |
| Cluster | Minikube node Ready; 4 CPU / 8 GiB allocated |
| Metrics | `kubectl top nodes` and `kubectl top pods -n namelist` return data |
| Dashboard | Reachable locally and shows workloads, ingress, HPA |
| Ingress | `/` serves the UI; `/api/names` returns JSON |
| API availability | 2+ Ready API pods; killing one causes no failed request |
| HPA idle | 2 replicas; `TARGETS` shows a real CPU percentage |
| HPA under load | Replicas increase (toward 6) within ~1 minute |
| HPA cool-down | Replicas return to 2 after load stops |
| Persistence | Deleting `mongodb-0` preserves data via PVC |
| Secrets | No credentials in git; only `secret.example.yaml` is committed |

---

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MongoDB is a single pod | DB outage stops writes; API HPA cannot fix it | Accept for local demo; for production use a replica set or managed MongoDB (Atlas). |
| CPU-only HPA | Scale decisions lag real traffic; CPU may not correlate with request rate | Keep for demo; add Prometheus Adapter custom metrics (RPS/latency) in a later phase. |
| Vite dev image in production | Slow, memory-heavy, not designed for public traffic | Use the proposed `Dockerfile.prod` + Nginx image for Kubernetes. |
| Node 20 in dev images is EOL | Unpatched runtime | Use Node 22 in `Dockerfile.prod`; optionally update the dev images too. |
| Image tag drift | Pods run old images | Unique tags + `IfNotPresent`; rebuild after code changes. |
| Minikube host mapping | `namelist.local` does not resolve | Add `minikube ip` to `/etc/hosts`, or use `minikube tunnel`. |
| Resource pressure | Pods pending / OOM on a laptop | Keep Minikube at 4 CPU / 8 GiB; HPA max 6 with small requests. |
| Mongo connection storm | 6 API pods open many connections | Set a Mongoose `maxPoolSize` appropriate for the replica count. |
| Single-replica Mongo rollout | Brief DB downtime during updates | Accept locally; use `OnDelete`/maintenance window; production replica set. |
| Dashboard exposure | Admin access to the cluster | Keep it on localhost/port-forward, never on the public app Ingress. |

---

## 9. Optional data migration from Compose

Existing data in the Compose volume can be copied into the cluster:

```bash
# 1. Dump from the running Compose Mongo
docker compose exec -T mongodb mongodump \
  --uri="$MONGO_URI" --archive > /tmp/namelist.archive

# 2. Restore into the StatefulSet pod
kubectl exec -i -n namelist mongodb-0 -- mongorestore \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --archive < /tmp/namelist.archive
```

Only needed if the existing names must carry over; otherwise the cluster starts
with an empty database.

---

## 10. Suggested execution order and estimate

| Step | Work | Estimate |
| --- | --- | --- |
| 0 | Health endpoints, Mongo retry, production Dockerfiles | 1–2 h |
| 1 | Start Minikube, enable addons | 15–30 min |
| 2 | Namespace, ConfigMap, Secret | 20 min |
| 3 | MongoDB StatefulSet + PVC | 30–45 min |
| 4 | API Deployment/Service + probes | 45 min |
| 5 | Client Deployment/Service | 20 min |
| 6 | Ingress + hosts entry | 30 min |
| 7 | Metrics Server + Dashboard validation | 15 min |
| 8 | HPA + PDB | 30 min |
| 9 | Load test, tuning, acceptance | 45–60 min |
|  | **Total** | **~5–7 hours** |

---

## 11. Next step

Implement in this order, verifying each phase before moving on:

1. Phase 0 code changes + production images.
2. Phase 1 cluster/addons.
3. Phases 2–6 manifests, one workload at a time.
4. Phase 8 HPA, then Phase 9 load test.

Do not start with HPA; it will show `<unknown>` until Metrics Server and
resource requests are in place.
