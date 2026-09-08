# TrainIQ — Strava Training Platform for Home Assistant

A self-hosted cycling training platform running as a Home Assistant app.
Inspired by intervals.icu + Join.cc, fully under your own control.

---

## Features

- **Garmin Connect sync** — activity import (power/HR streams and GPS included) and workout export, via `garminconnect`/`garth`
- **Strava import** — legacy import path; Strava's API now requires a paid subscription, use Garmin for new imports
- **Calendar view** — monthly overview of completed activities and planned workouts, including manual FTP/weight entry
- **Performance Management Chart (PMC)** — CTL (fitness), ATL (fatigue), TSB (form) using the Banister impulse-response model, including a forward projection based on planned workouts
- **Power Curve** — Mean Maximal Power across all standard durations from the last 60 days
- **FTP Estimation** — 3-parameter Critical Power model (Morton, 1996): P(t) = W'/t + CP + (Pmax−CP)·e^(−t/τ), FTP = CP; kept separate from the manually-set FTP
- **TSS Calculation** — power-based TSS with NP/IF; HR-based fallback; RPE-based fallback; estimated fallback for no-data activities
- **Training Goals & AI Planning** — Claude generates a phased training plan and detailed weekly workouts based on fitness, fatigue, and goal
- **NL Challenge** — tracks Dutch municipalities visited by bike, including GPX route preview
- **Eddington number** — progress tracking toward the next E value
- **Garmin & intervals.icu export** — workouts as `.fit` files, direct Garmin Connect export, or via intervals.icu (which then syncs to Garmin)
- **Mobile UI** — bottom navigation and adapted layout below the 768px breakpoint

---

## Installation

### 1. Add the repository to Home Assistant

1. In Home Assistant, go to **Settings → Apps → App Store**
2. Click the three-dot menu → **Repositories**
3. Add your repository URL (e.g. `https://github.com/abrahamderonde/HA-Strava-Training-Platform`)
4. Find **TrainIQ — Strava Training Platform** and click **Install**

### 2. Configure Garmin Connect (primary data source)

Use your regular Garmin Connect email and password. Login/token refresh is handled via `garminconnect`/`garth`.

> Garmin rate-limits login attempts (429 error). See **Garmin Token Setup** in `DOCS.md` if automatic login fails.

### 3. Configure the Anthropic API (AI workout planning)

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Claude is used only for workout generation and goal summaries; all training science (PMC, power curve, FTP) is deterministic

### 4. (Optional) Configure Strava — legacy import

Strava's API now requires a paid subscription. Only needed if you want to import historical Strava data.

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an application with **Authorization Callback Domain** set to your HA hostname (e.g. `homeassistant.local`)
3. Note your **Client ID** and **Client Secret**

### 5. (Optional) Configure intervals.icu

Fill in `intervals_api_key` and `intervals_athlete_id` if you want workouts synced to Garmin via intervals.icu instead of direct Garmin export.

### 6. App Configuration

In the app **Configuration** tab in Home Assistant:

```yaml
garmin_email: "you@example.com"
garmin_password: "your_garmin_password"
anthropic_api_key: "sk-ant-..."
strava_client_id: ""
strava_client_secret: ""
intervals_api_key: ""
intervals_athlete_id: ""
athlete_weight_kg: 70
ftp_initial: 250
```

### 7. Start and Connect

1. Start the app
2. Open **TrainIQ** in the HA sidebar
3. Go to **Settings** → **Garmin Activity Import** → click **Import full year** (or **5-year history**) to pull in your history
4. Activities then sync automatically every night at 1:00 AM

> Large imports can take a while — power, HR, and GPS streams are all fetched.

### 8. Municipality Map (Gemeenten / NL Challenge)

The municipality map loads Dutch municipal boundaries from [PDOK](https://www.pdok.nl) the first time you open that page; this is cached locally.

After import: go to **NL Challenge** → **Re-scan** to detect which municipalities your rides have passed through.

---