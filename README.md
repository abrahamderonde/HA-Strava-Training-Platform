# TrainIQ — Strava Training Platform

> A self-hosted cycling training platform for Home Assistant.  
> Inspired by intervals.icu, Join.cc and wielervriende.nl — fully under your own control.

[![Open your Home Assistant instance and show the add add-on repository dialog with this app repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fabrahamderonde%2FHA-Strava-Training-Platform)

---

### [Strava Training Platform](./strava-training-app)

## Features

### 📊 Training Analytics
- **Performance Management Chart** — CTL (fitness), ATL (fatigue), TSB (form) using the Banister impulse-response model
- **Power Curve** — Mean Maximal Power across all standard durations from last 60 days
- **FTP Estimation** — 3-parameter Critical Power model (Morton, 1996): FTP = CP
- **TSS Calculation** — Power-based with NP/IF; HR-based fallback; estimated fallback for activities without data

### 📅 Activity Management
- **Strava sync** — full history import + real-time webhook for new activities
- **Calendar view** — monthly overview of completed activities and planned workouts

### 🗺️ Gemeente Explorer (Netherlands)
- **Municipality map** — choropleth map of all 342 Dutch gemeenten, showing which you've cycled through
- **GPX checker** — upload a planned route to preview which new gemeenten it crosses
- **Eddington number** — calculated from all cycling activities with progress chart

### 🤖 AI Coaching
- **Training goals** — set a target event (e.g. Liège-Bastogne-Liège 150km) with AI periodization overview
- **Weekly workout planning** — Claude generates structured workouts based on your fitness, fatigue, and goal
- **Garmin export** — push workouts directly to Garmin Connect

---

## Architecture

```
┌─────────────────────────────────────────┐
│         Home Assistant App               │
│                                         │
│  ┌───────────┐    ┌───────────────────┐ │
│  │  React    │    │   FastAPI         │ │
│  │  Frontend │◄──►│   Backend         │ │
│  │  (Vite)   │    │   (Python)        │ │
│  └───────────┘    └────────┬──────────┘ │
│                            │            │
│                    ┌───────▼──────────┐ │
│                    │   SQLite DB      │ │
│                    │  /data/training  │ │
│                    └──────────────────┘ │
└──────────────┬──────────────┬───────────┘
               │              │
         ┌─────▼─────┐  ┌─────▼──────┐
         │  Strava   │  │   Garmin   │
         │   API     │  │  Connect   │
         └───────────┘  └────────────┘
                              │
                    ┌─────────▼──────┐
                    │  Anthropic     │
                    │  Claude API    │
                    └────────────────┘
```

**Stack:** Python · FastAPI · SQLite · React · Vite · Leaflet · Recharts · Shapely · PDOK

---

## Training Science

All training load calculations are deterministic algorithms — no AI involved.

| Model | Implementation |
|---|---|
| TSS (power) | `(t × NP × IF) / FTP × 100` |
| TSS (HR) | HR-TSS via %HRR at LTHR |
| CTL / ATL | Banister impulse-response, τ = 42d / 7d |
| FTP | 3-param CP model: `P(t) = W'/t + CP + (Pmax−CP)·e^(−t/τ)` |
| Power zones | Coggan 7-zone model |
| Gemeente detection | Point-in-polygon via Shapely + PDOK CBS boundaries |
| Eddington number | Largest N where ≥ N days with ≥ N km ridden |

---

## Installation

See [DOCS.md](strava-training-app/DOCS.md) for full setup instructions.

---

## Local Development

```bash
# Backend
cd strava_training
pip install -r backend/requirements.txt
export STRAVA_CLIENT_ID=xxx
export STRAVA_CLIENT_SECRET=xxx
export ANTHROPIC_API_KEY=xxx
python -m uvicorn backend.main:app --reload --port 8088

# Frontend (separate terminal)
cd frontend
npm install
npm run dev  # proxies /api to port 8088
```

---

## API Costs

| Service | Cost |
|---|---|
| Weekly AI plan generation | ~€0.02 |
| Goal creation | ~€0.01 one-time |
| Strava, Garmin, PDOK | Free |
| **Typical monthly total** | **~€0.10** |

---

*Built for personal use. Contributions welcome.*
