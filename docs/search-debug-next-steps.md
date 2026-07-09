# Vane/OpenHost search debugging notes and next steps

## Why this matters

The OpenHost glue wrapper for Vane now relies on an external SearXNG instance instead of bundling SearXNG in the Vane container. That is the right long-term shape for a small wrapper repo, but it means Vane search quality and reliability now depend on:

- the configured `SEARXNG_API_URL`, currently defaulting to `https://searxng.oh.bowei.in/`;
- how Vane calls SearXNG's JSON endpoint;
- how SearXNG behaves for requests from the Vane container / OpenHost network path;
- Vane's post-search filtering/ranking pipeline.

This matters because the UI can appear healthy, the LLM can answer normal non-search queries, and `/api/providers` can be configured correctly, while web-search queries still return empty source lists and produce unhelpful answers.

## Current deployment state when these notes were written

The test deployment was:

- app: `vane2`
- URL: `https://vane2.oh.bowei.in/`
- repo/branch: `https://github.com/boweiliu/vane-openhost@openhost-glue`
- relevant wrapper commit after the first mitigation: `6ff3a42 Keep search results when embedding filter is too strict`

The wrapper branch is a minimal OpenHost glue repo. It does not vendor the full Vane source tree. The Docker build clones upstream Vane and applies patches from `patches/`.

## What had already been observed

### Vane itself was running

I had checked:

```bash
oh app status vane2
```

It reported the app as running.

I had also checked the wrapper health endpoint:

```bash
oh curl -- -sS https://vane2.oh.bowei.in/health
```

It returned:

```text
ok
```

### Provider config was present

I had checked:

```bash
oh curl -- -sS https://vane2.oh.bowei.in/api/providers | python3 -m json.tool | head -80
```

The response included:

- `Transformers` with embedding models;
- `OpenRouter` with chat models.

This suggested the OpenHost secrets integration for `OPENROUTER_API_KEY` was working after deploying with `--grant-permissions-v2`.

### Logs showed normal startup

I had inspected logs with:

```bash
oh app logs vane2 2>&1 | tail -250
```

Relevant startup lines included:

```text
[entrypoint] app dir: /opt/vane
[entrypoint] data dir: /data/app_data/vane2
[entrypoint] searxng: https://searxng.oh.bowei.in/
[entrypoint] seeding Vane config from OpenHost secrets...
[seed] wrote /opt/vane/data/config.json (OpenRouter key loaded from OpenHost secrets)
▲ Next.js 16.2.2
- Local:         http://127.0.0.1:3000
- Network:       http://127.0.0.1:3000
✓ Ready in 0ms
Running database migrations...
Applied migration: 0000_fuzzy_randall.sql
Applied migration: 0001_wise_rockslide.sql
Applied migration: 0002_daffy_wrecker.sql
Database migrations completed successfully
```

The logs also included a Caddy reverse-proxy line after a browser/API client disconnected:

```text
{"level":"error","logger":"http.handlers.reverse_proxy","msg":"aborting with incomplete response","error":"context canceled"}
```

At the time, I interpreted that as likely caused by the client process piping output through `head`, causing the HTTP stream to be closed early. It was not treated as evidence of the root search issue.

## What I had run for search behavior

### Direct SearXNG JSON endpoint checks

I had run direct curl/Python checks from the workbench environment against the configured SearXNG endpoint.

A simple direct curl check was:

```bash
curl -sS -I 'https://searxng.oh.bowei.in/search?q=test&format=json' | head -30
curl -sS 'https://searxng.oh.bowei.in/search?q=test&format=json' | head -c 500
```

That returned HTTP 200 and a JSON response with one result for `test`.

I then ran a small Python loop for several queries:

```python
import json, urllib.parse, urllib.request
for q in ['OpenHost news','OpenHost latest update 2026','OpenHost hosting company news','Vane AI search','test']:
    url='https://searxng.oh.bowei.in/search?format=json&q='+urllib.parse.quote(q)
    with urllib.request.urlopen(url, timeout=20) as r:
        data=json.load(r)
    print(q, len(data.get('results',[])), [x.get('title') for x in data.get('results',[])[:3]])
```

The output I saw at that time was:

```text
OpenHost news 0 []
OpenHost latest update 2026 0 []
OpenHost hosting company news 0 []
Vane AI search 0 []
test 1 ['Test']
```

Important: the user later said that `OpenHost news` returned results for them. That means the direct check above should not be treated as conclusive; it may differ by client, headers, endpoint mode, timing, rate limiting, geography, settings, cookies, or another path-dependent factor.

### Vane `/api/chat` web-search checks

I had submitted a Vane chat request with web search enabled using `oh curl`. One example was structurally like:

```bash
python3 - <<'PY'
import json, uuid
body={
 'message': {'messageId': str(uuid.uuid4()), 'chatId': str(uuid.uuid4()), 'content': 'Search the web for latest OpenHost news and summarize in one sentence.'},
 'optimizationMode':'speed',
 'sources':['web'],
 'history':[],
 'files':[],
 'chatModel': {'providerId':'9d31a0b7-a751-408e-9413-9a6f6c949ea8','key':'anthropic/claude-sonnet-5'},
 'embeddingModel': {'providerId':'6069bcd0-8a0d-405a-8b31-0868e2222b40','key':'Xenova/all-MiniLM-L6-v2'},
 'systemInstructions':''
}
open('/tmp/vane2-search.json','w').write(json.dumps(body))
PY

oh curl -- -sS -N -H 'Content-Type: application/json' \
  --data @/tmp/vane2-search.json \
  https://vane2.oh.bowei.in/api/chat
```

The stream showed search steps but empty readings/source data. Excerpts:

```json
{"type":"block","block":{"type":"research","data":{"subSteps":[]}}}
{"type":"updateBlock", "patch":[{"path":"/data/subSteps","value":[{"type":"searching","searching":["OpenHost news","OpenHost latest update 2026","OpenHost hosting company news"]}]}]}
{"type":"updateBlock", "patch":[{"path":"/data/subSteps","value":[{"type":"search_results","reading":[]}]}]}
{"type":"block","block":{"type":"source","data":[]}}
{"type":"researchComplete"}
```

The final LLM response then said no relevant information was found because no search results were provided.

### Post-filtering issue that was already mitigated

I found that in Vane's speed/balanced search path, SearXNG results were embedded and filtered with:

```ts
.filter((c) => c.metadata.similarity > 0.5)
```

That meant even when SearXNG returned results, Vane could still emit an empty list if the embedding similarity filter rejected them all.

I added this wrapper patch:

```text
patches/search-fallback-when-embedding-filter-drops-results.patch
```

The mitigation keeps the top raw SearXNG results when SearXNG returned results but the embedding filter reduced them to zero.

After redeploying, I tested a query for `test`; sources were populated. Example source data included:

- `TEST TEST TEST on Steam`
- `TEST Definition & Meaning - Merriam-Webster`
- a PDF placeholder result

This confirmed the fallback patch fixed the "SearXNG returned something but Vane filtered everything out" case.

## What remains unresolved

The remaining unresolved question is why the SearXNG JSON endpoint sometimes returned zero results for queries that a human/browser query may return results for, especially `OpenHost news`.

There are at least two distinct failure modes to separate:

1. **SearXNG JSON endpoint returns non-empty results, but Vane drops them.**
   - Partially mitigated by `search-fallback-when-embedding-filter-drops-results.patch`.

2. **SearXNG JSON endpoint itself returns zero results for the query in the Vane/OpenHost request path.**
   - Not fixed yet.
   - Needs investigation.

## Hypotheses to investigate later

Do not treat these as conclusions. They are only starting points.

### 1. Browser UI path vs JSON API path may behave differently

The user reported that `OpenHost news` returned results for them. I had checked the JSON endpoint directly. It is possible that:

- the normal browser HTML search page returns results;
- the `/search?format=json` endpoint returns fewer/no results;
- different engines are enabled for HTML vs JSON;
- SearXNG preferences/cookies affect the browser but not anonymous JSON requests.

### 2. Headers/User-Agent may affect upstream search engines

The direct Python requests used Python's default `urllib` user agent unless overridden. Vane's `fetch` request likely used the runtime default user agent. Some SearXNG engines or upstreams may return different results depending on headers.

Potential headers to compare later:

- `User-Agent`
- `Accept`
- `Accept-Language`
- `X-Forwarded-For` / proxy headers if relevant

### 3. Rate limiting or bot detection may differ by caller

The external `searxng.oh.bowei.in` app could treat requests differently depending on:

- source IP;
- frequency;
- missing forwarded headers;
- whether the request goes through OpenHost auth/proxy;
- SearXNG bot detection configuration.

### 4. Query construction may differ

Vane builds the URL roughly as:

```ts
const searxngURL = getSearxngURL();
const url = new URL(`${searxngURL}/search?format=json`);
url.searchParams.append('q', query);
```

The configured URL currently has a trailing slash:

```text
https://searxng.oh.bowei.in/
```

This can produce a path like `//search?format=json` before URL normalization. It should be verified whether that is normalized consistently by Node, Caddy, OpenHost, and SearXNG.

### 5. Engine/category defaults may be too narrow

Direct JSON responses for some common queries returned zero results in my earlier check. This could reflect:

- disabled engines;
- engines failing silently;
- category defaults;
- language/region/safesearch settings;
- timeouts for slower engines.

### 6. External SearXNG instance may be unreliable for Vane workload

Because the wrapper now relies on a shared external SearXNG app, Vane search reliability may be coupled to that app's health/configuration. It may be worth deciding whether this wrapper should:

- require a user-provided `SEARXNG_API_URL`;
- deploy a separate OpenHost SearXNG app as a dependency;
- support multiple fallback SearXNG URLs;
- or reintroduce bundled SearXNG as an optional mode.

## Suggested next investigation steps

These are proposed next steps only. They have not been run as part of writing this note.

### Step 1: Compare browser HTML vs JSON endpoint for the same query

For `OpenHost news`, compare:

- browser page: `https://searxng.oh.bowei.in/search?q=OpenHost%20news`
- JSON endpoint: `https://searxng.oh.bowei.in/search?q=OpenHost%20news&format=json`

Record:

- whether each returns results;
- result count;
- result titles;
- response status;
- whether auth/login/session/cookies are involved.

### Step 2: Compare request headers

Repeat the JSON endpoint with several header sets:

- plain `curl`;
- browser-like `User-Agent`;
- browser-like `Accept-Language`;
- whatever headers Vane/Node fetch sends, if capturable.

### Step 3: Test from inside the Vane container if possible

If OpenHost allows shell access for `vane2`, run a direct request from inside the app container to isolate network/source differences.

Compare that with:

- workbench curl;
- local browser;
- `oh curl` through OpenHost.

### Step 4: Add temporary instrumentation, not permanent logging

Consider a temporary patch to log, for each Vane search request:

- full SearXNG URL excluding secrets (there should be no secrets);
- HTTP status;
- result count before embedding filtering;
- result count after filtering;
- first few result titles;
- caught errors/timeouts.

This should be removed or gated behind an env var after debugging.

### Step 5: Check SearXNG app logs/config

Inspect the `searxng` OpenHost app logs around the failing query time. Look for:

- bot detection messages;
- engine timeouts;
- upstream 429/403 responses;
- category/engine errors;
- JSON endpoint errors.

### Step 6: Decide product direction

After identifying the reason, decide whether the wrapper should:

- keep using `https://searxng.oh.bowei.in/` as the default;
- require the deployer to configure `SEARXNG_API_URL` explicitly;
- document expected SearXNG settings;
- support fallback URLs;
- or offer an optional bundled SearXNG image mode.

## Current mitigation status

Already done:

- Vane no longer drops all results solely because the embedding similarity filter is too strict, as long as SearXNG returned at least one result.

Not yet done:

- Root-cause analysis for why the configured SearXNG JSON endpoint returned zero results for queries that may return results in a browser.
- Any changes to the SearXNG deployment/configuration.
- Any permanent instrumentation.
- Any fallback/multi-search-provider design.
