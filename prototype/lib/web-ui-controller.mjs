import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const DEFAULT_SERVER_PATH = path.resolve(import.meta.dirname, "../server.mjs");

function configuredPort(value = process.env.CAPABILITY_ATLAS_WEB_PORT) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("web-ui-port-invalid");
  return port;
}

function urlFor(host, port) {
  return `http://${host}:${port}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function probeWebUi(url, fetchImpl, timeoutMs = 750) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${url}/api/health`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.ok === true
      && health?.workflowPersistence === true
      && health?.mcpTransport === "stdio"
      && health?.version === "0.6.0";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function listenTemporarily(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeTemporaryServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function availablePort(host) {
  const reservation = net.createServer();
  await listenTemporarily(reservation, 0, host);
  const address = reservation.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await closeTemporaryServer(reservation);
  if (!port) throw new Error("web-ui-ephemeral-port-unavailable");
  return port;
}

function portIsOccupied(host, port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

async function waitForHealthy(url, fetchImpl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await probeWebUi(url, fetchImpl, 250)) return true;
    await delay(75);
  } while (Date.now() < deadline);
  return false;
}

function childIsRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

async function stopChild(child, graceMs = 1_500) {
  if (!childIsRunning(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(graceMs)]);
  if (!childIsRunning(child)) return;
  child.kill("SIGKILL");
  await Promise.race([exited, delay(500)]);
}

function browserCommand(url, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

function openBrowser(url, { spawnImpl = spawn, platform = process.platform } = {}) {
  const { command, args } = browserCommand(url, platform);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`browser-open-exited:${code}`));
    });
  });
}

export function createWebUiController(options = {}) {
  const host = DEFAULT_HOST;
  const requestedPort = configuredPort(options.port);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const spawnImpl = options.spawnImpl || spawn;
  const openBrowserImpl = options.openBrowserImpl || openBrowser;
  const serverPath = path.resolve(options.serverPath || DEFAULT_SERVER_PATH);
  const execPath = options.execPath || process.execPath;
  const startupTimeoutMs = Math.max(1_000, Math.min(30_000, Number(options.startupTimeoutMs) || 6_000));
  let activePort = requestedPort || null;
  let activeUrl = activePort ? urlFor(host, activePort) : null;
  let ownedChild = null;
  let starting = null;

  async function resolvePort() {
    if (!activePort) {
      activePort = await availablePort(host);
      activeUrl = urlFor(host, activePort);
    }
    return activePort;
  }

  async function startChildServer() {
    const port = await resolvePort();
    if (await probeWebUi(activeUrl, fetchImpl)) {
      return { status: "already-running", url: activeUrl, lifecycle: "external" };
    }
    if (await portIsOccupied(host, port)) {
      // Another trusted connector may be between listen() and health readiness.
      if (await waitForHealthy(activeUrl, fetchImpl, 1_500)) {
        return { status: "already-running", url: activeUrl, lifecycle: "external" };
      }
      throw new Error(`web-ui-port-in-use:${port}`);
    }

    let stderr = "";
    let spawnError = null;
    const child = spawnImpl(execPath, [serverPath], {
      cwd: path.dirname(serverPath),
      detached: false,
      env: {
        ...process.env,
        ...(options.env || {}),
        HOST: host,
        PORT: String(port),
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    ownedChild = child;
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_192);
    });
    child.once("error", (error) => {
      spawnError = error;
    });

    if (await waitForHealthy(activeUrl, fetchImpl, startupTimeoutMs)) {
      if (childIsRunning(child)) {
        return { status: "started", url: activeUrl, lifecycle: "mcp-session" };
      }
      ownedChild = null;
      return { status: "already-running", url: activeUrl, lifecycle: "external" };
    }

    if (childIsRunning(child)) await stopChild(child);
    if (ownedChild === child) ownedChild = null;
    if (await portIsOccupied(host, port)) throw new Error(`web-ui-port-in-use:${port}`);
    const detail = spawnError?.message || stderr.trim().split("\n").at(-1) || "health-check-timeout";
    throw new Error(`web-ui-start-failed:${detail}`);
  }

  async function ensureStarted() {
    if (childIsRunning(ownedChild) && activeUrl && await probeWebUi(activeUrl, fetchImpl)) {
      return { status: "already-running", url: activeUrl, lifecycle: "mcp-session" };
    }
    if (activeUrl && await probeWebUi(activeUrl, fetchImpl)) {
      return { status: "already-running", url: activeUrl, lifecycle: "external" };
    }
    if (!starting) {
      starting = startChildServer().finally(() => {
        starting = null;
      });
    }
    return starting;
  }

  return {
    ensureStarted,

    async open({ openBrowser: shouldOpenBrowser = true } = {}) {
      const state = await ensureStarted();
      let browserOpened = false;
      let browserWarning = null;
      if (shouldOpenBrowser) {
        try {
          await openBrowserImpl(state.url);
          browserOpened = true;
        } catch (error) {
          browserWarning = `browser-open-failed:${error?.message || "unknown-error"}`;
        }
      }
      return {
        ok: true,
        ...state,
        browserOpened,
        ...(browserWarning ? { browserWarning } : {}),
        message: browserOpened
          ? "Capability Atlas Web UI is ready for visual review and human confirmation."
          : `Capability Atlas Web UI is ready. Open ${state.url} for visual review.`,
      };
    },

    async close() {
      const child = ownedChild;
      ownedChild = null;
      if (child) await stopChild(child);
    },

    terminate() {
      const child = ownedChild;
      ownedChild = null;
      if (childIsRunning(child)) child.kill("SIGTERM");
    },
  };
}
