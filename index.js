#!/usr/bin/env node

// -------------------------
// IMPORTS
// -------------------------
const fs = require("fs");
const net = require("net");
const WebSocket = require("ws");

// -------------------------
// PLUGIN INFO
// -------------------------
const PLUGIN_ID = "tits.connector";
const LOG_FILE = "plugin-debug.log";
const TITS_WS_URL = "ws://127.0.0.1:42069/websocket";
const TP_HOST = "127.0.0.1";
const TP_PORT = 12136;

let titsClient = null;
let tpClient = null;
let cachedItems = [];
let cachedTriggers = [];

// -------------------------
// LOGGING HELPER
// -------------------------
function logMessage(level, msg, data = null) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${msg}${
    data ? " " + JSON.stringify(data) : ""
  }`;

  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}

  // Forward to Touch Portal (non-fatal if not connected)
  sendToTP({
    type: "log",
    level,
    message: msg + (data ? " " + JSON.stringify(data) : "")
  });
}

// -------------------------
// TOUCH PORTAL CONNECTION
// -------------------------
function connectToTouchPortal() {
  tpClient = new net.Socket();

  tpClient.connect(TP_PORT, TP_HOST, () => {
    logMessage("info", `Connected to Touch Portal on ${TP_HOST}:${TP_PORT}`);
    sendToTP({ type: "pair", id: PLUGIN_ID });
  });

  tpClient.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "action") {
          handleAction(msg.actionId, msg.data || {});
        } else {
          logMessage("debug", "TP ->", msg);
        }
      } catch (err) {
        logMessage("error", "Failed to parse TP message", { err: err.message, raw: line });
      }
    }
  });

  tpClient.on("close", () => {
    logMessage("warn", "Disconnected from Touch Portal, retrying in 5s...");
    setTimeout(connectToTouchPortal, 5000);
  });

  tpClient.on("error", (err) => {
    logMessage("error", "Touch Portal socket error", { err: err.message });
  });
}

function sendToTP(obj) {
  if (!tpClient) return;
  try {
    tpClient.write(JSON.stringify(obj) + "\n");
  } catch (err) {
    // keep logging locally if TP write fails
    console.error("Failed to send to TP", err.message);
  }
}

// -------------------------
// UTIL
// -------------------------
function sanitizeId(name) {
  if (!name) return "";
  return name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 64);
}

// -------------------------
// UPDATE ITEMS
// -------------------------
// Writes items_list.txt as "name : id" lines, updates choice list and creates states
function updateThrowItemChoices(items) {
  if (!Array.isArray(items)) items = [];
  cachedItems = items;

  const itemNames = items.map((i) => i.itemName || i.name || i.id || "");

  // Update TP choice list for single-item actions
  sendToTP({ type: "choiceUpdate", id: "item", value: itemNames });
  logMessage("info", `Updated tits.throwItem choices with ${itemNames.length} items`);

  // Persist items_list.txt in "name : id" format (like triggers_list)
  try {
    const lines = items.map((i) => {
      const name = i.itemName || i.name || i.id || "";
      const id = i.ID || i.id || "";
      return `${name} : ${id}`;
    });
    fs.writeFileSync("items_list.txt", lines.join("\n"), "utf8");
    logMessage("info", `Wrote ${lines.length} items to items_list.txt`);
  } catch (err) {
    logMessage("error", "Failed to write items_list.txt", err.message);
  }

  // Create TP states for each item
  for (const item of items) {
    const rawName = item.itemName || item.name || item.id || "";
    const stateId = sanitizeId(rawName);
    const itemId = item.ID || item.id || "";
    if (!stateId || !itemId) continue;

    sendToTP({
      type: "createState",
      id: stateId,
      desc: rawName,
      defaultValue: itemId,
      forceUpdate: false,
      parentGroup: "Throwables"
    });
  }
}

// -------------------------
// UPDATE TRIGGERS
// -------------------------
function updateTriggerStates(triggers) {
  if (!Array.isArray(triggers)) triggers = [];
  cachedTriggers = triggers;

  logMessage("info", `Updating ${triggers.length} triggers`);

  // Write triggers_list.txt in "name : id" format
  try {
    const lines = triggers.map((t) => {
      const name = t.name || t.displayName || t.id || "";
      const id = t.id || t.ID || "";
      return `${name} : ${id}`;
    });
    fs.writeFileSync("triggers_list.txt", lines.join("\n"), "utf8");
    logMessage("info", `Wrote ${lines.length} triggers to triggers_list.txt`);
  } catch (err) {
    logMessage("error", "Failed to write triggers_list.txt", err.message);
  }

  // Update TP choice list for trigger selection (single select)
  const triggerNames = triggers.map((t) => t.displayName || t.name || t.id || "");
  sendToTP({ type: "choiceUpdate", id: "trigger", value: triggerNames });
  logMessage("info", `Updated trigger choice list with ${triggerNames.length} entries`);

  // Create TP states for each trigger
  for (const trigger of triggers) {
    const rawName = trigger.name || trigger.displayName || trigger.id || "";
    const stateId = sanitizeId(rawName);
    const triggerId = trigger.id || trigger.ID || "";
    if (!stateId || !triggerId) continue;

    sendToTP({
      type: "createState",
      id: stateId,
      desc: rawName,
      defaultValue: triggerId,
      forceUpdate: false,
      parentGroup: "Triggers"
    });
  }
}

// -------------------------
// ACTION HANDLER
// -------------------------
function handleAction(actionId, data) {
  switch (actionId) {
    case "tits.refreshPlugin":
      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(JSON.stringify({ apiName: "TITSPublicApi", apiVersion: "1.0", messageType: "TITSItemListRequest" }));
        titsClient.send(JSON.stringify({ apiName: "TITSPublicApi", apiVersion: "1.0", messageType: "TITSTriggerListRequest" }));
        logMessage("info", "Requested new item & trigger list from TITS");
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot refresh lists");
      }
      break;

    case "tits.throwItem": {
      const itemName = data.find((d) => d.id === "item")?.value || "";
      const amount = parseInt(data.find((d) => d.id === "amountOfThrows")?.value || "1", 10);
      const delay = parseFloat(data.find((d) => d.id === "delayTime")?.value || "0.05");
      const errorOnMissingID = (data.find((d) => d.id === "errorOnMissingID")?.value || "false") === "true";

      const itemObj = cachedItems.find((i) => [i.name, i.itemName, i.id, i.ID].includes(itemName));
      if (!itemObj) {
        logMessage("warn", "Item not found in cachedItems", { itemName });
        return;
      }

      const itemId = itemObj.ID || itemObj.id;
      if (!itemId) {
        logMessage("error", "Selected item has no ID", { itemObj });
        return;
      }

      const payload = {
        apiName: "TITSPublicApi",
        apiVersion: "1.0",
        requestID: Date.now().toString(),
        messageType: "TITSThrowItemsRequest",
        data: { items: [itemId], delayTime: delay, amountOfThrows: amount, errorOnMissingID }
      };

      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(JSON.stringify(payload));
        logMessage("info", "Sent TITSThrowItemsRequest", payload);
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot send throw request");
      }
      break;
    }

    case "tits.throwItems": {
      const names = (data.find((d) => d.id === "items")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
      const amount = parseInt(data.find((d) => d.id === "amountOfThrows")?.value || "1", 10);
      const delay = parseFloat(data.find((d) => d.id === "delayTime")?.value || "0.05");
      const errorOnMissingID = (data.find((d) => d.id === "errorOnMissingID")?.value || "false") === "true";

      const ids = names.map((n) => {
        const obj = cachedItems.find((i) => [i.name, i.itemName, i.id, i.ID].includes(n));
        return obj ? obj.ID || obj.id : null;
      }).filter(Boolean);

      if (ids.length === 0) {
        logMessage("error", "No valid item IDs found for tits.throwItems", { names });
        return;
      }

      const payload = {
        apiName: "TITSPublicApi",
        apiVersion: "1.0",
        requestID: Date.now().toString(),
        messageType: "TITSThrowItemsRequest",
        data: { items: ids, delayTime: delay, amountOfThrows: amount, errorOnMissingID }
      };

      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(JSON.stringify(payload));
        logMessage("info", "Sent TITSThrowItemsRequest (multiple)", payload);
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot send throwItems request");
      }
      break;
    }

    case "tits.triggerthrow": {
      // SINGLE trigger activation — API requires triggerID as a string (not an array)
      const triggerName = data.find((d) => d.id === "trigger")?.value || "";
      const errorOnMissingID = (data.find((d) => d.id === "errorOnMissingID")?.value || "false") === "true";

      const triggerObj = cachedTriggers.find((t) => [t.name, t.displayName, t.id, t.ID].includes(triggerName));
      if (!triggerObj) {
        logMessage("warn", "Trigger not found in cachedTriggers", { triggerName });
        return;
      }

      const triggerId = triggerObj.id || triggerObj.ID;
      if (!triggerId) {
        logMessage("error", "Selected trigger has no ID", { triggerObj });
        return;
      }

      const payload = {
        apiName: "TITSPublicApi",
        apiVersion: "1.0",
        requestID: Date.now().toString(),
        messageType: "TITSTriggerActivateRequest",
        data: { triggerID: triggerId, errorOnMissingID } // <-- single string as required by API
      };

      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(JSON.stringify(payload));
        logMessage("info", "Sent TITSTriggerActivateRequest", payload);
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot send trigger activation");
      }
      break;
    }

    default:
      logMessage("warn", "Unknown action received", { actionId });
  }
}

// -------------------------
// TITS CONNECTION
// -------------------------
function connectToTITS() {
  titsClient = new WebSocket(TITS_WS_URL);

  titsClient.on("open", () => {
    logMessage("info", "Connected to TITS WebSocket");
    // Ask for items and triggers at startup
    titsClient.send(JSON.stringify({ apiName: "TITSPublicApi", apiVersion: "1.0", messageType: "TITSItemListRequest" }));
    titsClient.send(JSON.stringify({ apiName: "TITSPublicApi", apiVersion: "1.0", messageType: "TITSTriggerListRequest" }));
  });

  titsClient.on("message", (data) => {
    try {
      let text = data.toString().trim();

      // unwrap double-encoded JSON if TITS sends that
      if (text.startsWith('"') && text.endsWith('"')) {
        text = text.slice(1, -1).replace(/\\"/g, '"');
      }

      const msg = JSON.parse(text);

      if (msg.messageType === "TITSItemListResponse" && msg.data?.items) {
        updateThrowItemChoices(msg.data.items);
      }

      if (msg.messageType === "TITSTriggerListResponse" && msg.data?.triggers) {
        updateTriggerStates(msg.data.triggers);
      }
    } catch (err) {
      logMessage("error", "Failed to parse TITS data", { err: err.message, raw: data.toString() });
    }
  });

  titsClient.on("close", () => {
    logMessage("warn", "Disconnected from TITS, retrying in 5s...");
    setTimeout(connectToTITS, 5000);
  });

  titsClient.on("error", (err) => {
    logMessage("error", "TITS WebSocket error", { err: err.message });
  });
}

// -------------------------
// START
// -------------------------
connectToTouchPortal();
connectToTITS();
logMessage("info", "TITS Plugin started (items + triggers dynamic mode)");
