# TrainIQ — Enhancement Wishlist

## 0. Known bugs
**Priority:** High
**Status:** Pending

- Workout generation misses details

---

## 1. Workout planning improvements
**Priority:** High
**Status:** Finished

---

## 2. Distance Progress Graphs

**Priority:** Medium
**Status:** Finished

---

## 3. Fitness Progress Graph (Year-over-Year CTL)

**Priority:** Medium
**Status:** Finished

---

## 4. Equipment / Gear Tracking

**Priority:** Low
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

## 5. Historical Commute Generator

**Priority:** Medium
**Status:** Finished

Minor improvements. Hide from side bar, only access page from setting page, as this is not in the daily workflow

---

## 6. Gemeente map upgrades

**Priority:** Low
**Status:** Finished

---

## 7. Eddington map upgrades

**Priority:** Low
**Status:** Testing phase
Testing result: Progress bar is stil to be done

**progress bar**
- show progress from last mile stone. So if you are at 90 and you need 3 rides of 91+ km to reach 91, the progress is 0/3 1/3 2/3 etc.

**line n=n**
- Show line where n_days = n_km. So you see the gap between the bars and the required line. 

---

## 8. PMC upgrades

**Priority:** Low
**Status:** Pending

**Show planning / future**
- show future PMC curve based on detailed and global workout planning

---

## 9. Gui improvements for mobile

**Priority:** Medium
**Status:** Pending

**GUI improvements for mobile**
- On mobile the pages don't show up very nicely.
- Maybe the side bar can collapse or so
  
---

## Other (not so concrete) ideas

- Power plan generation (inspired on best bike split)

---

*Last updated: April 2026*
