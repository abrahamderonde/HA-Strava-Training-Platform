# TrainIQ — Setup & Configuration

Complete setup instructions for the TrainIQ Home Assistant app.

---

## 1. Add the Repository

1. In Home Assistant go to **Settings → Apps → App Store**
2. Click the three-dot menu → **Repositories**
3. Add: `https://github.com/abrahamderonde/HA-Strava-Training-Platform`
4. Find **TrainIQ — Strava Training Platform** and click **Install**

---

## 2. Configure the Strava API

TrainIQ needs its own Strava API application to access your data.

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create a new application:
   - **App Name**: TrainIQ (or anything you like)
   - **Website**: Your Home Assistant URL
   - **Authorization Callback Domain**: Your HA hostname or IP (e.g. `homeassistant.local`)
3. Copy your **Client ID** and **Client Secret** — you'll need these in step 5

---

## 3. Configure Garmin Connect

TrainIQ uses the `garth` library to push workouts to Garmin Connect. Use your regular Garmin Connect **email** and **password**. No separate API key needed.

> Note: This uses Garmin's unofficial API, the same approach used by many community tools such as garminconnect and garth.

---

## 4. Configure the Anthropic API (AI workout planning)

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys** → **Create Key**
3. Copy the key — it starts with `sk-ant-`

> Claude is used only for workout generation and training goal summaries.  
> All training science (PMC, power curve, FTP, TSS) runs locally as deterministic algorithms.  
> Typical cost: ~€0.10/month.

---

## 5. App Configuration

In the app **Configuration** tab in Home Assistant, fill in:

```yaml
strava_client_id: "12345"
strava_client_secret: "your_secret_here"
garmin_email: "you@example.com"
garmin_password: "your_garmin_password"
anthropic_api_key: "sk-ant-..."
athlete_weight_kg: 70
ftp_initial: 250
```

| Field | Description |
|---|---|
| `strava_client_id` | From strava.com/settings/api |
| `strava_client_secret` | From strava.com/settings/api |
| `garmin_email` | Your Garmin Connect login email |
| `garmin_password` | Your Garmin Connect password |
| `anthropic_api_key` | From console.anthropic.com |
| `athlete_weight_kg` | Used for W/kg calculations |
| `ftp_initial` | Starting FTP (watts) before auto-estimation kicks in |

---

## 6. Start and Connect Strava

1. Click **Start** on the app
2. Open **TrainIQ** in the HA sidebar
3. Go to **Settings** → click **Connect Strava**
4. You'll be redirected to Strava to authorize — click **Authorize**
5. You'll be redirected back to TrainIQ
6. Go to **Dashboard** → **Sync Strava** to import your full activity history

> The first import can take a while depending on how many activities you have.  
> Power streams, HR streams, and GPS tracks are all fetched — be patient.

---

## 7. Webhook Setup (real-time sync)

For new activities to appear automatically the moment you finish a ride, Strava needs to be able to reach your Home Assistant instance from the internet.

**Webhook URL format:**
```
https://YOUR_HA_URL/api/strava/webhook
```

**With Nabu Casa:**
```
https://<your-id>.ui.nabu.casa/api/strava/webhook
```

**With own domain / port forwarding:**
```
https://yourdomain.com/api/strava/webhook
```

Register this URL with Strava via their [webhook subscription API](https://developers.strava.com/docs/webhooks/) or the Strava webhook playground.

> Without a webhook, you can still manually sync by clicking **Sync Strava** on the dashboard.

---

## 8. Municipality Map (Gemeenten)

The gemeente map loads Dutch municipal boundaries from [PDOK](https://www.pdok.nl) (Dutch government open geodata) the first time you open that page. This download is cached locally — it only happens once.

After your Strava history is imported, go to **Gemeenten** → **Re-scan activities** to detect which municipalities your rides have passed through.

---

## Troubleshooting

**Port already in use**  
Change the port in the app configuration. The default is `8088`.

**Strava import is slow**  
Strava rate-limits API requests to 100 per 15 minutes. Large histories (500+ activities) may take an hour or more to fully import.

**Garmin export fails**  
Garmin occasionally changes their unofficial API. Check that your email/password are correct. Two-factor authentication on Garmin Connect may also cause issues — temporarily disable it during setup if needed.

**FTP shows initial value, not estimated**  
FTP auto-estimation requires at least 6 power data points across different durations from the last 60 days. Make sure you have rides with a power meter imported.

**Gemeente map is empty**  
GPS tracks need to be stored during import. If you imported activities before the latlng stream was being fetched, go to **Settings** and trigger a re-import, or run the re-scan manually.

## Training Science

### TSS (Training Stress Score)

| Data available | Method |
|---|---|
| Power meter | TSS = (t × NP × IF) / FTP × 100 |
| Heart rate only | HR-TSS via %HRR at LTHR |
| Neither (commutes) | Estimated by sport type × duration |

### PMC Time Constants (Banister model)
- **CTL** (Chronic Training Load / Fitness): τ = 42 days
- **ATL** (Acute Training Load / Fatigue): τ = 7 days  
- **TSB** (Training Stress Balance / Form): CTL − ATL (prior day)

### 3-Parameter Critical Power Model

Morton RH (1996). A 3-parameter critical power model. *Ergonomics, 39*(4), 611-619.

```
P(t) = W'/t + CP + (Pmax − CP) × e^(−t/τ)
```

- **CP** = Critical Power = **FTP**
- **W'** = Anaerobic work capacity (joules)
- **Pmax** = Maximal sprint power
- Fitted to best mean maximal power values from 2–1200 second durations
- Auto-refitted nightly from last 60 days of power data

### Power Zones (Coggan)

| Zone | Name | % FTP |
|---|---|---|
| 1 | Active Recovery | < 55% |
| 2 | Endurance | 56–75% |
| 3 | Tempo | 76–90% |
| 4 | Threshold | 91–105% |
| 5 | VO2 Max | 106–120% |
| 6 | Anaerobic | 121–150% |
| 7 | Neuromuscular | > 150% |


---

## Development

To run locally without Home Assistant:

```bash
# Backend
cd strava-training-addon
pip install -r backend/requirements.txt
export STRAVA_CLIENT_ID=xxx
export STRAVA_CLIENT_SECRET=xxx
export ANTHROPIC_API_KEY=xxx
python -m uvicorn backend.main:app --reload --port 8080

# Frontend (separate terminal)
cd frontend
npm install
npm run dev  # proxies /api to port 8080
```
