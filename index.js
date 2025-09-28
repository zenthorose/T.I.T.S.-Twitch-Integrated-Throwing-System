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

  sendToTP({
    type: "log",
    level,
    message: msg + (data ? " " + JSON.stringify(data) : ""),
  });
}

// -------------------------
// TOUCH PORTAL CONNECTION (DYNAMIC SOCKET)
// -------------------------
function connectToTouchPortal() {
  tpClient = new net.Socket();

  tpClient.connect(TP_PORT, TP_HOST, () => {
    logMessage("info", `Connected to Touch Portal socket on ${TP_HOST}:${TP_PORT}`);

    // Send pairing request
    sendToTP({
      type: "pair",
      id: PLUGIN_ID,
    });
    logMessage("info", "Sent pair request to Touch Portal");
  });

  tpClient.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        logMessage("debug", "Received from TP", msg);

        if (msg.type === "info") {
          logMessage("info", "Pairing successful with Touch Portal", msg);
        }

        if (msg.type === "action") {
          const { actionId } = msg;
          logMessage("info", "Action received from TP", {
            actionId,
            payload: msg.data || null,
          });

          handleAction(actionId, msg.data || {});
        }
      } catch (err) {
        logMessage("error", "Failed to parse TP message", {
          err: err.message,
          raw: line,
        });
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
// ACTION HANDLER
// -------------------------
function handleAction(actionId, data) {
  switch (actionId) {
    case "tits.sayHi":
      logMessage("info", "Hi from tits.sayHi action");
      break;

    case "tits.loadItems":
      try {
        const rawItems = fs.readFileSync("items_list.txt", "utf8");
        const items = JSON.parse(rawItems);
        items
          .map((i) => i.itemName || i.name || i.id)
          .forEach((name) =>
            sendToTP({
              type: "log",
              level: "info",
              message: `Item: ${name}`,
            })
          );
        logMessage("info", `Printed ${items.length} items to Touch Portal`);
      } catch (err) {
        logMessage("error", "Failed to load items from file", {
          err: err.message,
        });
      }
      break;

    case "tits.refreshItems":
      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(
          JSON.stringify({
            apiName: "TITSPublicApi",
            apiVersion: "1.0",
            messageType: "TITSItemListRequest",
          })
        );
        logMessage("info", "Requested new item list from TITS");
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot refresh items");
      }
      break;

    case "tits.getMessages":
      logMessage("info", "tits.getMessages action triggered (placeholder)");
      break;

    case "tits.throwItem":
      logMessage("info", "tits.throwItem action triggered (placeholder)");
      break;

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
    titsClient.send(
      JSON.stringify({
        apiName: "TITSPublicApi",
        apiVersion: "1.0",
        messageType: "TITSItemListRequest",
      })
    );
  });

  titsClient.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      logMessage("debug", "Received from TITS", msg);

      if (msg.messageType === "TITSItemListResponse" && msg.data?.items) {
        logMessage("info", `Got ${msg.data.items.length} items from TITS`);
        fs.writeFileSync(
          "items_list.txt",
          JSON.stringify(msg.data.items, null, 2)
        );
      }
    } catch (err) {
      logMessage("error", "Failed to parse TITS data", {
        data: data.toString(),
        err: err.message,
      });
    }
  });

  titsClient.on("close", () => {
    logMessage("warn", "Disconnected from TITS, retrying in 5s...");
    setTimeout(connectToTITS, 5000);
  });

  titsClient.on("error", (err) =>
    logMessage("error", "TITS WebSocket error", { err: err.message })
  );
}

// -------------------------
// HEARTBEAT / PING
// -------------------------
setInterval(() => {
  logMessage("info", "Heartbeat: plugin alive and waiting for actions...");
}, 10000);

// -------------------------
// START PLUGIN
// -------------------------
connectToTouchPortal();
connectToTITS();
logMessage("info", "TITS Plugin started (dynamic mode) and waiting for Touch Portal messages...");
