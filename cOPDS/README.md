# WinterCG Worker (JavaScript) + Wasmer

This example shows how to run a **WinterCG-compatible worker**—powered by **WinterJS**—on **Wasmer Edge**.

> Full tutorial: https://docs.wasmer.io/edge/quickstart/js-wintercg

## Demo

https://wasmer-js-worker-starter.wasmer.app/

## How it Works

`src/index.js` exports a single fetch event handler:

* `handler(request)` serialises the worker’s environment (`process.env`) into JSON.
* `addEventListener("fetch", ...)` registers the handler so every request returns the JSON payload.

Because WinterJS implements the WinterCG APIs, the same worker can run on Wasmer Edge or other compatible hosts.

## Running Locally

```bash
wasmer run .
```

The Wasmer CLI bundles and serves the worker on `http://127.0.0.1:8080/`. Modify `src/index.js`, rerun the command, and refresh to test changes.

## Deploying to Wasmer (Overview)

1. Ensure your project exports a fetch handler from `src/index.js` (or another entrypoint defined in `wasmer.toml`).
2. Deploy with `wasmer deploy` or via the Wasmer dashboard.
3. Hit `https://<your-subdomain>.wasmer.app/` to inspect the response.
