

# Nexus Game Launcher `v1.5.0`

[![Electron](https://img.shields.io/badge/Framework-Electron-blue?logo=electron)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.5.0-red)](https://github.com/AliAl-ojeely)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue?logo=windows)](https://github.com/AliAl-ojeely)

**Nexus Game Launcher** is a sophisticated desktop application built with the **Electron** framework. It provides a cinematic, organized, and high-performance interface to manage and launch locally installed PC games, bridging the gap between your local files and the **Steam Store** ecosystem.

---

## What's New in v1.5.0

- **Cinematic Hero Banners:** Dynamic background rendering in the game details page with medium-opacity overlays for a premium look.
- **Enhanced Steam Integration:** Automatically fetches game metadata including descriptions, developers, publishers, and release dates.
- **Interactive Media Hub:** Integrated video trailer support and a custom **Image Lightbox/Slideshow** for high-res screenshots.
- **System Requirements Module:** Displays minimum and recommended PC requirements directly from the Steam database.
- **Developer Info Modal:** A brand-new interactive "About Developer" section triggered by clicking the app logo, featuring floating animations and external social links.

---

## Features

- **Local Library Management:** Seamlessly add and organize executables (`.exe`, `.bat`, `.lnk`).
- **Hybrid Cover System:** Choose between automatic Steam API retrieval or manual custom poster selection.
- **Favorites & Search:** Efficiently filter and pin your most-played titles for instant access.
- **Customizable UI:** Supports Dark/Light modes, adjustable grid sizes, and a bi-lingual interface (Arabic & English).
- **Persistent Storage:** Lightweight JSON-based local database ensuring all your data stays private and on your machine.
- **Safe Execution:** Robust IPC communication and context isolation for a secure desktop environment.

---

## Technology Stack

| Component | Technology |
| :--- | :--- |
| **Runtime** | [Electron JS](https://www.electronjs.org/) |
| **Frontend** | HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6+) |
| **Icons** | FontAwesome 6 |
| **Data Fetching** | Axios (Steam Web API Integration) |
| **Persistence** | Local JSON Database |
| **Installer** | Electron-Builder (NSIS) |

---

## Installation & Development

To get a local copy up and running, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/AliAl-ojeely/mygamelauncher.git](https://github.com/AliAl-ojeely/mygamelauncher.git)

```

2. **Navigate to the directory:**
```bash
cd mygamelauncher

```


3. **Install dependencies:**
```bash
npm install

```


4. **Run the application:**
```bash
npm start

```



---

## 🏗 Building the Installer

To generate a production-ready `.exe` installer for Windows:

```bash
npm run dist

```

The output will be located in the `/dist` folder.

---

## Developer

**Ali Nasser Al-ojeely (Mr.Ghost)** Junior Software Developer | Frontend Specialist

* **Email:** [alialojeely@gmail.com](mailto:alialojeely@gmail.com)
* **GitHub:** [@AliAl-ojeely](https://github.com/AliAl-ojeely)

---

## License

Distributed under the **MIT License**. See `LICENSE` for more information.

```

---

### Why this is better for your GitHub:
* **Visual Appeal:** The badges at the top make the project look "Official."
* **Clear Value Proposition:** It clearly explains that the app uses **Steam API**, which is a high-level skill for a junior developer to showcase.
* **v1.5.0 Focus:** Highlighting the new features (Banners, Slideshow, Dev Modal) proves you are actively maintaining the project.
* **Technical Sections:** The "Technology Stack" and "Installation" sections are exactly what recruiters look for in a portfolio.

---

```
