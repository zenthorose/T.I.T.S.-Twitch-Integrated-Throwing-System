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
  });

  tpClient.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        if (msg.type === "action") {
          handleAction(msg.actionId, msg.data || {});
        }
      } catch (err) {
        logMessage("error", "Failed to parse TP message", {
          err: err.message,
          raw: line
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
// UPDATE THROW ITEM CHOICES
// -------------------------
function updateThrowItemChoices(items) {
  const itemNames = items.map((i) => i.itemName || i.name || i.id);

  sendToTP({
    type: "choiceUpdate",
    id: "item",
    value: itemNames
  });

  logMessage(
    "info",
    `Updated tits.throwItem choices with ${itemNames.length} items`,
    itemNames
  );

  // Create Touch Portal states for each item
  for (const item of items) {
    const stateId = (item.itemName || item.name || item.id || "").replace(/\s+/g, "_");
    const itemId = item.ID || item.id || "";
    if (!stateId || !itemId) continue;

    sendToTP({
      type: "createState",
      id: stateId,
      desc: `${item.itemName || item.name}`,
      defaultValue: itemId,
      forceUpdate: false,
      parentGroup: "Throwables"
    });

    logMessage("info", `Created state for item: ${stateId}`, { defaultValue: itemId });
  }
}

// -------------------------
// ACTION HANDLER
// -------------------------
function handleAction(actionId, data) {
  switch (actionId) {
    case "tits.refreshItems":
      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        titsClient.send(
          JSON.stringify({
            apiName: "TITSPublicApi",
            apiVersion: "1.0",
            messageType: "TITSItemListRequest"
          })
        );
        logMessage("info", "Requested new item list from TITS");
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot refresh items");
      }
      break;

    case "tits.throwItem": {
      const itemName = data.find((d) => d.id === "item")?.value || "";
      const amount = parseInt(data.find((d) => d.id === "amountOfThrows")?.value || "1", 10);
      const delay = parseFloat(data.find((d) => d.id === "delayTime")?.value || "0.05");
      const errorOnMissingID =
        (data.find((d) => d.id === "errorOnMissingID")?.value || "false") === "true";

      logMessage("info", "tits.throwItem triggered", { itemName, amount, delay, errorOnMissingID });

      if (!itemName) {
        logMessage("warn", "No item specified in tits.throwItem payload");
        return;
      }

      const itemObj = cachedItems.find(
        (i) =>
          i.name === itemName ||
          i.itemName === itemName ||
          i.id === itemName ||
          i.ID === itemName
      );

      if (!itemObj) {
        logMessage("warn", "Item not found in cachedItems", { itemName });
        return;
      }

      const itemId = itemObj.ID || itemObj.id || null;
      if (!itemId) {
        logMessage("error", "No valid ID for selected item", { itemObj });
        return;
      }

      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        const throwPayload = {
          apiName: "TITSPublicApi",
          apiVersion: "1.0",
          requestID: Date.now().toString(),
          messageType: "TITSThrowItemsRequest",
          data: {
            items: [itemId],
            delayTime: delay,
            amountOfThrows: amount,
            errorOnMissingID
          }
        };

        titsClient.send(JSON.stringify(throwPayload));
        logMessage("info", "Sent TITSThrowItemsRequest", throwPayload);
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot send throwItem request");
      }
      break;
    }

    case "tits.throwItems": {
      const itemsRaw = data.find((d) => d.id === "items")?.value || "";
      const amount = parseInt(data.find((d) => d.id === "amountOfThrows")?.value || "1", 10);
      const delay = parseFloat(data.find((d) => d.id === "delayTime")?.value || "0.05");
      const errorOnMissingID =
        (data.find((d) => d.id === "errorOnMissingID")?.value || "false") === "true";

      const itemNames = itemsRaw.split(",").map((s) => s.trim()).filter(Boolean);

      logMessage("info", "tits.throwItems triggered", { itemNames, amount, delay, errorOnMissingID });

      if (itemNames.length === 0) {
        logMessage("warn", "No items specified in tits.throwItems payload");
        return;
      }

      const itemIds = [];
      for (const name of itemNames) {
        const itemObj = cachedItems.find(
          (i) => i.name === name || i.itemName === name || i.id === name || i.ID === name
        );

        if (itemObj) {
          const itemId = itemObj.ID || itemObj.id || null;
          if (itemId) itemIds.push(itemId);
        } else {
          logMessage("warn", "Item not found in cachedItems", { name });
        }
      }

      if (itemIds.length === 0) {
        logMessage("error", "No valid item IDs found for tits.throwItems", { itemNames });
        return;
      }

      if (titsClient && titsClient.readyState === WebSocket.OPEN) {
        const throwPayload = {
          apiName: "TITSPublicApi",
          apiVersion: "1.0",
          requestID: Date.now().toString(),
          messageType: "TITSThrowItemsRequest",
          data: {
            items: itemIds,
            delayTime: delay,
            amountOfThrows: amount,
            errorOnMissingID
          }
        };

        titsClient.send(JSON.stringify(throwPayload));
        logMessage("info", "Sent TITSThrowItemsRequest (multiple)", throwPayload);
      } else {
        logMessage("warn", "TITS WebSocket not open, cannot send throwItems request");
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
    titsClient.send(
      JSON.stringify({
        apiName: "TITSPublicApi",
        apiVersion: "1.0",
        messageType: "TITSItemListRequest"
      })
    );
  });

  titsClient.on("message", (data) => {
    try {
      let text = data.toString().trim();

      if (text.startsWith('"') && text.endsWith('"')) {
        text = text.slice(1, -1).replace(/\\"/g, '"');
      }

      const msg = JSON.parse(text);
      logMessage("debug", "Received from TITS", msg);

      if (msg.messageType === "TITSItemListResponse" && msg.data?.items) {
        cachedItems = msg.data.items;

        fs.writeFileSync("items_list.txt", JSON.stringify(cachedItems, null, 2));
        logMessage("info", `Got ${cachedItems.length} items from TITS`);

        // Update Touch Portal with items + states
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
