<div align="center">

# 🎮 Nexus Game Launcher

[![Electron](https://img.shields.io/badge/Framework-Electron-blue?logo=electron&style=for-the-badge)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.9.5-red?style=for-the-badge)](https://github.com/AliAl-ojeely)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Windows](https://img.shields.io/badge/Platform-Windows-blue?logo=windows&style=for-the-badge)](https://github.com/AliAl-ojeely)
[![Linux](https://img.shields.io/badge/Platform-Linux-yellow?logo=linux&style=for-the-badge)](https://github.com/AliAl-ojeely)

<br>

<img src="assets/main-library-en.png" alt="Nexus Game Launcher Main Interface" width="750" style="border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">

<br>

**Nexus Game Launcher** is a sophisticated desktop application built with the **Electron** framework that provides a cinematic, organized, and high-performance interface to manage and launch locally installed PC games.

*Starting from **version 1.6.0**, Nexus officially supports **Linux** through the **Proton compatibility layer**, allowing Windows-exclusive games to run with near-native performance.*

</div>

---

## What's New in `v1.9.5` – The "Total Control" Update

Version `1.9.5` introduces powerful manual controls, a complete visual overhaul of the edit modal, and a fully modular, maintainable codebase.

### Complete Asset Customization

- **Custom Icon Support** – You can now set a custom icon (`.ico`, `.png`, `.jpg`) for each game. The icon is displayed prominently in the game details header.
- **Smart Asset Fallback** – Removing a custom asset (poster, logo, background, or icon) automatically reverts to the best auto‑downloaded version from SteamGridDB or RAWG.
- **Unified Asset Editor** – All four custom asset fields are now grouped together in the edit modal, each with its own **Select** and **Remove** button.

### Drag & Drop Reordering

- **Reorder Mode** – Click the new cross‑arrow button next to the search bar to enter reorder mode. Game cards shake gently to indicate they can be moved.
- **Intuitive Drag & Drop** – Drag any game poster to a new position. The new order is saved automatically to `order.json` (no changes to `games.json`).
- **Reset Button** – While in reorder mode, a reset button appears. Click it to restore the original order (by date added).
- **Persistent Order** – The custom order survives launcher restarts and is applied every time the library is rendered.

### Complete Backup & Restore System

- **One‑Click Backup** – The “Backup Now” button in the game details sidebar creates a ZIP archive of the game’s save folder.
- **Backup History** – All previous backups are listed directly in the sidebar. Each backup has its own **Restore** button.
- **Safe Restore** – Before restoring, a confirmation dialog warns that the current save data will be overwritten and that the game must be closed.
- **Global Backup Vault** – Set a default backup folder in Settings. Per‑game custom paths can override it.

### Technical Overhauls

- **Modular Frontend Code** – The massive `details.js` and `modal.js` files have been split into well‑organized subfolders (`render/details/` and `render/modal/`), each containing focused, single‑responsibility modules.
- **Improved RAWG Matching** – The game matching logic now **requires all significant words** (e.g., “Resident Evil Requiem” will never match “Resident Evil: Village”). Year filtering and strict overlap thresholds ensure accurate results.
- **Steam User Rating Fallback** – When RAWG lacks a Metacritic score, the launcher falls back to the Steam user rating percentage (0–100). The rating display (green/yellow/red) works perfectly with the fallback.
- **Manual Save Path Override** – If auto‑discovery fails, you can now manually select the original save folder using a dedicated browse button in the edit modal.
- **Toast Notifications** – All backup, restore, and error messages now use a themed toast system that adapts to dark, darker, and light modes.
- **CSP Fix for SortableJS** – The Content Security Policy has been updated to allow the SortableJS CDN, enabling smooth drag & drop.

---

## Features Snapshot

### Organize Your Library

Effortlessly manage your collection with dedicated views for your **entire library** and **favorite games**.  
**New:** Drag & drop to reorder your library exactly as you like.

<p align="center">
  <img src="assets/favorites-view.png" alt="Favorites View" width="80%">
</p>

### Game Details View

Immerse yourself in a cinematic game overview with dynamic banners, animated logos, screenshots, trailers, and system requirements – all beautifully laid out.

<p align="center">
  <img src="assets/game-details-cinematic.png" alt="Game Details Cinematic View" width="80%">
</p>

### Full Customization & Localization

Customize the experience with dark/light/darker themes, adjustable grid layouts, and full **Arabic RTL support**.  
**New:** Edit every visual asset (poster, logo, background, icon) – and remove them to revert to auto‑downloaded versions.

<p align="center">
  <img src="assets/settings-page.png" alt="Settings Page" width="48%">
  <img src="assets/main-library-ar.png" alt="Arabic RTL Interface" width="48%">
</p>

---

## Core Features

- **Cross-Platform Execution:** Native support for **Windows** and specialized **Proton support for Linux** systems.
- **Local Library Management:** Add and organize executable files (`.exe`, `.bat`, `.lnk`) effortlessly.
- **Hybrid Asset System:** Retrieve posters, logos, backgrounds, and icons automatically (SteamGridDB + RAWG + Steam) or override them with your own images.
- **Favorites & Search:** Quickly filter your library and pin your most-played games.
- **Smart Launch & Playtime Tracking:** Prevents accidental double‑launches while accurately logging total playtime (localised to H/M or س/د), backed by an intelligent process monitor.
- **Automatic & Manual Backups:** Secure your game saves with one‑click backups and restore any previous backup directly from the launcher.
- **Persistent Local Storage:** A lightweight JSON‑based database keeps all your data (including custom order) entirely local and private.
- **Secure Execution Environment:** Built with Electron IPC communication and context isolation for secure desktop behaviour.

---

## 🐧 Linux Support & Requirements

To ensure Windows games run smoothly on **Linux (Arch / EndeavourOS)**, install the following prerequisites:

### 1. GPU Drivers

**NVIDIA**

```bash
sudo pacman -S lib32-nvidia-utils lib32-vulkan-icd-loader

```

**AMD**

```bash
sudo pacman -S lib32-vulkan-radeon lib32-mesa
```

**Proton GE**

Place your Proton build inside:

```bash
~/Nexus-Proton/GE-Proton10-32/
```

**Audio Support**

```bash
sudo pacman -S lib32-libpulse lib32-pipewire
```

# Running the AppImage (Linux)

If you downloaded the AppImage version:

Method 1 — File Manager

Right-click the file

Open Properties

Enable Allow executing file as program

Method 2 — Terminal

```bash
chmod +x Nexus_Game_Launcher_1.7.0.AppImage./Nexus_Game_Launcher_1.7.0.AppImage
```

---

## Technology Stack

| Component | Technology |
|:---|:---|
| **Runtime** | Electron JS (v41+) |
| **Backend** | Node.js (Child Process, IPC, FS) |
| **Frontend** | HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6 Modules) |
| **Drag & Drop** | SortableJS (CDN) |
| **Modular Architecture** | Custom ES6 Modules (`render/details/`, `render/modal/`) |
| **Compatibility** | Proton GE (Linux) / Native (Windows) / macOS |
| **Data Fetching** | Axios (Steam, RAWG, SteamGridDB, YouTube APIs) |
| **Security & Secrets** | Bundled JSON Secrets (Injected via CI/CD Pipeline) |
| **Persistence** | Local JSON Database (`games.json`, `playTime.json`, `gamesBackSave.json`, `order.json`) |
| **Backup System** | adm‑zip (ZIP compression) |
| **Assets & UI** | Localized FontAwesome 6 & Google Fonts (100% Offline Support) |
| **CI/CD & Build** | GitHub Actions Pipeline → Electron Builder (NSIS, AppImage, DMG) |

# Project Structure

```bash

NEXUS-GAME-LAUNCHER/
├── .github/
├── assets/
│   ├── fonts/
│   ├── fontawesome/
│   ├── favorites-view.png
│   ├── game-details-cinematic.png
│   ├── icon.ico
│   ├── icon.png
│   ├── main-library-ar.png
│   ├── main-library-en.png
│   └── settings-page.png
├── css/
│   ├── components.css
│   ├── backup-ux.css
│   ├── layout.css
│   ├── main.css
│   ├── modals.css
│   ├── pages.css
│   ├── reorder.css
│   └── variables.css
├── dist/
├── modules/
│   ├── app-settings.js       
│   ├── assets.js             
│   ├── backup.js
│   ├── database.js
│   ├── dialogs.js
│   ├── game-launcher.js
│   ├── metadata.js           
│   ├── playtime.js
│   ├── rawg-api.js
│   ├── steam-api.js
│   ├── steamGrid-api.js
│   └── youtube-api.js
├── node_modules/
├── render/
│   ├── details/                     ← modular details page
│   │   ├── index.js
│   │   ├── state.js
│   │   ├── helpers.js
│   │   ├── render.js
│   │   ├── handlers.js
│   │   ├── page.js
│   │   └── init.js
│   ├── modal/                       ← modular edit modal
│   │   ├── index.js
│   │   ├── helpers.js
│   │   ├── backup-status.js
│   │   ├── backup-fields.js
│   │   ├── add-game.js
│   │   ├── edit.js
│   │   └── init.js
│   ├── details.js                   ← re‑export
│   ├── modal.js                     ← re‑export
│   ├── backup-ui.js
│   ├── details-utils.js
│   ├── details-components.js
│   ├── library.js
│   ├── reorder.js
│   ├── render-main.js
│   ├── shortcuts.js
│   ├── state.js
│   └── ui.js
├── src/
│   ├── ipc/                 
│   │   ├── ipc-api.js        
│   │   ├── ipc-backup.js     
│   │   └── ipc-database.js   
│   ├── main.js               
│   ├── preload.js
│   ├── secrets.json
│   └── translation.js
├── .gitignore
├── games.json
├── games.json.example
├── index.html
├── package-lock.json
├── package.json
└── README.md

```

# Installation & Development

Clone the Repository

```bash
git clone https://github.com/AliAl-ojeely/nexus-game-launcher.git
```

Navigate to the Project

```bash
cd nexus-game-launcher
```

Install Dependencies

```bash
npm install
npm install axios
```

Run the Application

```bash
npm start
```

---

# Building for Production

**Windows (.exe)**

```bash
npm run dist-win
```

**Linux (AppImage)**

```bash
npm run dist-linux
```

Compiled files will appear inside the /dist directory.

---

# Developer & Contact

**Ali Nasser Al-ojeely (Mr.Ghost)** *Junior Software Developer | Frontend Specialist*

[![GitHub](https://img.shields.io/badge/GitHub-Profile-181717?logo=github)](https://github.com/AliAl-ojeely)
[![Email](https://img.shields.io/badge/Email-Contact_Me-EA4335?logo=gmail)](mailto:alialojeely@gmail.com)

If you have any suggestions, encounter bugs, or want to contribute, feel free to open an issue or reach out directly!
