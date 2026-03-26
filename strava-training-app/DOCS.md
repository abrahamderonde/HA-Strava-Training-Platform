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

---

## Garmin Token Setup (if automatic login fails)

Garmin rate-limits SSO login attempts (429 error). If you see this, generate tokens manually on your PC instead:

**On your PC (Windows/Mac/Linux):**

```bash
pip install garth garminconnect
python3 -c "
from garminconnect import Garmin
import os
client = Garmin(email='your@email.com', password='yourpassword')
client.login()
os.makedirs('garmin_tokens', exist_ok=True)
client.garth.dump('garmin_tokens')
print('Tokens saved to garmin_tokens/ folder')
"
```

This creates two files in a `garmin_tokens/` folder:
- `oauth1_token.json`
- `oauth2_token.json`

**Copy them to HA** using the File Editor add-on or SSH:
```
/data/strava_training/garmin_tokens/oauth1_token.json
/data/strava_training/garmin_tokens/oauth2_token.json
```

After copying, try the Garmin export again — it will load the tokens without logging in. Tokens are valid for approximately one year.
