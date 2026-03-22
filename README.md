<div align="center">

# Nexus Game Launcher

[![Electron](https://img.shields.io/badge/Framework-Electron-blue?logo=electron&style=for-the-badge)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.7.5-red?style=for-the-badge)](https://github.com/AliAl-ojeely)
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

## What's New in `v1.7.5` - The "Creative Freedom" Update

Version `1.7.5` is a major milestone. We’ve moved beyond automated fetching to give you absolute control over your library's visual identity, backed by a highly optimized, modular codebase and advanced smart-search algorithms.

### Personalization & Asset Management

- **Custom Graphics Trio:** Manually set a **Custom Poster**, **Custom Logo**, and **Custom Background** for every game. Perfect for rare titles or high-quality fan art.
- **Smart Reset System (API Fallback) :** Each asset field features a "Remove" (X) button. Deleting a custom path intelligently triggers a fresh API request to find the best official assets.
- **Dynamic UI:** Redesigned "Edit Game" modal with a custom unified scrollbar to house all new options comfortably.

### Technical & Architectural Overhaul

- **Advanced Dual-API Engine :** - **Steam & RAWG Synergy:** Intelligently routes searches using either **Steam AppIDs** or **Release Years** to fetch exact versions of games (e.g., distinguishing between *Resident Evil 4 2005* and *Resident Evil 4 2023*).
  - **SteamGridDB API:** Seamlessly pulls high-fidelity transparent logos and vertical posters.
- **Optimized Data Structure:** Removed heavy, unused data properties (like trailer links) to keep the `games.json` database incredibly fast and lightweight.
- **Decoupled Localization (i18n):** All text strings are isolated into a dedicated `translation.js` file, supporting instant switches between **Arabic** and **English**.

---

## Features Snapshot

### Organize Your Library

Effortlessly manage your collection with dedicated views for your **entire library** and **favorite games**.

<div align="center">
  <img src="assets/favorites-view.png" alt="Favorites View" width="600" style="border-radius: 8px;">
</div>

### Full Customization & Localization

Customize the experience with dark/light themes, adjustable grid layouts, and full **Arabic RTL support**.

<div align="center" style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin-top: 15px;">
  <img src="assets/settings-page.png" alt="Settings Page" width="600" style="border-radius: 8px;">
  <br>

---
  
  <img src="assets/main-library-ar.png" alt="Arabic RTL Interface" width="600" style="border-radius: 8px;">
</div>

---

## Core Features

- **Cross-Platform Execution:** Native support for **Windows** and specialized **Proton support for Linux** systems.
- **Local Library Management:** Add and organize executable files (`.exe`, `.bat`, `.lnk`) effortlessly.
- **Hybrid Cover System:** Retrieve covers automatically or manually select custom assets.
- **Favorites & Search:** Quickly filter your library and pin your most-played games.
- **Smart Launch Protection:** The "Play" button updates to a "Running" state to prevent accidental double-launches.
- **Persistent Local Storage:** Lightweight JSON-based database keeps all data entirely local and private.
- **Secure Execution Environment:** Built with Electron IPC communication and context isolation for secure desktop behavior.

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
| **Backend** | Node.js (Child Process, IPC) |
| **Frontend** | HTML5, CSS3 (Flexbox / Grid), JavaScript (ES6 Modules) |
| **Compatibility** | Proton GE (Linux) / Native (Windows) / macOS |
| **Data Fetching** | Axios (Steam, RAWG, SteamGridDB APIs) |
| **Environment** | Dotenv (Secure API Key Management) |
| **Persistence** | Local JSON Database |
| **Icons** | FontAwesome 6 |
| **Installer & Build** | Electron Builder (NSIS, AppImage, DMG) - Supports x64 & ARM64 |

# Project Structure

```bash

NEXUS-GAME-LAUNCHER/
├── .github/
├── assets/
│   ├── favorites-view.png
│   ├── game-details-cinematic.png
│   ├── icon.ico
│   ├── icon.png
│   ├── main-library-ar.png
│   ├── main-library-en.png
│   └── settings-page.png
├── css/
│   ├── components.css
│   ├── layout.css
│   ├── main.css
│   ├── modals.css
│   ├── pages.css
│   └── variables.css
├── dist/
├── modules/
│   ├── database.js
│   ├── dialogs.js
│   ├── game-launcher.js
│   ├── rawg-api.js
│   ├── steam-api.js
│   └── steamGrid-api.js
├── node_modules/
├── Render/
│   ├── details.js
│   ├── library.js
│   ├── modal.js
│   ├── render-main.js
│   ├── shortcuts.js
│   ├── state.js
│   └── ui.js
├── src/
│   ├── main.js
│   ├── render.js
│   ├── preload.js
│   └── translation.js
├── .env
├── .env.example
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
npm install axios dotenv
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
