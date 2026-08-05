import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWebUiController } from "../lib/web-ui-controller.mjs";

async function temporaryEnvironment(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-web-lifecycle-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    CAPABILITY_ATLAS_DATA_DIR: path.join(directory, "data"),
    CAPABILITY_ATLAS_HOME_DIR: path.join(directory, "home"),
  };
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitUntilUnavailable(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`${url}/api/health`);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test("spawns server.mjs once and reuses it across trusted connector controllers", async (context) => {
  const env = await temporaryEnvironment(context);
  let openedUrl = null;
  const owner = createWebUiController({
    port: 0,
    env,
    openBrowserImpl: async (url) => {
      openedUrl = url;
    },
  });
  context.after(() => owner.close());

  const started = await owner.ensureStarted();
  assert.equal(started.status, "started");
  assert.equal(started.lifecycle, "mcp-session");
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const healthResponse = await fetch(`${started.url}/api/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.app, "capability-atlas");

  const peer = createWebUiController({
    port: Number(new URL(started.url).port),
    env,
    openBrowserImpl: async () => {},
  });
  context.after(() => peer.close());
  const reused = await peer.ensureStarted();
  assert.equal(reused.status, "already-running");
  assert.equal(reused.lifecycle, "external");
  assert.equal(reused.url, started.url);

  const opened = await owner.open();
  assert.equal(opened.status, "already-running");
  assert.equal(opened.lifecycle, "mcp-session");
  assert.equal(opened.browserOpened, true);
  assert.equal(openedUrl, started.url);

  await owner.close();
  assert.equal(await waitUntilUnavailable(started.url), true);
});

test("does not replace a foreign process on the configured Web port", async (context) => {
  const env = await temporaryEnvironment(context);
  const foreign = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("foreign-service");
  });
  await listen(foreign);
  context.after(() => close(foreign));
  const address = foreign.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const controller = createWebUiController({ port, env, startupTimeoutMs: 1_000 });
  context.after(() => controller.close());

  await assert.rejects(controller.ensureStarted(), new RegExp(`web-ui-port-in-use:${port}`));
  const response = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(await response.text(), "foreign-service");
});
