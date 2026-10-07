# TrainIQ — Enhancement Wishlist

---

## 1. Ride Stats & Detailed Analysis

**Effort:** High  
**Status:** implemented - testing

### Feature Overview
Implement single-ride analytics by processing stream data (time, watts, HR, cadence, alt). Display high-level summary metrics directly in the Calendar/Dashboard, with a dedicated Ride Detail view/modal for deep-dive metrics.

### A. Quick Stats (Calendar & Dashboard)
Show a compact summary card per ride with non-redundant core metrics:
- **Duration / TSS / Kilojoules (kJ)**
- **Variability Index (VI)**
- **Aerobic Decoupling**  EF2 vs EF1 (% change)
  Formula: (1 - (EF_hour2 / EF_hour1)) * 100
  - Applies to: Rides >= 2 hours moving time
  - Short rides (< 2h): Show 'N/A'
  - Indicator: 🟢 < 1.5% | 🟡 1.5% - 3.0% | 🔴 > 3.0%

### B. Detailed Ride Analysis View
Accessible by clicking a ride in the Calendar or Dashboard.

#### 1. Pacing & Intensity
- **Variability Index (VI)** (`NP / AP`)
- **Intensity Factor (IF)** (`NP / FTP`)
- **Work / Energy per Zone** (Table & Bar chart of total kJ per Power Zone)

#### 2. Aerobic Condition & Fatigue (Durability)
- **Aerobic Decoupling (Pwr:HR Drift):**
  - Calculate drift **per hour** (rate of decoupling)
  - **Filter rules:** Exclude warmup (first 10 min) and exclude pauses/stops (`moving_time` only)
  - **Thresholds:** 🟢 `<1.5%/h` (Great) | 🟡 `1.5–3.0%/h` (Moderate) | 🔴 `>3.0%/h` (High fatigue)
- **Efficiency Factor (EF) Trend:**
  - Hourly EF breakdown (`NP_hour / Avg_HR_hour`)

#### 3. Anaerobic Battery
- **W' Balance Dynamic Curve:**
  - Real-time depletion & recovery tracking of W' (Skiba model)

#### 4. Auto Ride Segmentation & Detection
- **Auto-Interval Detection:**
  - Auto-detect sustained efforts (e.g., >3 min at >90% FTP). Show NP, Cadence, HR, and EF for each segment.
- **Climb Detection:**
  - Auto-detect climb segments (`gradient > 3%` AND `elevation gain > 10m`).
  - Calculate: Length (km), Elevation Gain (m), VAM (m/h), Average W/kg.

## 2. General cleanup

**Effort:** low
**Status:** Pending

- Cleanup all strava buttons / strava references / strava settings (as no strava import exists anymore)
- cleanup all repair / check buttons. Perhaps move them to a debug page, which can be accessed from settings.
- Hide historical commute generator from side bar. This can be moved to debug page. This is only an initial repair for the database.

---

## 3. Equipment / Gear Tracking

**Effort:** high
**Status:** Pending

Track bikes and components, log distance/hours per item, get alerts when service intervals are due.

**Requirements:**
- List of bikes synced from Strava gear (already in API response)
- Per-bike total distance and hours (auto-calculated from activities)
- Manual component log per bike:
  - Chain (replace every ~2,000–3,000 km)
  - Tyres front/rear
  - Bar tape
  - Brake pads
  - Cassette
  - Custom components
- Each component: install date, install distance/odometer, replacement interval (km or months)
- Dashboard alert when a component is approaching or past its service interval
- Activity → bike assignment (from Strava `gear_id`)

**Notes:**
- New DB table needed: `equipment` and `equipment_service_log`
- Strava `gear_id` is already stored on `Activity`

---

## Other (not so concrete) ideas

- Power plan generation (inspired on best bike split)

---

*Last updated: June 2026*
