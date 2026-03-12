# Nexus Game Launcher `v1.6.0`

[![Electron](https://img.shields.io/badge/Framework-Electron-blue?logo=electron)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.6.0-red)](https://github.com/AliAl-ojeely)
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

# What's New in `v1.6.0`

The **Game Details experience** has been completely redesigned to deliver a more immersive and cinematic interface, alongside a major step forward with **Linux compatibility**.

<p align="center">
  <img src="assets/game-details-cinematic.png" alt="Cinematic Game Details View" width="650">
</p>

### Major Improvements

- **Linux & Proton Integration 🐧**  
  Full support for launching Windows executables (`.exe`) on Linux using the **Proton compatibility layer**.

- **Cinematic Hero Banners**  
  Dynamic background rendering in the game details page with medium-opacity overlays for a premium visual experience.

- **Enhanced Steam Integration**  
  Automatically fetches game metadata including **description, developer, publisher, release date, and system requirements**.

- **Interactive Media Hub**  
  Built-in **video trailer player** with a custom **Image Lightbox / Slideshow** for high-resolution screenshots.

- **Developer Info Modal**  
  Interactive **"About Developer"** window with floating animations and external social links.

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
chmod +x Nexus_Game_Launcher_1.6.0.AppImage./Nexus_Game_Launcher_1.6.0.AppImage
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

# Installation & Development
Clone the Repository
```bash
git clone https://github.com/AliAl-ojeely/mygamelauncher.git
```
Navigate to the Project
```bash
cd mygamelauncher
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
npm run dist
```
**Linux (AppImage)**
```bash
npm run dist-linux
```
Compiled files will appear inside the /dist directory.

---
# Developer
---

Ali Nasser Al-ojeely
Junior Software Developer | Frontend Specialist

---

# Email
alialojeely@gmail.com

---

# GitHub
@AliAl-ojeely
