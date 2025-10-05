#!/usr/bin/env node

// -------------------------
// IMPORTS
// -------------------------
const fs = require("fs");
const net = require("net");
const WebSocket = require("ws");

// -------------------------
// PLUGIN INFO & SETTINGS
// -------------------------
const PLUGIN_ID = "tits.connector";
const LOG_FILE = "plugin-debug.log";

const TITS_WS_HOST = "127.0.0.1";
let TITS_WS_PORT = 42069;
const TP_HOST = "127.0.0.1";
const TP_PORT = 12136;

// -------------------------
// CLIENTS & CACHE
// -------------------------
let titsClient = null;
let tpClient = null;
let cachedItems = [];
let cachedTriggers = [];
let DEBUG_LOGGING = false;

// -------------------------
// LOGGING HELPER
// -------------------------
function logMessage(level, msg, data = null) {
  if (!DEBUG_LOGGING && level === "debug") return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${msg}${data ? " " + JSON.stringify(data) : ""}`;

  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}

  sendToTP({
    type: "log",
    level,
    message: msg + (data ? " " + JSON.stringify(data) : "")
  });
}

// -------------------------
// UTILS
// -------------------------
function sanitizeId(name) {
  if (!name) return "";
  return name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 64);
}

function readLeftNamesFromFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const idx = line.indexOf(":");
        const left = idx >= 0 ? line.slice(0, idx).trim() : line;
        return sanitizeId(left);
      })
      .filter(Boolean);
  } catch { return []; }
}

function getTitsWsUrl() {
  return `ws://${TITS_WS_HOST}:${TITS_WS_PORT}/websocket`;
}

// -------------------------
// TOUCH PORTAL CONNECTION
// -------------------------
function connectToTouchPortal() {
  tpClient = new net.Socket();

  tpClient.connect(TP_PORT, TP_HOST, () => {
    logMessage("info", `Connected to Touch Portal on ${TP_HOST}:${TP_PORT}`);
    sendToTP({ type: "pair", id: PLUGIN_ID });
    requestSettingsUpdateListener();
  });

  tpClient.on("data", chunk => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        if (msg.type === "info" || msg.type === "settingsUpdated") {
          logMessage("debug", `TP ${msg.type} received`, msg);
          handleSettingsUpdate(msg);
          continue;
        }

        if (msg.type === "action") handleAction(msg.actionId, msg.data || {});
        else logMessage("debug", "TP ->", msg);

      } catch (err) {
        logMessage("error", "Failed to parse TP message", { err: err.message, raw: line });
      }
    }
  });

  tpClient.on("close", () => {
    logMessage("warn", "Disconnected from Touch Portal, retrying in 5s...");
    setTimeout(connectToTouchPortal, 5000);
  });

  tpClient.on("error", err => logMessage("error", "Touch Portal socket error", { err: err.message }));
}

function sendToTP(obj) {
  if (!tpClient) return;
  try { tpClient.write(JSON.stringify(obj) + "\n"); } catch (err) { logMessage("error", "Failed to send to TP", err.message); }
}

function requestSettingsUpdateListener() {
  sendToTP({
    type: "listenForSettings",
    section: "communication_listen_settings"
  });
}

function handleSettingsUpdate(msg) {
  if (!Array.isArray(msg.settings)) return;

  for (const s of msg.settings) {
    if ("Debug Logging" in s) {
      DEBUG_LOGGING = s["Debug Logging"] === true;
      logMessage("info", `Debug Logging set to ${DEBUG_LOGGING}`);
    }

    if ("TITS Port" in s) updateTitsPortFromSettings(s["TITS Port"]);
  }
}

// -------------------------
// TITS CONNECTION
// -------------------------
function connectToTITS() {
  const url = getTitsWsUrl();
  titsClient = new WebSocket(url);
  logMessage("info", `Connecting to TITS WebSocket at ${url}`);

  titsClient.on("open", () => {
    logMessage("info", "Connected to TITS WebSocket");
    refreshTITSData();
  });

  titsClient.on("message", data => {
    try {
      let text = data.toString().trim();
      if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).replace(/\\"/g, '"');
      const msg = JSON.parse(text);
      if (msg.messageType === "TITSItemListResponse" && msg.data?.items) updateThrowItemChoices(msg.data.items);
      if (msg.messageType === "TITSTriggerListResponse" && msg.data?.triggers) updateTriggerStates(msg.data.triggers);
    } catch (err) {
      logMessage("error", "Failed to parse TITS data", { err: err.message, raw: data.toString() });
    }
  });

  titsClient.on("close", () => {
    logMessage("warn", "Disconnected from TITS, retrying in 5s...");
    setTimeout(connectToTITS, 5000);
  });

  titsClient.on("error", err => logMessage("error", "TITS WebSocket error", { err: err.message }));
}

function updateTitsPortFromSettings(port) {
  logMessage("info", `TITS WebSocket port from TP settings: ${port}`);
  const parsedPort = parseInt(port, 10);
  if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
    if (TITS_WS_PORT !== parsedPort) {
      TITS_WS_PORT = parsedPort;
      logMessage("info", `TITS WebSocket port updated: ${TITS_WS_PORT}`);
      if (titsClient) {
        titsClient.close();
        connectToTITS();
      }
    }
  } else {
    logMessage("warn", "Invalid TITS port from settings, keeping default", { port });
  }
}

// -------------------------
// ITEMS & TRIGGERS
// -------------------------
function updateThrowItemChoices(items) {
  if (!Array.isArray(items)) items = [];
  cachedItems = items;

  items.sort((a, b) => ((a.itemName || a.name || a.id || "").toLowerCase())
    .localeCompare((b.itemName || b.name || b.id || "").toLowerCase()));

  const oldIds = readLeftNamesFromFile("items_list.txt");
  const newIds = items.map(i => sanitizeId(i.itemName || i.name || i.id || "")).filter(Boolean);
  oldIds.filter(id => !newIds.includes(id)).forEach(id => sendToTP({ type: "removeState", id }));

  sendToTP({ type: "choiceUpdate", id: "item", value: items.map(i => i.itemName || i.name || i.id || "") });

  try {
    fs.writeFileSync("items_list.txt", items.map(i => `${i.itemName || i.name || i.id || ""} : ${i.ID || i.id || ""}`).join("\n"), "utf8");
  } catch (err) { logMessage("error", "Failed to write items_list.txt", err.message); }

  items.forEach(item => {
    const stateId = sanitizeId(item.itemName || item.name || item.id || "");
    const itemId = item.ID || item.id || "";
    if (!stateId || !itemId) return;
    sendToTP({
      type: "createState",
      id: stateId,
      desc: item.itemName || item.name || item.id || "",
      defaultValue: itemId,
      forceUpdate: false,
      parentGroup: "Throwables"
    });
  });

  logMessage("debug", "Throw items updated", { count: items.length });
}

function updateTriggerStates(triggers) {
  if (!Array.isArray(triggers)) triggers = [];
  cachedTriggers = triggers;

  triggers.sort((a, b) => ((a.displayName || a.name || a.id || "").toLowerCase())
    .localeCompare((b.displayName || b.name || b.id || "").toLowerCase()));

  const oldIds = readLeftNamesFromFile("triggers_list.txt");
  const newIds = triggers.map(t => sanitizeId(t.name || t.displayName || t.id || "")).filter(Boolean);
  oldIds.filter(id => !newIds.includes(id)).forEach(id => sendToTP({ type: "removeState", id }));

  sendToTP({ type: "choiceUpdate", id: "trigger", value: triggers.map(t => t.displayName || t.name || t.id || "") });

  try {
    fs.writeFileSync("triggers_list.txt", triggers.map(t => `${t.name || t.displayName || t.id || ""} : ${t.id || t.ID || ""}`).join("\n"), "utf8");
  } catch (err) { logMessage("error", "Failed to write triggers_list.txt", err.message); }

  triggers.forEach(trigger => {
    const stateId = sanitizeId(trigger.name || trigger.displayName || trigger.id || "");
    const triggerId = trigger.id || trigger.ID || "";
    if (!stateId || !triggerId) return;
    sendToTP({
      type: "createState",
      id: stateId,
      desc: trigger.name || trigger.displayName || trigger.id || "",
      defaultValue: triggerId,
      forceUpdate: false,
      parentGroup: "Triggers"
    });
  });

  logMessage("debug", "Trigger states updated", { count: triggers.length });
}

// -------------------------
// ACTION HANDLER
// -------------------------
function handleAction(actionId, data) {
  logMessage("debug", "Handling action", { actionId, data });
  switch (actionId) {
    case "tits.refreshPlugin": refreshTITSData(); break;
    case "tits.throwItem": handleThrowItem(data); break;
    case "tits.throwItems": handleThrowItems(data); break;
    case "tits.triggerthrow": handleTriggerThrow(data); break;
    default: logMessage("warn", "Unknown action received", { actionId });
  }
}

function refreshTITSData() {
  if (titsClient?.readyState === WebSocket.OPEN) {
    titsClient.send(JSON.stringify({ apiName: "TITSPublicApi", apiVersion: "1.0", messageType: "TITSItemListRequest" }));
    titsClient.send(JSON.stringify({ apiName: "TITSPublicApi", apiVersion: "1.0", messageType: "TITSTriggerListRequest" }));
    logMessage("debug", "Requested TITS items & triggers refresh");
  }
}

// -------------------------
// TITS ACTION HELPERS
// -------------------------
function handleThrowItem(data) {
  const itemName = data.find(d => d.id === "item")?.value || "";
  const amount = parseInt(data.find(d => d.id === "amountOfThrows")?.value || "1", 10);
  const delay = parseFloat(data.find(d => d.id === "delayTime")?.value || "0.05");
  const errorOnMissingID = (data.find(d => d.id === "errorOnMissingID")?.value || "false") === "true";

  const itemObj = cachedItems.find(i => [i.name, i.itemName, i.id, i.ID].includes(itemName));
  if (!itemObj) return logMessage("warn", "Item not found", { itemName });

  const itemId = itemObj.ID || itemObj.id;
  if (!itemId) return logMessage("error", "Item has no ID", { itemObj });

  const payload = {
    apiName: "TITSPublicApi",
    apiVersion: "1.0",
    requestID: Date.now().toString(),
    messageType: "TITSThrowItemsRequest",
    data: { items: [itemId], delayTime: delay, amountOfThrows: amount, errorOnMissingID }
  };

  if (titsClient?.readyState === WebSocket.OPEN) titsClient.send(JSON.stringify(payload));
}

function handleThrowItems(data) {
  const names = (data.find(d => d.id === "items")?.value || "").split(",").map(s => s.trim()).filter(Boolean);
  const amount = parseInt(data.find(d => d.id === "amountOfThrows")?.value || "1", 10);
  const delay = parseFloat(data.find(d => d.id === "delayTime")?.value || "0.05");
  const errorOnMissingID = (data.find(d => d.id === "errorOnMissingID")?.value || "false") === "true";

  const ids = names.map(n => {
    const obj = cachedItems.find(i => [i.name, i.itemName, i.id, i.ID].includes(n));
    return obj ? obj.ID || obj.id : null;
  }).filter(Boolean);

  if (!ids.length) return logMessage("error", "No valid item IDs found", { names });

  const payload = {
    apiName: "TITSPublicApi",
    apiVersion: "1.0",
    requestID: Date.now().toString(),
    messageType: "TITSThrowItemsRequest",
    data: { items: ids, delayTime: delay, amountOfThrows: amount, errorOnMissingID }
  };

  if (titsClient?.readyState === WebSocket.OPEN) titsClient.send(JSON.stringify(payload));
}

function handleTriggerThrow(data) {
  const triggerName = data.find(d => d.id === "trigger")?.value || "";
  const errorOnMissingID = (data.find(d => d.id === "errorOnMissingID")?.value || "false") === "true";

  const triggerObj = cachedTriggers.find(t => [t.name, t.displayName, t.id, t.ID].includes(triggerName));
  if (!triggerObj) return logMessage("warn", "Trigger not found", { triggerName });

  const triggerId = triggerObj.id || triggerObj.ID;
  if (!triggerId) return logMessage("error", "Trigger has no ID", { triggerObj });

  const payload = {
    apiName: "TITSPublicApi",
    apiVersion: "1.0",
    requestID: Date.now().toString(),
    messageType: "TITSTriggerActivateRequest",
    data: { triggerID: triggerId, errorOnMissingID }
  };

  if (titsClient?.readyState === WebSocket.OPEN) titsClient.send(JSON.stringify(payload));
}

// -------------------------
// START PLUGIN
// -------------------------
connectToTouchPortal();
connectToTITS();
updateThrowItemChoices(cachedItems);
updateTriggerStates(cachedTriggers);
logMessage("info", "TITS Plugin started (items + triggers dynamic mode, auto-port from TP)");
