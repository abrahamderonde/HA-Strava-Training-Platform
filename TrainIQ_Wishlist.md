# TrainIQ — Enhancement Wishlist

*To be implemented after testing. Items added in order of discussion.*

---

## 1. Distance Progress Graphs

**Priority:** High
**Status:** Pending

Multi-year distance comparison charts showing how weekly or monthly distance evolves over the calendar year.

**Requirements:**
- Line or area chart with one line per year, all years overlaid on a Jan–Dec x-axis
- Aggregation options: weekly totals or monthly totals
- **Filter: exclude commutes** (rides tagged as commutes in Strava)
- **Filter: exclude indoor** (VirtualRide / trainer activities)
- Hover tooltip showing exact value per year per week/month

**Notes:**
- Commute flag is available in the Strava activity data (`commute: true/false`) — needs to be stored in the `Activity` model
- Indoor = `sport_type: VirtualRide` or `trainer: true` in Strava data

---

## 2. Fitness Progress Graph (Year-over-Year CTL)

**Priority:** High
**Status:** Pending

Chart comparing CTL (fitness) across calendar years, so you can see whether this year's fitness is ahead of or behind last year.

**Requirements:**
- CTL plotted by day-of-year (1–365), one line per year
- At minimum: current year vs previous year
- Ideally: all available years with muted colors for older years, current year highlighted
- Visual reference band showing "better than last year" / "worse than last year"

**Notes:**
- PMC data is already stored in `training_metrics` table — just needs a year-on-year reshape
- Should live on the PMC page as a tab or secondary chart

---

## 3. Equipment / Gear Tracking

**Priority:** Medium
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

## 4. Historical Commute Generator

**Priority:** Medium
**Status:** Pending

A tool to backfill synthetic commute activities for the period before commutes were tracked with GPS, so that the fitness timeline (CTL/ATL) reflects actual historical load.

**Commute pattern to backfill:**
- Days: Monday, Tuesday, Wednesday, Thursday (both ways = 2 rides per day)
- Duration: 20 minutes per ride
- Intensity Factor: 0.65
- TSS per ride: `(20/60) × (0.65 × FTP) × 0.65 / FTP × 100` = **~14 TSS per ride**, ~28 TSS per commute day
- Tracking started: **4 March 2025** — backfill everything before this date

**Requirements:**
- UI to set the backfill date range (start date → 3 March 2025)
- Preview: show how many synthetic activities will be created and total TSS added
- Confirmation step before writing to DB
- Synthetic activities clearly flagged (`synthetic: true`, `name: "Commute (estimated)"`)
- Option to delete all synthetic activities and redo
- These activities count toward PMC but are excluded from distance graphs, power curve, Eddington number, and gemeente detection

**Notes:**
- Does not push to Strava — local DB only
- FTP at time of commute can be estimated or use a fixed configurable value
- If commutes are ever retroactively added to Strava, synthetic ones can be deleted

---

## Implementation Notes

- All items above depend on a stable, tested v1 of the core app
- Items 1 and 2 are pure frontend additions — no new backend models needed
- Items 3 and 4 require new DB models and backend endpoints
- The commute flag from Strava (item 1) should be added to the `Activity` model during the next backend update, even if the UI isn't built yet — it will save re-importing all activities later

---

*Last updated: based on discussion during initial development*
