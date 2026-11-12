# ContentSync

Mark the good moments of an interview on your phone and get them on the footage from every camera.
Built for Sony FX3 and A7S III, up to four cameras. Works offline; nothing leaves the device.

## How it works

The phone cannot talk to the cameras from a web page, so the app syncs on the one thing they share: time.

1. **Mark.** Tap MARK (or a tag) during the interview. The app stores the phone-clock time of the tap, minus a look-back of a few seconds.
2. **Add clips.** After the shoot, give the app the small `CxxxxM01.XML` files Sony writes next to each clip
   (`PRIVATE/M4ROOT/CLIP` on the card). They hold each clip's start time, timecode, length and frame rate. Video files are never read on a phone.
3. **Sync.** Each camera's clock is compared with the phone's. Out of the box that is good to a second or two if the camera clock was set from the phone.
   For frame accuracy, film the built-in sync slate with each camera and type in what one frame shows.
4. **Export.** One synced multi-camera timeline with markers:
   - `.xml` for Premiere Pro and DaVinci Resolve (FCP7 XML)
   - `.fcpxml` for Final Cut Pro
   - `.edl` marker list for Resolve
   - `.csv` of every mark with clip, frame and timecode
   - a session backup to continue on another device

   In Chrome or Edge the files can be written straight onto the SD card (a `ContentSync` folder at the top level). On iPhone use Save to Files.

## Status of the first version

Tested automatically: Sony metadata parsing against values from real FX3 / A7S III files (23.98, 25, 29.97 DF, 50, 59.94 DF, 119.88),
drop-frame arithmetic, sync and placement, and the export files (FCPXML validates against Apple's 1.9 DTD; the Premiere XML against the xmeml DTD apart from Premiere's own extensions).

Not yet tested, because it needs the real thing:

- importing the exports into Premiere Pro, DaVinci Resolve and Final Cut Pro
- a real FX3 / A7S III card in a phone card reader
- whether a `ContentSync` folder on the card bothers the camera (it should not; it is outside Sony's `PRIVATE` tree)

Not in this version: a live Bluetooth link to the cameras (possible on Android Chrome only, record start/stop only), writing Sony shot marks into the card's own metadata.

## Develop

```
npm install
npm run dev      # local server
npm test         # unit tests
npm run build    # static site in dist/
```

Pushing to `main` runs the tests and deploys to GitHub Pages once Pages is enabled (Settings > Pages > Source: GitHub Actions).
