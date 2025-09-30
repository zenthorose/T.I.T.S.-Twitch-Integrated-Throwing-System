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
let tpClient = null; // Touch Portal socket client
let cachedItems = []; // store items for throwItem choices

// -------------------------
// LOGGING HELPER
// -------------------------
function logMessage(level, msg, data = null) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${msg}${data ? " " + JSON.stringify(data) : ""}`;

  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}

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
    logMessage("info", `Connected to Touch Portal socket on ${TP_HOST}:${TP_PORT}`);

    // Send pairing request
    sendToTP({
      type: "pair",
      id: PLUGIN_ID
    });
    //logMessage("info", "Sent pair request to Touch Portal");
  });

  tpClient.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        //logMessage("debug", "Received from TP", msg);

        if (msg.type === "info") {
          //logMessage("info", "Pairing successful with Touch Portal", msg);
        }

        if (msg.type === "action") {
          handleAction(msg.actionId, msg.data || {});
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
    console.error("Failed to send to TP", err.message);
  }
}

// -------------------------
// UPDATE THROW ITEM CHOICES
// -------------------------
function updateThrowItemChoices(items) {
  logMessage("info","Attempting to update throw item");
  const itemNames = items.map(i => i.itemName || i.name || i.id);

  sendToTP({
    //type: "updateActionData",
    //pluginId: PLUGIN_ID,
    //instanceId: "tits.throwItem.item",
    //choices: itemNames,

    
    "type":"choiceUpdate",
    "id":"item",
    "value":itemNames

  });

  logMessage("info", `Updated tits.throwItem choices with ${itemNames.length} items`, itemNames);
}

// -------------------------
// ACTION HANDLER
// -------------------------
function handleAction(actionId, data) {
  switch (actionId) {
    case "tits.refreshItems":
      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(JSON.stringify({
          apiName: "TITSPublicApi",
          apiVersion: "1.0",
          messageType: "TITSItemListRequest"
        }));
        logMessage("info", "Requested new item list from TITS");
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot refresh items");
      }
      break;

    case "tits.throwItem": {
      const item = data.find(d => d.id === "item")?.value || "";
      const amount = parseInt(data.find(d => d.id === "amountOfThrows")?.value || "1", 10);
      const delay = parseFloat(data.find(d => d.id === "delayTime")?.value || "0.05");
      const errorOnMissingID = (data.find(d => d.id === "errorOnMissingID")?.value || "false") === "true";

      logMessage("info", "tits.throwItem triggered", { item, amount, delay, errorOnMissingID });

      if (!item) {
        logMessage("warn", "No item specified in tits.throwItem payload");
        return;
      }

      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(JSON.stringify({
          apiName: "TITSPublicApi",
          apiVersion: "1.0",
          messageType: "TITSThrowItemRequest",
          data: { itemName: item, amountOfThrows: amount, delayTime: delay, errorOnMissingID }
        }));

        //logMessage("info", `Sent throwItem request to TITS`, { item, amount, delay, errorOnMissingID });
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot send throwItem request");
      }
      break;
    }

    default:
      logMessage("warn", "Unknown action received", { actionId });
  }
}

// -------------------------
// TITS WEBSOCKET CONNECTION
// -------------------------
function connectToTITS() {
  titsClient = new WebSocket(TITS_WS_URL);

  titsClient.on("open", () => {
    logMessage("info", "Connected to TITS WebSocket");

    // Request item list at startup
    titsClient.send(JSON.stringify({
      apiName: "TITSPublicApi",
      apiVersion: "1.0",
      messageType: "TITSItemListRequest"
    }));
  });

  titsClient.on("message", (data) => {
    try {
      // Convert buffer to string
      let text = data.toString().trim();

      // Some TITS responses are double-encoded JSON, so unwrap once if needed
      if (text.startsWith('"') && text.endsWith('"')) {
        text = text.slice(1, -1).replace(/\\"/g, '"');
      }

      const msg = JSON.parse(text);
      logMessage("debug", "Received from TITS", msg);

      if (msg.messageType === "TITSItemListResponse" && msg.data?.items) {
        cachedItems = msg.data.items;

        fs.writeFileSync("items_list.txt", JSON.stringify(cachedItems, null, 2));
        logMessage("info", `Got ${cachedItems.length} items from TITS`);

        // Update Touch Portal choices immediately
        updateThrowItemChoices(cachedItems);
      }
    } catch (err) {
      logMessage("error", "Failed to parse TITS data", {
        data: data.toString(),
        err: err.message
      });
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
// START PLUGIN
// -------------------------
connectToTouchPortal();
connectToTITS();
logMessage("info", "TITS Plugin started (dynamic mode) and waiting for Touch Portal messages...");
