# TrainIQ — Enhancement Wishlist

---

## 1. Eddington map upgrades

**Effort:** Low
**Status:** implemented 11-06 - testing - seems finished
**Notes:**: Count logic tweak

**progress bar**
- show progress from last mile stone. So if you are at 90 and you need 3 rides of 91+ km to reach 91, the progress is 0/3 1/3 2/3 etc.

---

## 4. FTP Testing

**Effort:** low
**Status:** implemented - testing - seems finished

**FTP testing**
- I will give you the template workout with steps
- recommendate to do every 2 months
- Show on planning page in red that FTP test is due
- Make indoor/outdoor toggle a indoor/outdoor/FTP selector

---

## 5. PMC upgrades

**Effort:** low
**Status:** implemented - testing
**Notes** Math is straightforward, UI needs work

**Show planning / future**
- show future PMC curve based on detailed and global workout planning

---

## 6. Power curve 'ideal' overlay

**Effort:** Medium / high
**Status:** implemented - testing
**Notes:** CP model already there, needs curve math

Add 'ideal' curve, so you have an impression what 2min, or 5min efforts you could do, based on your power curve.
  
---

## 7. General cleanup

**Effort:** low
**Status:** Pending

- Cleanup all strava buttons / strava references / strava settings (as no strava import exists anymore)
- cleanup all repair / check buttons. Perhaps move them to a debug page, which can be accessed from settings.
- Hide historical commute generator from side bar. This can be moved to debug page. This is only an initial repair for the database.
- 

---

## 8. Merge NL challenge page with check GPX page. 

**Effort:** Medium
**Status:** open.

- always have a field to drop the GPX.
- Use the filters per year / all, to go back to normal views. 

---

## 9. Gui improvements for mobile

**Effort:** Medium - High
**Status:** implemented - testing

**GUI improvements for mobile**
- On mobile the pages don't show up very nicely.
- Bottom bar instead of side bar in mobile.

**TODO**
- check per page if current status is sufficient. 

---

## 10. Equipment / Gear Tracking

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
