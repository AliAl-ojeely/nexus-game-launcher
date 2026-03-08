# Nexus Game Launcher

**Nexus Game Launcher** is a desktop application built with the **Electron** framework, designed to provide a clean and organized way to manage and launch locally installed PC games from a single interface.

---

## Features

- **Local Game Library Management**  
  Add and organize executable files (`.exe`, `.bat`, `.lnk`) into a personal game library.

- **Automatic Cover Retrieval**  
  Fetch game cover images directly from the Steam Store using the Steam Search API.

- **Manual Cover Selection**  
  Assign custom cover images from your local system.

- **Favorites System**  
  Quickly access your preferred games.

- **Search Functionality**  
  Filter and locate games within your library efficiently.

- **Customizable Interface**  
  Supports dark and light themes, adjustable grid size for game cards, and multi-language interface (Arabic & English).

- **Persistent Local Storage**  
  All game data is saved locally in a JSON database.

- **Secure Electron Setup**  
  Uses context isolation and preload scripts to ensure security.

- **Lightweight and Reliable**  
  No external services required; fully functional offline.

---

## Benefits

- Simplifies game management with a modern, visually organized interface.
- Fully customizable to match user preferences.
- Modular and extendable architecture for future enhancements, including:
  - Automatic game detection
  - Expanded metadata support
  - Cloud synchronization
  - Integration with other gaming platforms

---

## Technology Stack

```text
- Electron – Desktop application framework
- HTML/CSS/JavaScript – UI and core functionality
- Local JSON Database – Persistent storage of game data
- Steam Store API – Automatic cover image retrieval
