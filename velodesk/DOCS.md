# VeloDesk — Setup & Configuration

Complete setup instructions for the VeloDesk Home Assistant app.

---

## 1. Add the Repository

1. In Home Assistant go to **Settings → Apps → App Store**
2. Click the three-dot menu → **Repositories**
3. Add: `https://github.com/abrahamderonde/HA-VeloDesk`
4. Find **VeloDesk - Cycling Training Platform** and click **Install**

---

## 2. Configure Garmin Connect

VeloDesk imports activities from Garmin Connect and pushes workouts to it using the `python-garminconnect` library. Generate the token file on your PC (run `example.py` from python-garminconnect) and copy `garmin_tokens.json` to `/config/strava_training/garmin_tokens/`. Email and password are only used as a fallback when no valid tokens are found.

---

## 3. Configure the Anthropic API (AI workout planning)

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys** → **Create Key**
3. Copy the key — it starts with `sk-ant-`

> Claude is used only for workout generation and training goal summaries.  
> All training science (PMC, power curve, FTP, TSS) runs locally as deterministic algorithms.  
> Typical cost: ~€0.50/month.

---

## 4. App Configuration

In the app **Configuration** tab in Home Assistant, fill in:

```yaml
garmin_email: "you@example.com"
garmin_password: "your_garmin_password"
anthropic_api_key: "sk-ant-..."
athlete_weight_kg: 70
ftp_initial: 250
```

| Field | Description |
|---|---|
| `garmin_email` | Your Garmin Connect login email |
| `garmin_password` | Your Garmin Connect password |
| `anthropic_api_key` | From console.anthropic.com |
| `athlete_weight_kg` | Used for W/kg calculations |
| `ftp_initial` | Starting FTP (watts) before auto-estimation kicks in |

---

## 5. TSS Calculation

For every imported activity VeloDesk uses the first available source:

1. **Power** – Normalized Power from the TCX power stream, only if at least 50% of the samples are above 0 W
2. **Heart rate** – hrTSS, used when power is missing or unusable (e.g. a power meter failure)
3. **Estimate** – based on sport type and duration, when neither is available

---

## 6. Start and Import Garmin Activities

1. Click **Start** on the app
2. Open **VeloDesk** in the HA sidebar
3. Go to **Settings** and check that Garmin tokens are found
4. Click **Import full year** or **Import 5 years**, then **Backfill GPS**

Activities also sync automatically every night at 01:00.

---

## 7. Workout Library

VeloDesk periodically syncs all cycling workouts from your Garmin workout templates into a local library, labeling each as **Join** (name contains "join"), **VeloDesk** (previously exported by this app), or **Overig**. Use the **Bibliotheek** page to browse, re-label, rate, or delete entries, or trigger a manual sync. Rated/labeled workouts can be picked directly on the Planning page, and are used as few-shot examples for AI workout generation (VeloDesk-labeled workouts are always excluded to avoid the AI learning from its own output).

Sync runs nightly at 3:00 AM; deleted Garmin workouts are never auto-removed from the library, only manually via the Bibliotheek page. The list is sorted by last added, so new workouts appear on top and are easy to rate.

**Scan duplicates** finds workouts with identical interval structure (names are ignored). The older entry is kept, so existing stars survive (a rating on the newer one is copied only if the older has none), and it moves to the top of the list with a fresh date. The newer Garmin workout ID is remembered so later syncs don't re-import it.

---

## 8. Municipality Map (Gemeenten)

The gemeente map loads Dutch municipal boundaries from [PDOK](https://www.pdok.nl) (Dutch government open geodata) the first time you open that page. This download is cached locally — it only happens once.

After your Strava history is imported, go to **Gemeenten** → **Re-scan activities** to detect which municipalities your rides have passed through.

---

## 9. Power Curve Durability

The Power page can filter the power curve to the part of each ride after 1000 or 2000 kJ of accumulated work, showing how much power you can still produce when fatigued. These curves are calculated nightly (or via **Recalculate**) from the stored power streams of the last 60 days. CP/FTP estimation and the ideal curve always use the fresh (0 kJ) curve.

---

## 10. Ride Analysis

Click **Ride analysis** on an activity in the Calendar, or click an activity on the Dashboard, to open the detail view.

**Quick stats** (Calendar and Dashboard): duration, TSS, kJ, Variability Index (NP / average power) and aerobic decoupling (EF hour 1 vs EF hour 2). Decoupling is only shown for rides of 2 hours or more moving time, otherwise `N/A`. 🟢 < 1.5% · 🟡 1.5–3.0% · 🔴 > 3.0%.

**Detail view:**
- Pacing: VI, IF (NP / FTP in effect on the ride date) and kJ per power zone
- Durability: decoupling drift per hour and hourly EF trend (first 10 minutes and pauses are excluded)
- W' balance: Skiba differential model, using the latest CP and W' estimate
- Intervals: efforts of 3+ minutes above 90% FTP
- Climbs: gradient above 3% and more than 10 m elevation gain, with VAM and average W/kg

**Existing rides:** streams are stored on import from now on. For rides imported earlier, go to **Settings → Garmin Activity Import → Backfill ride streams**. Rides without a power meter, indoor/trainer rides and manual activities have no streams and show no analysis.

---

## Troubleshooting

**Port already in use**  
Change the port in the app configuration. The default is `8088`.

**Garmin import or export fails**  
Garmin occasionally changes their unofficial API and rate-limits logins (HTTP 429). Use the token setup below.

**FTP shows initial value, not estimated**  
FTP auto-estimation requires at least 6 power data points across different durations from the last 60 days. Make sure you have rides with a power meter imported.

**Gemeente map is empty**  
GPS tracks need to be stored during import. If you imported activities before the latlng stream was being fetched, go to **Settings** and trigger a re-import, or run the re-scan manually.

---

## Garmin Token Setup (if automatic login fails)

Generate the token on your PC with python-garminconnect (`example.py`), then copy the token file to Home Assistant:

```bash
scp ~/.garminconnect/garmin_tokens.json root@homeassistant.local:/config/strava_training/garmin_tokens/
```

The Settings page shows whether tokens were found.
