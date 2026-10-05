# TrainIQ — Enhancement Wishlist

---

## 1. Pwr/HR graph + decoupling

**Effort:** low
**Status:** Pending

- show Pwr/HR Graph
- filters for 1000 / 2000 kJ to see decoupling (keep axis fixed with filtering)


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
