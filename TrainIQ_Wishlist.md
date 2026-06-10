# TrainIQ — Enhancement Wishlist

---

## 1. Main dashboard
**Priority:** low
**Status:** Open

Merge with PMC. Little added value of PMC. 
Requirements.
Show graph as in PMC. This one is more clear
Show selectors for selected time

New: When you go over the graph, you see the summary of that day.. TSS etc. Would be nice to also see the name of the activity of that day. If there are multiple it is sufficient to show only the activity with the largest TSS. 

---

## 1. Power page
**Priority:** low
**Status:** Open

Add 'ideal' curve, so you have an impression what 2min, or 5min efforts you could do, based on your power curve.

---

## 2. Planning

**Priority:** Medium
**Status:** Open

**2 FTP testing**
- I will give you the template workout with steps
- recommendate to do every 2 months
- Show on planning page in red that FTP test is due
- Make indoor/outdoor toggle a indoor/outdoor/FTP selector

---

## 7. Eddington map upgrades

**Priority:** Low
**Status:** Testing phase
Testing result: Progress bar is stil to be done

**progress bar**
- show progress from last mile stone. So if you are at 90 and you need 3 rides of 91+ km to reach 91, the progress is 0/3 1/3 2/3 etc.

---

## 5. Historical Commute Generator

**Priority:** Medium
**Status:** Finished

Minor improvements. Hide from side bar, only access page from setting page, as this is not in the daily workflow

---

## 8. PMC upgrades

**Priority:** Low
**Status:** Pending

**Show planning / future**
- show future PMC curve based on detailed and global workout planning

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

## 9. Gui improvements for mobile

**Priority:** Medium
**Status:** Pending

**GUI improvements for mobile**
- On mobile the pages don't show up very nicely.
- Maybe the side bar can collapse or so
  
---

## 9. Strava import cleanp

**Priority:** low
**Status:** Pending

Cleanup all buttons and settings on pages for strava imports. Maybe keep backend just in case. 
  
---

## Other (not so concrete) ideas

- Power plan generation (inspired on best bike split)

---

*Last updated: June 2026*
