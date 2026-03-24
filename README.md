<div align="center">

# Nexus Game Launcher

[![Electron](https://img.shields.io/badge/Framework-Electron-blue?logo=electron&style=for-the-badge)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.8.0-red?style=for-the-badge)](https://github.com/AliAl-ojeely)
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

## What's New in `v1.8.0` - The "Creative Freedom" Update

Version `1.8.0` is a major milestone. We’ve moved beyond automated fetching to give you absolute control over your library's visual identity, backed by a highly optimized, modular codebase, advanced smart-search algorithms, and robust tracking.

### Personalization & Asset Management

- **Custom Graphics Trio:** Manually set a **Custom Poster**, **Custom Logo**, and **Custom Background** for every game. Perfect for rare titles or high-quality fan art.
- **Smart Reset System (API Fallback):** Each asset field features a "Remove" (X) button. Deleting a custom path intelligently triggers a fresh API request to find the best official assets.
- **Dynamic UI:** A redesigned "Edit Game" modal with a custom unified scrollbar comfortably houses all the new options.
- **"Pitch Black" Darker Theme:** Introduced a new OLED-friendly "Darker" theme alongside the standard Light and Dark modes.

### Advanced Playtime Tracking & UX Enhancements

- **Smart Hybrid Process Monitor:** A custom-built tracking engine (Radar + Sniper approach) that intelligently differentiates between intermediary game launchers (like Rockstar/EA apps) and actual game executables. It ensures pinpoint accurate playtime logging and instantly stops the timer upon unexpected exits (`Alt+F4`).
- **True Offline Capability:** All critical UI assets (Cairo & Poppins fonts, FontAwesome icons) are now bundled locally. The launcher maintains its premium cinematic look even without an active internet connection.
- **Smart Conditional UI:** The interface intelligently hides missing metadata (like empty Metacritic scores or tags) for a cleaner, clutter-free sidebar.

### Technical & Architectural Overhaul

- **Advanced Dual-API Engine:** - **Steam & RAWG Synergy:** Intelligently routes searches using either **Steam AppIDs** or **Release Years** to fetch exact versions of games (e.g., distinguishing between *Resident Evil 4 2005* and *Resident Evil 4 2023*).
  - **SteamGridDB API:** Seamlessly pulls high-fidelity transparent logos and vertical posters.
- **Optimized Data Structure:** Removed heavy, unused data properties to keep the `games.json` database incredibly fast and lightweight.
- **Decoupled Localization (i18n):** All text strings are isolated into a dedicated `translations.js` file, supporting instant switches between **Arabic** and **English**.

---

## Features Snapshot

### Organize Your Library

Effortlessly manage your collection with dedicated views for your **entire library** and **favorite games**.

<p align="center">
  <img src="assets/favorites-view.png" alt="Favorites View" width="80%">
</p>

### Full Customization & Localization

Customize the experience with dark/light themes, adjustable grid layouts, and full **Arabic RTL support**.

<p align="center">
  <img src="assets/settings-page.png" alt="Settings Page" width="48%">
  <img src="assets/main-library-ar.png" alt="Arabic RTL Interface" width="48%">
</p>

---

## Core Features

- **Cross-Platform Execution:** Native support for **Windows** and specialized **Proton support for Linux** systems.
- **Local Library Management:** Add and organize executable files (`.exe`, `.bat`, `.lnk`) effortlessly.
- **Hybrid Cover System:** Retrieve covers automatically or manually select custom assets.
- **Favorites & Search:** Quickly filter your library and pin your most-played games.
- **Smart Launch & Playtime Tracking:** Prevents accidental double-launches while accurately logging total playtime (localized to H/M or س/د), backed by an intelligent process monitor.
- **Persistent Local Storage:** A lightweight JSON-based database keeps all your data entirely local and private.
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
| **Backend** | Node.js (Child Process, IPC, FS) |
| **Frontend** | HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6 Modules) |
| **Compatibility** | Proton GE (Linux) / Native (Windows) / macOS |
| **Data Fetching** | Axios (Steam, RAWG, SteamGridDB APIs) |
| **Security & Secrets** | Bundled JSON Secrets (Injected via CI/CD Pipeline) |
| **Persistence** | Local JSON Database (Games & Playtime) |
| **Assets & UI** | Localized FontAwesome 6 & Google Fonts (100% Offline Support) |
| **CI/CD & Build** | GitHub Actions Pipeline -> Electron Builder (NSIS, AppImage, DMG) |

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
│   └── playtime.js
│   ├── rawg-api.js
│   ├── steam-api.js
│   └── steamGrid-api.js
├── node_modules/
├── render/
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
│   └── secrets.json
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
