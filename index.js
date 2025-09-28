#!/usr/bin/env node

// -------------------------
// IMPORTS
// -------------------------
const fs = require("fs");
const WebSocket = require("ws");

// -------------------------
// PLUGIN INFO
// -------------------------
const PLUGIN_ID = "tits.connector";
const LOG_FILE = "plugin-debug.log";
const TITS_WS_URL = "ws://127.0.0.1:42069/websocket";

let titsClient = null;

// -------------------------
// LOGGING HELPER
// -------------------------
function logMessage(level, msg, data = null) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${msg} ${
    data ? JSON.stringify(data) : ""
  }`;

  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}

  // also send log to TP
  sendToTP({
    type: "log",
    level,
    message: msg + (data ? " " + JSON.stringify(data) : ""),
  });
}

// -------------------------
// TOUCH PORTAL CONNECTION (STDIN/STDOUT)
// -------------------------
function sendToTP(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (err) {
    console.error("Failed to send to TP", err.message);
  }
}

process.stdin.on("data", (chunk) => {
  const lines = chunk.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      logMessage("debug", "Received from TP", msg);

      if (msg.type === "info") {
        // Send plugin info back after pairing
        sendToTP({
          type: "plugin_info",
          pluginId: PLUGIN_ID,
          version: "0.0.1",
          sdk: 6,
        });
        logMessage("info", "Sent plugin_info back to TP");
      }

      if (msg.type === "action") {
        const { actionId } = msg;
        logMessage("info", "Action received from TP", {
          actionId,
          payload: msg.data || null,
        });

        switch (actionId) {
          case "tits.sayHi":
            logMessage("info", "Hi"); // <--- our simple test
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
    } catch (err) {
      logMessage("error", "Failed to parse TP message", {
        err: err.message,
        raw: line,
      });
    }
  }
});

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

  titsClient.on("close", () => logMessage("warn", "Disconnected from TITS"));
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
connectToTITS();
logMessage(
  "info",
  "TITS Plugin started and waiting for Touch Portal messages..."
);
