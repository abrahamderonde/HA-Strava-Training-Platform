# TrainIQ — Strava Training Platform for Home Assistant

A self-hosted cycling training platform running as a Home Assistant add-on.
Inspired by intervals.icu + Join.cc, fully under your own control.

---

## Features

- **Strava sync** — full history import + real-time webhook for new activities
- **Calendar view** — monthly overview of completed activities and planned workouts
- **Performance Management Chart (PMC)** — CTL (fitness), ATL (fatigue), TSB (form) using the Banister impulse-response model
- **Power Curve** — Mean Maximal Power across all standard durations from last 60 days
- **FTP Estimation** — 3-parameter Critical Power model (Morton, 1996): P(t) = W'/t + CP + (Pmax−CP)·e^(−t/τ), FTP = CP
- **TSS Calculation** — Power-based TSS with NP/IF; HR-based fallback; estimated fallback for no-data activities
- **Training Goals** — Set target events (e.g. Liège-Bastogne-Liège 150km) with AI periodization overview
- **AI Workout Planning** — Claude generates structured weekly workouts based on your fitness, fatigue, and goal
- **Garmin Export** — Push workouts directly to Garmin Connect via `garth`

---

## Installation

### 1. Add the repository to Home Assistant

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**
2. Click the three-dot menu → **Repositories**
3. Add your repository URL (e.g. your GitHub repo containing this add-on)
4. Find **Strava Training Platform** and click **Install**

### 2. Configure Strava API

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create a new application:
   - **App Name**: TrainIQ (or anything you like)
   - **Website**: Your HA URL
   - **Authorization Callback Domain**: Your HA hostname/IP (e.g. `homeassistant.local`)
3. Note your **Client ID** and **Client Secret**

### 3. Configure Garmin

Use your regular Garmin Connect email and password. The `garth` library handles authentication using the unofficial API (same approach used by many community tools).

### 4. Configure Anthropic API

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Note: Claude is used only for workout generation and goal planning. All training science calculations (PMC, power curve, FTP) are deterministic algorithms.

### 5. Add-on Configuration

In the add-on **Configuration** tab, set:

```yaml
strava_client_id: "12345"
strava_client_secret: "your_secret_here"
garmin_email: "you@example.com"
garmin_password: "your_garmin_password"
anthropic_api_key: "sk-ant-..."
athlete_weight_kg: 70
ftp_initial: 250   # starting FTP before first auto-estimation
```

### 6. Start and Connect

1. Start the add-on
2. Open the **TrainIQ** panel in the HA sidebar
3. Go to **Settings** and click **Connect Strava**
4. Authorize the app — you'll be redirected back
5. Go to **Dashboard** → **Sync Strava** to import your history

### 7. Webhook Setup (optional but recommended for real-time sync)

For new activities to automatically appear, Strava needs to reach your HA instance:

- **With Nabu Casa**: Your webhook URL is `https://<your-id>.ui.nabu.casa/api/strava/webhook`
- **With own domain/port forwarding**: `https://yourdomain.com:8123/api/strava/webhook` (or via nginx proxy)

Register the webhook with Strava using their API or the Strava webhook playground.

---


