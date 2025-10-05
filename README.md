# T.I.T.S. (Twitch Integrated Throwing System) Connector Plugin for Touch Portal

## Table of Contents
- [Description](#description)
- [Features](#features)
  - [Dynamic Item Management](#dynamic-item-management)
  - [Dynamic Trigger Management](#dynamic-trigger-management)
  - [Throw Items Action](#throw-item)
  - [Trigger Activation](#trigger-throw)
  - [Logging](#logs)
- [Installation](#installation)
- [Actions](#actions)
  - [Refresh Plugin](#refresh-plugin)
  - [Throw Item](#throw-item)
  - [Throw Items](#throw-items)
  - [Trigger Throw](#trigger-throw)
- [Configuration](#configuration)
- [Requirements](#requirements)
- [Logs](#logs)
- [Contributing](#contributing)
- [License](#license)

---

## Description
The **T.I.T.S. Connector** is a Touch Portal plugin that integrates with **TITS (Twitch Integrated Throwing System)**, allowing you to dynamically manage items and triggers from your Touch Portal.  
This plugin is perfect for 2D Vtubers looking to automate interactions and enhance their audience engagement using TITS and Touch Portal.

---

## Features

### Dynamic Item Management
Automatically updates item lists and generates corresponding Touch Portal states.

### Dynamic Trigger Management
Automatically updates trigger lists and creates corresponding states.

### Throw Items Action
Throw single or multiple items with configurable delay and amount.

### Trigger Activation
Activate T.I.T.S. triggers directly from Touch Portal.

### Logging
Togglable comprehensive logging of actions, updates, and errors for easy debugging.

---

## Installation

1. Download the latest release `.tpp` file from this repository.
2. Open Touch Portal.
3. Go to **Quick Actions → Import-plugin → Select the download location** and select the `.tpp`.
4. The plugin will automatically connect to Touch Portal and T.I.T.S. on launch.
5. Ensure T.I.T.S. is running and that you have turned on its API and it is on its default port.

---

## Updating

1. Download the latest release `.tpp` file from this repository.
2. Open Touch Portal.
3. Go to **Settings → Left side list scroll down till you see Plug-ins → Find "TITS Plugin" and delete it → Restart Touch Portal.
4. Go to **Quick Actions → Import-plugin → Select the download location** and select the `.tpp`.
5. The plugin will automatically connect to Touch Portal and T.I.T.S. on launch.
6. Ensure T.I.T.S. is running and that you have turned on its API and it is on its default port unless you have changed the default port on T.I.T.S. in which case you must edit it in the plugin settings.

---

## Actions

### Refresh Plugin
- Requests a fresh list of items and triggers from TITS.
- Updates choice lists and states in Touch Portal.

### Throw Item
- **Item**: Select a single item from your TITS inventory.
- **Amount of Throws**: Number of times to throw the item.
- **Delay Time**: Delay between throws in seconds (e.g., 0.05 for 1/20th of a second).
- **Error on Missing ID**: Whether to throw an error if the item is missing.

### Throw Items
- **Items**: Comma-separated list of item names.
- **Amount of Throws**: Number of times to throw each item.
- **Delay Time**: Delay between throws in seconds.
- **Error on Missing ID**: Whether to throw an error if any items are missing.

### Trigger Throw
- **Trigger**: Select a trigger from T.I.T.S.
- **Error on Missing ID**: Whether to throw an error if the trigger is missing.

---

## Configuration

- **WebSocket URL for TITS**: `ws://127.0.0.1:42069/websocket`
- **Touch Portal Host**: `127.0.0.1`
- **Touch Portal Port**: `12136`

---

## Requirements

- [Touch Portal](https://www.touch-portal.com/) installed and running.
- [T.I.T.S.](https://remasuri3.itch.io/tits) running locally and accessible via WebSocket.

---

## Logs

All logs are toggleable and stored in `plugin-debug.log` in the same directory as the plugin. Logs include:

- Info messages for successful actions and updates.
- Warnings for disconnected WebSocket connections.
- Errors for missing items, triggers, or failed operations.

---

## Bugs and Enhancements

- Report bugs via [Touch Portal T.I.T.S. Issues](https://github.com/zenthorose/T.I.T.S.-Twitch-Integrated-Throwing-System/issues) or in the Official Touch Portal Twitch-Integrated-Throwing-System channel!

---

## Author

- [Zenthorose](https://github.com/zenthorose) - Initial work

---

## License

This project is licensed under the GPL 3.0 License - see the [LICENSE](https://github.com/zenthorose/Touch-Portal-T.I.T.S.-Twitch-Integrated-Throwing-System/blob/main/LICENSE) file for details
