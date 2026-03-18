# Nexus Game Launcher `v1.7.0`

[![Electron](https://img.shields.io/badge/Framework-Electron-blue?logo=electron)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.7.0-red)](https://github.com/AliAl-ojeely)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue?logo=windows)](https://github.com/AliAl-ojeely)
[![Linux](https://img.shields.io/badge/Platform-Linux-yellow?logo=linux)](https://github.com/AliAl-ojeely)

<br>

<p align="center">
  <img src="assets/main-library-en.png" alt="Nexus Game Launcher Main Interface" width="650">
</p>

<br>

**Nexus Game Launcher** is a sophisticated desktop application built with the **Electron** framework that provides a cinematic, organized, and high-performance interface to manage and launch locally installed PC games.

Starting from **version 1.6.0**, Nexus officially supports **Linux** through the **Proton compatibility layer**, allowing Windows-exclusive games to run with near native performance.

The launcher bridges the gap between **local game files** and the **Steam Store ecosystem**, automatically retrieving rich metadata such as descriptions, screenshots, trailers, and developer information.

---

# 🚀 What's New in `v1.7.0` - The "Creative Freedom" Update

Version `1.7.0` is a major milestone for **Nexus Game Launcher**. We’ve moved beyond automated fetching to give you absolute control over your library's visual identity, backed by a more robust and modular codebase.

<p align="center">
  <img src="assets/main-library-en.png" alt="Nexus Launcher v1.7.0" width="750">
</p>

---

### 🎨 NEW: Personalization & Asset Management
The highlight of this update is the **Advanced Assets Control Panel**, allowing you to curate every game's look manually:

- **Custom Graphics Trio:** You can now manually set a **Custom Poster**, **Custom Logo**, and **Custom Background** for every game. Perfect for rare titles or high-quality fan art.
- **Smart Reset System (API Fallback) 🔄:** Each asset field now features a "Remove" (X) button. If you delete a custom path, the launcher intelligently triggers a fresh API request to find the best official assets automatically.
- **Dynamic Previews:** The "Edit Game" modal has been redesigned with a custom-styled scrollbar to house all these new options comfortably.

### 🌐 Technical & Architectural Overhaul
- **Dual-API Engine 🛠️:** We've integrated a sophisticated dual-fetching system:
  - **SteamGridDB API:** Specifically for high-fidelity transparent logos and vertical posters.
  - **RAWG API:** For rich metadata, including descriptions, developer info, and cinematic backgrounds.
- **Decoupled Localization (i18n):** All text strings are now separated into a dedicated `translations.js` file. This cleaner architecture supports easy switching between **Arabic** and **English** and paves the way for future languages.
- **Intelligent Save Logic:** Improved state management ensures that any manual changes are prioritized over API data, while empty fields trigger auto-fetch sequences.

---

### 📂 Core Features (From Previous Versions)

- **Linux & Proton Integration 🐧:** Full support for launching Windows executables (`.exe`) on Linux systems using the **Proton compatibility layer**.
- **Smart Launch Protection 🚀:** The "Play" button intelligently updates to a "Running" state to prevent accidental double-launches and provide clear feedback.
- **Interactive Media Hub 🎬:** Built-in **video trailer player** and a high-resolution **Image Lightbox / Slideshow** for game screenshots.
- **Quick Directory Access 📂:** A dedicated "Game Folder" button to instantly open local installation directories.
- **Developer Info Modal ℹ️:** Interactive "About Developer" window with floating animations and external social links.

---

### 🛠️ UI/UX Refinements
- **Custom Modal Scrollbars:** Unified the scrollbar design across the entire app, ensuring the "Game Details" modal remains accessible on all screen resolutions.
- **Enhanced Visual Hierarchy:** Improved padding and spacing in the edit modal for a more "Premium" feel.
- **Responsive Animations:** Refined the fade-in and hover effects for game cards and action buttons.

---

# Features Snapshot

Explore the core organization and customization features available in the launcher.

---

## Organize Your Library

Effortlessly manage your collection with dedicated views for your **entire library** and **favorite games**.

<p align="center">
  <img src="assets/favorites-view.png" alt="Favorites View" width="550">
</p>

---

## Full Customization & Localization

Customize the experience with theme settings, adjustable layouts, and full **Arabic RTL support**.

<br>

<p align="center" style="display:flex; justify-content:center; gap:15px; flex-wrap:wrap;">
  <img src="assets/settings-page.png" alt="Settings Page" width="48%" style="max-width:380px;">
  <img src="assets/main-library-ar.png" alt="Arabic RTL Interface" width="48%" style="max-width:380px;">
</p>

<br>

---

# Core Features

- **Cross-Platform Execution**  
  Native support for **Windows** and specialized **Proton support for Linux** systems.

- **Local Library Management**  
  Add and organize executable files (`.exe`, `.bat`, `.lnk`) from your system.

- **Hybrid Cover System**  
  Retrieve covers automatically from the **Steam Store** or manually select custom posters.

- **Favorites & Search**  
  Quickly filter your library and pin your most-played games.

- **Customizable UI**  
  Supports **Dark / Light themes**, adjustable grid sizes, and bilingual interface (**Arabic / English**).

- **Performance HUD**  
  Optional built-in **FPS counter** and performance overlay for real-time monitoring.

- **Persistent Local Storage**  
  Lightweight **JSON-based database** keeps all data stored locally on the user's machine.

- **Secure Execution Environment**  
  Uses **Electron IPC communication** and **context isolation** for safe desktop application behavior.

---

# 🐧 Linux Support & Requirements

To ensure Windows games run smoothly on **Linux (Arch / EndeavourOS)**, install the following prerequisites.

### GPU Drivers

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

# Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Electron JS |
| Backend | Node.js (Child Process, IPC) |
| Frontend | HTML5, CSS3 (Flexbox / Grid), JavaScript (ES6+) |
| Compatibility | Proton GE (Linux) / Native (Windows) |
| Data Fetching | Axios (Steam Web API Integration) |
| Persistence | Local JSON Database |
| Icons | FontAwesome 6 |
| Installer | Electron Builder (NSIS / AppImage) |
---

# Project Structure

```bash

NEXUS-GAME-LAUNCHER/
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
│   └── steam-api.js
│   └── steamGrid-api.js
│   └── rawg-api-api.js
├── node_modules/
├── src/
│   ├── main.js
│   ├── preload.js
│   └── renderer.js
│   └── translation.js
├── .gitignore
├── games.json
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