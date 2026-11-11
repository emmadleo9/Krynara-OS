<div align="center">

<img src="./console/public/krynara-official.png" alt="Krynara-OS official logo" width="240" />

<img src="https://readme-typing-svg.demolab.com?font=Share+Tech+Mono&size=24&pause=1000&color=8AF8FF&center=true&width=600&lines=Krynara-OS+%2F%2F+PERSONAL+OS+THAT+GROWS+WITH+YOU;Local-first+AI+OS;One+OS+to+control+all+devices" alt="Krynara-OS // PERSONAL OS THAT GROWS WITH YOU — Local-first AI OS — One OS to control all devices" />

<h1>Krynara-OS</h1>

<p><b>One OS to control WhatsApp, Instagram, Telegram, Discord — all devices.</b></p>
<p><i>Local-first AI operating system — the personal OS that grows with you.</i></p>

<p>
  <img src="https://img.shields.io/badge/license-MIT-00C853?style=for-the-badge" alt="License: MIT" />
  <img src="https://img.shields.io/badge/core-OpenJarvis-2962FF?style=for-the-badge" alt="Core: OpenJarvis" />
  <img src="https://img.shields.io/badge/gateway-OpenWA-546E7A?style=for-the-badge" alt="Gateway: OpenWA" />
  <img src="https://img.shields.io/badge/console-KRYNARA-212121?style=for-the-badge" alt="Console: KRYNARA" />
  <img src="https://img.shields.io/badge/model-local--LLM-AA00FF?style=for-the-badge" alt="Model: local LLM (Ollama)" />
  <img src="https://img.shields.io/badge/hud-v4.0.1.16-8AF8FF?style=for-the-badge" alt="HUD: v4.0.1.16" />
  <img src="https://img.shields.io/badge/offline--first-212121?style=for-the-badge" alt="Offline-first" />
  <img src="https://img.shields.io/badge/status-ONLINE-00C853?style=for-the-badge" alt="Status: ONLINE" />
</p>

</div>

---

## ⚡ What is Krynara-OS?

Krynara-OS is a **local-first AI operating system** that turns a modest machine into a tactical command console: messaging across WhatsApp, Telegram, Instagram and Discord, a live OSINT world map, and a self-hosted AI core — all running on your own hardware, no cloud required.

| ⚡ Feature | 🛡️ Capability |
|-----------|---------------|
| 🧠 **Core (OpenJarvis)** | Local AI framework with 5 primitives — Intelligence, Engine, Agents, Tools, Memory. Serves a local LLM (`qwen2.5:3b` via Ollama). |
| 📡 **Gateway (OpenWA)** | WhatsApp API gateway — REST API + dashboard, multi-session, SQLite mode, QR pairing, local telemetry and feed proxies. |
| 🖥️ **Console (KRYNARA)** | Dark OLED HUD (`#050A0E` / cyan `#8AF8FF`), glassmasonry panels, animated tactical UI. System Monitor v4.0.1.16. |
| 🌍 **World View** | Searchable 2D / 3D / satellite map with saved layers, GeoJSON drawing/export, OSRM driving directions, terrain relief, public GTFS-RT transit in supported regions, Open-Meteo wind vectors, NOAA satellite cloud and water-vapor imagery, RainViewer radar frames, solar day/night shading, 3D buildings, and live ADS-B, USGS, satellite, NASA fire, GDELT, weather and NOAA weather-alert overlays. |
| 💬 **Social Hub** | **KRYNARA WhatsApp** embedded — scan a QR, chat in the HUD. Plus Telegram / Instagram / Discord connectors. |
| 🏹 **Swarm Cursor Engine** | **Joel Califa-inspired multiplayer fleet & "Shooting Stars Swarm"**: Arrow agents dynamically fly in from the top-right, construct DOM components with procedural E-pentatonic glass audio, spin in a circular orbit, lock vectors to top-right, and vanish. Features real-time 0.7s component activation, color themes (Cyan, Matrix, Amber, Multi, Monochrome), and custom stardust trails. |
| 🗞️ **News & Conflict** | GDELT global events with country search, recommendations and a live mini-map. |
| 🔋 **Memory** | Persistent everywhere — IndexedDB in the console, SQLite in the gateway. Sessions survive restarts. |
| ✈️ **Offline-first** | Feeds degrade gracefully; the console keeps running without internet. |

### KRYNARA WhatsApp

The WhatsApp panel uses the linked WhatsApp session and local KRYNARA SQLite/media storage. It supports chat and message search, direct/group/channel filters, text replies, forwarding, reactions and deletion, attachment sending and downloads, group creation, typing indicators, and WhatsApp voice/video call links. Uploads are streamed to disk and support files up to 2 GB.

Direct WhatsApp voice/video calling and Status-story creation are not exposed by the current linked-device adapter; call links can be generated and shared instead. Availability of synced history and media depends on what WhatsApp provides to the linked session.

### AI Studio

AI Studio keeps its local Ollama models available and adds optional NVIDIA NIM, Groq, and OpenRouter chat models. The **FREE-SEARCH // TAVILY + LLAMA - Perplexity Clone 🌐 FREE** option searches Tavily and summarizes results with NVIDIA. Add keys through **AI Studio → API KEYS** or configure server-side variables in the repository-root `.env.local`, `.env`, or `gateway/.env.local`: `NVIDIA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, and `TAVILY_API_KEY`. Use [.env.local.example](./.env.local.example) as the template for a root `.env.local`. Browser-entered keys stay in that browser's local storage and provider requests go through the local gateway. Do not use `VITE_`-prefixed provider secrets because Vite embeds those values in browser bundles. If NVIDIA's account inference route is unavailable, AI Studio falls back to local Ollama; Tavily search still returns the retrieved answer or source text.

### 🏹 Swarm Rebuild Engine (v4.0.1.16)

Krynara-OS incorporates a high-performance **Multiplayer Rebuild Swarm** inspired by Joel Califa's cursor experiments, fully wired across all console components and views:
- **Shooting Stars Swarm & Crystal Star Head**: Features a 4-point faceted crystalline star geometry with trailing stardust comet trails (`--swarm-theme-chip`) adapting to all color palettes (Cyan OLED, Matrix Emerald, Amber Intel, Multi Rainbow, and Monochrome).
- **Synchronized 0.7s System Startup**: Automatically blends real UI telemetry and readings with construction so there is zero dead lag (`krynara-swarm-building` and `krynara-swarm-departing`).
- **Circular Orbit Departure Choreography**: On build completion, arrow agents gather at the center, execute a 360° circular orbit formation, lock their trajectory vector pointing top-right (-45°), and dash out to vanish.
- **Full Automation & Accessibility**: Triggered on route change (`autoNav`), viewport scroll (`autoScroll`), or tap (`autoTouch`) with click-through accessibility (`pointer-events: none !important`) so all HUD controls remain clickable. Manageable through **Settings → Swarm Rebuild Engine Matrix**.

---

## 🏗️ Architecture

```mermaid
flowchart LR
    U[User Devices] --> C[Console / KRYNARA HUD]
    C --> G[Gateway / OpenWA]
    C --> K[Core / OpenJarvis]
    G --> WA[WhatsApp]
    G --> TG[Telegram]
    G --> DC[Discord]
    G --> IG[Instagram]
    C --> O[OSINT Feeds / ADS-B · USGS · GDELT · Satellites]
    K --> LLM[qwen2.5:3b · Ollama]
    G --> DB[(SQLite Persistence)]
```

---

## 🧰 Tech Stack

<p>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/MapLibre-29B6F6?style=flat-square" alt="MapLibre GL" />
  <img src="https://img.shields.io/badge/Baileys-25D366?style=flat-square" alt="Baileys" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Ollama-6D28D9?style=flat-square" alt="Ollama" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
</p>

---

## 🚀 Quick Start

```bash
git clone https://github.com/emmadleo9/Krynara-OS.git
cd Krynara-OS
npm run start        # one coordinator boots gateway (2785) + console (5173)
# Windows: run "MASTER START Krynara-OS V.04.bat"
```

> The local launcher runs the console on port `5173` and the gateway on `2785`. Port `3000` is used only by the Docker Compose deployment (`docker-compose.yml`), not by `npm run start`.

Then open **http://localhost:5173** — the KRYNARA HUD. The master launcher checks Node.js and dependencies, reuses Ollama if running (or starts it when installed), starts the gateway first, waits for its WhatsApp/API health checks, then starts the Vite console and verifies its gateway proxy. Repeated starts reuse the existing healthy stack rather than creating duplicate servers. Use [STOP-KRYNARA.bat](./STOP-KRYNARA.bat) to stop launcher-owned processes. The gateway stays on its internal port and the Vite server proxies `/api`, `/gateway`, and `/v1` through the console origin. Pair KRYNARA WhatsApp from the Social Hub by scanning the QR with your phone.

The Windows master launcher and `npm run start` use the same local gateway + console stack. Do not start the Docker Compose stack at the same time: it publishes conflicting gateway/console ports and is a separate deployment configuration.

---

## 📁 Repo Layout

```
Krynara-OS/
├── /core       OpenJarvis — local-first AI core
├── /gateway     OpenWA + KRYNARA feeds — local API gateway
├── /console     KRYNARA — dark OLED HUD console
├── /data        Local runtime data (DB, Ollama, Redis)
├── /_ref_map    OSIRIS reference — map and public-feed patterns (not runtime)
├── /_refs       Vendored open-source references (jarvis, openwa, bspui, map)
├── /scripts     Startup and utility scripts
├── /telegram-clone  Telegram mirror (reference)
├── /openwa_clone    OpenWA mirror (reference)
└── README.md
```

Console routes (`/` Dashboard, `/world` World View, `/weather` Weather Intel, `/feeds` News & Conflict, `/social` Social Hub, `/whatsapp` KRYNARA WhatsApp, `/scopes` Scopes & Radars, `/devices` My Devices, `/time` World Clock, `/ai-studio` AI Studio, `/settings` Settings, `/diagnostics` Diagnostics).

---

## 📜 License

MIT — see [LICENSE](LICENSE) for the root project. Subprojects carry their own licenses: `core/` (OpenJarvis) is Apache 2.0; `gateway/` (OpenWA) is MIT; `console/` (OpenBSP UI) is Unlicense. See LICENSES/ and each subproject's LICENSE file.

---

Built with open-source. See CREDITS.md for licenses.

---

<div align="center">
<i>Krynara-OS · personal OS that grows with you · status: ONLINE</i><br/>
<img src="https://img.shields.io/badge/KRYNARA-PERSONAL%20OS-8AF8FF?style=for-the-badge" alt="KRYNARA Personal OS" />
</div>
