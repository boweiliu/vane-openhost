# vane-openhost

OpenHost wrapper for [Vane](https://github.com/ItzCrazyKns/Vane), a privacy-focused AI answering engine.

This repository intentionally does **not** vendor the Vane source tree. The Docker build clones upstream Vane from GitHub, applies the small OpenHost compatibility patch in `patches/`, builds it, and runs it behind a local Caddy proxy.

## Why this wrapper exists

OpenHost apps need a small amount of deployment glue:

- `openhost.toml` manifest
- persistent data wiring via `OPENHOST_APP_DATA_DIR`
- service-grant declaration for the OpenHost secrets service
- startup-time config seeding from `OPENROUTER_API_KEY`
- a stable `/health` endpoint exposed by Caddy

This follows the same pattern as other OpenHost wrapper/binding repos: keep the wrapper small and clone/update the real payload app from its upstream repository.

## Runtime layout

- Caddy listens on `:8080`, which is the port declared in `openhost.toml`.
- Vane listens privately on `127.0.0.1:3000`.
- `/health` is answered directly by Caddy.
- all other routes reverse-proxy to Vane.
- Vane data is persisted under `OPENHOST_APP_DATA_DIR/data`.
- Vane uploads are persisted under `OPENHOST_APP_DATA_DIR/uploads`.
- SearXNG is **not** bundled; Vane uses `SEARXNG_API_URL`, defaulting to `https://searxng.oh.bowei.in/`.

## Deploy

Store `OPENROUTER_API_KEY` in the OpenHost secrets service, then deploy with manifest grants approved:

```bash
oh app deploy https://github.com/boweiliu/vane-openhost@openhost-glue --name vane --grant-permissions-v2 --wait
```

For a clean test instance:

```bash
oh app deploy https://github.com/boweiliu/vane-openhost@openhost-glue --name vane2 --grant-permissions-v2 --wait
```

The `--grant-permissions-v2` flag matters. Without it, the app cannot read `OPENROUTER_API_KEY` from the OpenHost secrets service and Vane will start without the preconfigured OpenRouter chat provider.

## Updating upstream Vane

By default the Dockerfile builds from:

- `VANE_REPO=https://github.com/ItzCrazyKns/Vane.git`
- `VANE_REF=master`

To pin or test a different upstream ref, change the Docker build args in `Dockerfile` or edit the defaults and redeploy.

The only app-code patch currently applied is:

- `patches/openai-empty-tool-arguments.patch` — makes Vane tolerate empty/partial streamed tool-call argument chunks from OpenAI-compatible APIs.

If upstream Vane incorporates an equivalent fix, remove that patch.

## Local build

```bash
docker build -t vane-openhost .
docker run --rm -p 8080:8080 \
  -e OPENROUTER_API_KEY=... \
  -e SEARXNG_API_URL=https://searxng.example.com/ \
  vane-openhost
```

For local non-OpenHost runs, you can also pre-create a config file under the data directory; otherwise the OpenHost secrets fetch is best-effort and the app will come up without a seeded key.
