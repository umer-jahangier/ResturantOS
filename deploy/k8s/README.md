# RestaurantOS on k3s — deployment runbook

Two environments on one VPS (`cp.praivox.com`, 72.61.124.11):

| Env  | Namespace            | URL                                      | Branch |
|------|----------------------|------------------------------------------|--------|
| dev  | `restaurantos-dev`   | https://dev.restaurantos.softxlogic.com  | `main` |
| prod | `restaurantos-prod`  | https://restaurantos.softxlogic.com      | `prod` |

## The request path

```
browser → LiteSpeed :443 (TLS terminates here)
        → 127.0.0.1:30080  (Traefik NodePort)
        → Ingress, matched by Host header
        → /api,/ws,/iclock,/internal → gateway:8080 → Eureka → service
          everything else            → frontend:3000
```

**LiteSpeed keeps 80/443.** This box also serves mail, DNS, CyberPanel and other
customers' sites. k3s was installed with `--disable=servicelb` precisely because
servicelb (klipper) binds hostPorts 80/443 and would have taken them.

`firewalld` stays enabled — the k3s docs say to disable it, which on a host
running Postfix, Dovecot and fail2ban is not an acceptable trade. Instead the pod
and service CIDRs (`10.42.0.0/16`, `10.43.0.0/16`) are in the `trusted` zone. No
port was opened to the internet; the Kubernetes API stays on localhost.

## Regenerating manifests

`deploy/k8s/base/` is GENERATED. Edit `generate.sh`, never the output:

```bash
bash deploy/k8s/generate.sh
```

It also copies the Postgres init SQL, the OPA policies and the config-repo into
`base/files/`, because kustomize will not read files above its own root and
`kubectl apply -k` cannot pass `--load-restrictor`.

## Secrets

Generated **on the server**, never in GitHub:

```bash
bash deploy/k8s/bootstrap-secrets.sh restaurantos-dev
```

Create-if-absent, never rotate: `init/02-create-roles.sql` runs once, when the
Postgres data directory is empty, and bakes those passwords into the roles. A
"rotation" would leave fifteen services holding credentials the database has
never seen. Handover copies live at `/root/restaurantos-credentials-<ns>.txt`.

## Deploying by hand (CI does this for you)

```bash
kubectl apply -k deploy/k8s/overlays/dev
kubectl -n restaurantos-dev rollout status deploy/gateway --timeout=8m
```

## Things that bit us, recorded so they don't again

- **OPA needs `--ignore=.*`.** A ConfigMap volume is projected through two
  symlinks (`x.rego → ..data/x.rego → ..2026_.../x.rego`) so updates are atomic.
  OPA's recursive load therefore reads every policy three times and dies with
  *multiple default rules*. 7 of 8 policies failed this way. `subPath` mounts
  would also fix it but stop receiving updates — bad for a fail-closed engine.
- **Liveness is `tcpSocket`, not `/actuator/health`.** That endpoint aggregates
  the database; wiring it to liveness restarts the whole namespace during any
  Postgres blip.
- **`startupProbe` allows 5 minutes.** A cold JVM running Liquibase on a
  contended 8-vCPU box does not start in the 30s a default probe permits.
- **`initContainers` gate on postgres+eureka.** Without them sixteen JVMs race
  the database, all fail, and CrashLoopBackOff their way to health over ten
  minutes — which makes `rollout status` useless as a CI gate.
- **Both `EUREKA_URL` and `EUREKA_URI` are set.** The fleet genuinely disagrees
  about the spelling, and the defaults differ by a trailing slash. Likewise
  `RABBITMQ_USER` and `RABBITMQ_USERNAME`.
- **The frontend image is environment-specific.** `NEXT_PUBLIC_*` is inlined at
  build time and `lib/server/resolve-tenant-brand.ts` fetches server-side, where
  a relative URL has no origin. One image per hostname is unavoidable.
