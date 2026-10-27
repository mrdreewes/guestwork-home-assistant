#!/usr/bin/env node
/**
 * GuestWork hub, as a Home Assistant app: everything the app runs on its own. The hub itself comes from GuestWork.
 *
 *  1. Linked first. With no hub token yet, it asks GuestWork for a link and shows it as a Home Assistant notification
 *     (and in this app's log). Its owner opens it, taps Link in GuestWork, and the hub's token comes back here.
 *  2. The hub, from GuestWork, to a linked hub only. The list of its files is checked against the release key in this
 *     app (release-key.pub) before anything is downloaded, and every file against the list. One that doesn't match,
 *     or a list signed by any other key, and nothing runs.
 *  3. Started with this Home Assistant as its own (Home Assistant's address for apps, and this app's token), on the
 *     host's network, where it can see the property's router. From then on it updates itself, each update checked
 *     against the same key, and rolled back if it doesn't come up.
 *
 * Nothing listens: every connection goes out, to GuestWork and to devices on this network.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The list of the hub's files, signed with the release key. */
export const FILE_LIST = "image-release.json";
export const NOTIFICATION_ID = "guestwork_hub_link";
const MINUTE = 60_000;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
/** A key's short name: a signed list says which key signed it. */
export const keyIdOf = (pem) => sha256(Buffer.from(String(pem).trim())).slice(0, 16);

/** A file the list may name: one in the hub's own folder, or one of the energy monitor's. Never a path out of it. */
export function fileOk(name) {
  if (name === "Dockerfile" || name === "release-key.pub") return true;
  if (/^power\/[a-z][a-z0-9_]*\.py$/.test(name)) return true;
  return /^[a-z][A-Za-z0-9]*\.mjs$/.test(name) && !name.endsWith(".test.mjs");
}

/** What the key signed: the list's number, version and files, in one order. */
export function signedText(list) {
  const files = {};
  for (const name of Object.keys(list.files).sort()) files[name] = list.files[name];
  return JSON.stringify({ kind: "image", image: list.image, version: list.version, files });
}

/** Null when `list` is the hub's, signed with `pem`; else why not. */
export function checkList(list, pem) {
  const o = list;
  if (!o || typeof o.version !== "string" || !/^\d+(\.\d+){1,3}$/.test(o.version) || typeof o.signature !== "string" || typeof o.keyId !== "string") return "not a hub release";
  if (!Number.isInteger(o.image) || o.image < 1 || !o.files || typeof o.files !== "object") return "not a hub release";
  const names = Object.keys(o.files);
  if (!["Dockerfile", "boot.mjs", "agent.mjs", "release-key.pub"].every((n) => names.includes(n))) return "not a hub release";
  const odd = names.find((n) => !fileOk(n) || !/^[0-9a-f]{64}$/.test(o.files[n]));
  if (odd) return `${odd} isn't a hub file`;
  if (!pem || o.keyId !== keyIdOf(pem)) return "signed by another key";
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(signedText(o)), String(pem), Buffer.from(o.signature, "base64"));
  } catch {
    ok = false;
  }
  return ok ? null : "bad signature";
}

/** Null when `dir` holds every file its list names, as signed, and the key in it is this app's own; else why not. */
export function checkDir(dir, pem) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(path.join(dir, FILE_LIST), "utf8"));
  } catch {
    return `no ${FILE_LIST}`;
  }
  const why = checkList(list, pem);
  if (why) return why;
  for (const [name, digest] of Object.entries(list.files)) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(dir, name));
    } catch {
      return `${name} is missing`;
    }
    if (sha256(buf) !== digest) return `${name} doesn't match`;
  }
  if (fs.readFileSync(path.join(dir, "release-key.pub"), "utf8").trim() !== String(pem).trim()) return "it carries another key";
  return null;
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
}

/** The list wouldn't run (a signature, a file that doesn't match): asked again later, never run. */
class Refused extends Error {}

/** This box's own network cards, so the hub never counts itself as a guest's device. */
export function boxMacs(sysNet = "/sys/class/net") {
  try {
    const macs = fs
      .readdirSync(sysNet)
      .filter((i) => fs.existsSync(path.join(sysNet, i, "device")))
      .map((i) => fs.readFileSync(path.join(sysNet, i, "address"), "utf8").trim().toLowerCase())
      .filter((m) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) && m !== "00:00:00:00:00:00");
    return [...new Set(macs)].sort().join(",");
  } catch {
    return "";
  }
}

/** The hub's settings for its run: this Home Assistant as its own, and where it lives. Pure. */
export function hubEnv(env, { base, dataDir, dir, keyFile, haUrl, place, image, macs }) {
  const { SUPERVISOR_TOKEN: haToken, HASSIO_TOKEN: _old, ...rest } = env;
  return {
    ...rest,
    GUESTWORK_URL: base,
    STATE_DIR: dataDir,
    AGENT_BAKED_DIR: dir,
    AGENT_KEY_FILE: keyFile,
    GW_IMAGE: String(image),
    HUB_KIND: "home_assistant",
    ...(place ? { HUB_PLACE: place } : {}),
    // Home Assistant's own address for apps, and this app's token: the thermostats, and only them (the hub's own list).
    ...(haToken ? { HA_AGENT_URL: haUrl, HA_CLIMATE_TOKEN: haToken } : {}),
    ...(macs ? { HUB_MACS: macs } : {}),
    DRY_RUN: "0",
  };
}

/**
 * Everything before the hub runs: its token (linked if there's none), and its files, checked. Returns the folder to
 * run, its signed list and Home Assistant's name for the place. Waits as long as it takes: for GuestWork, for the
 * link to be opened, for a list that runs.
 */
export async function prepare({ base, dataDir, pem, haUrl, haToken, fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const hubFile = path.join(dataDir, "hub.json");
  const root = path.join(dataDir, "install");
  const ha = (p, init = {}) => fetchImpl(`${haUrl}${p}`, { ...init, headers: { Authorization: `Bearer ${haToken}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000) });
  const gw = (p, { token, body } = {}) =>
    fetchImpl(`${base}${p}`, {
      method: body ? "POST" : "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  const json = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  // Home Assistant's own name for the place: GuestWork offers the property of that name when the link is opened.
  let place = null;
  if (haToken) {
    try {
      const r = await ha("/api/config");
      place = r.ok ? String((await json(r))?.location_name ?? "").trim().slice(0, 60) || null : null;
    } catch {
      /* named in GuestWork instead */
    }
  }

  const notify = async (service, data) => {
    if (!haToken) return;
    const r = await ha(`/api/services/persistent_notification/${service}`, { method: "POST", body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`Home Assistant answered ${r.status}`);
  };

  async function link() {
    for (;;) {
      const r = await gw("/api/hub/link", { body: { hint: { kind: "home_assistant", place } } }).catch((e) => ({ ok: false, status: e.message }));
      const l = r.ok ? await json(r) : null;
      if (!l?.deviceCode || !l?.url) {
        log(`Can't ask GuestWork for a link yet (${r.status}): asking again in a minute.`);
        await sleep(MINUTE);
        continue;
      }
      const typeAt = l.typeAt || `${base}/hubs/link`;
      log(`To link this hub, open ${l.url} (or ${typeAt} and type ${l.userCode}).`);
      await notify("create", {
        notification_id: NOTIFICATION_ID,
        title: "Link this hub to GuestWork",
        message: `[Open this link](${l.url}) and tap **Link** in GuestWork.\n\nOr go to ${typeAt} and type **${l.userCode}**. It lasts 30 minutes; a new one replaces it here.`,
      }).catch((e) => log(`Couldn't show the link in Home Assistant (${e.message}): it's above.`));
      const endsAt = now() + (Number(l.expiresInSec) || 1800) * 1000;
      while (now() < endsAt) {
        await sleep(Math.max(2, Number(l.pollSec) || 5) * 1000);
        const c = await gw("/api/hub/link/collect", { body: { deviceCode: l.deviceCode, hubName: "" } })
          .then(json)
          .catch(() => null);
        if (c?.state === "linked" && c.token) {
          writePrivate(hubFile, JSON.stringify({ token: c.token, hubId: c.hubId, pairedAt: new Date(now()).toISOString() }));
          // What was waiting to be sent belongs to the old link, which may have been another property.
          fs.rmSync(path.join(dataDir, "queue.jsonl"), { force: true });
          await notify("dismiss", { notification_id: NOTIFICATION_ID }).catch(() => {});
          log(`Linked as hub ${c.hubId}${c.name ? `, "${c.name}"` : ""}.`);
          return c.token;
        }
        if (c?.state === "expired" || c?.state === "unknown") break;
      }
      log("That link expired: here's a new one.");
    }
  }

  /** Unlinked in GuestWork (its token refused): the old link is put aside, and the hub asks to be linked again. */
  function forget() {
    if (fs.existsSync(hubFile)) fs.renameSync(hubFile, `${hubFile}.old`);
    log("GuestWork no longer knows this hub (it was unlinked): asking to link it again.");
  }

  /** The files, the list first: nothing is downloaded until the list is signed with this app's key. */
  async function download(token) {
    const file = (name) => gw(`/api/hub/install/file?name=${encodeURIComponent(name)}`, { token });
    const res = await file(FILE_LIST);
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`GuestWork answered ${res.status} for the hub's list`);
    const listBuf = Buffer.from(await res.arrayBuffer());
    const list = (() => {
      try {
        return JSON.parse(listBuf.toString("utf8"));
      } catch {
        return null;
      }
    })();
    const why = checkList(list, pem);
    if (why) throw new Refused(`the hub's list won't run: ${why}`);
    const dir = path.join(root, list.version);
    const part = `${dir}.part`;
    fs.rmSync(part, { recursive: true, force: true });
    fs.mkdirSync(part, { recursive: true });
    fs.writeFileSync(path.join(part, FILE_LIST), listBuf);
    for (const [name, digest] of Object.entries(list.files)) {
      const r = await file(name);
      if (r.status === 401) return null;
      if (!r.ok) throw new Error(`couldn't download ${name} (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (sha256(buf) !== digest) throw new Refused(`${name} doesn't match its signed list`);
      fs.mkdirSync(path.dirname(path.join(part, name)), { recursive: true });
      fs.writeFileSync(path.join(part, name), buf);
    }
    const again = checkDir(part, pem);
    if (again) throw new Refused(`the download won't run: ${again}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(part, dir);
    fs.writeFileSync(path.join(root, "current.json"), JSON.stringify({ version: list.version }));
    for (const d of fs.readdirSync(root)) if (d !== list.version && d !== "current.json") fs.rmSync(path.join(root, d), { recursive: true, force: true });
    log(`Hub ${list.version} downloaded and checked against the release key.`);
    return { dir, list };
  }

  /** What's here and still checks out, else null. */
  function installed() {
    const version = readJson(path.join(root, "current.json"))?.version;
    if (typeof version !== "string" || !/^\d+(\.\d+){1,3}$/.test(version)) return null;
    const dir = path.join(root, version);
    const why = checkDir(dir, pem);
    if (why) {
      log(`The hub here won't run (${why}): downloading it again.`);
      return null;
    }
    return { dir, list: readJson(path.join(dir, FILE_LIST)) };
  }

  let wait = MINUTE;
  for (;;) {
    const token = readJson(hubFile)?.token || (await link());
    const have = installed();
    try {
      if (have) {
        // Still linked? The one answer that says no is a 401; GuestWork out of reach runs the hub that's here.
        const r = await gw("/api/hub/install/manifest", { token }).catch(() => null);
        if (r?.status === 401) {
          forget();
          continue;
        }
        return { ...have, place };
      }
      const got = await download(token);
      if (got) return { ...got, place };
      forget();
    } catch (e) {
      log(`${e instanceof Refused ? "Not running it" : "Couldn't get the hub"}: ${e.message}. Trying again in ${Math.round(wait / MINUTE)} min.`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60 * MINUTE);
    }
  }
}

async function main() {
  const env = process.env;
  const base = (env.GUESTWORK_URL || "https://guestwork.app").replace(/\/+$/, "");
  const dataDir = env.GW_APP_DATA || "/data";
  const keyFile = path.join(HERE, "release-key.pub");
  const haUrl = "http://supervisor/core";
  const log = (...a) => console.log(new Date().toISOString(), "[app]", ...a);
  const pem = fs.readFileSync(keyFile, "utf8");
  if (!env.SUPERVISOR_TOKEN) log("Home Assistant gave this app no access to its API: the thermostats won't show in GuestWork.");
  log(`Release key ${keyIdOf(pem)}.`);
  const { dir, list, place } = await prepare({ base, dataDir, pem, haUrl, haToken: env.SUPERVISOR_TOKEN, log });
  const child = spawn(process.execPath, [path.join(dir, "boot.mjs")], {
    cwd: dir,
    stdio: "inherit",
    env: hubEnv(env, { base, dataDir, dir, keyFile, haUrl, place, image: list.image, macs: boxMacs() }),
  });
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(new Date().toISOString(), "[app]", e?.stack ?? e);
    process.exit(1);
  });
}
