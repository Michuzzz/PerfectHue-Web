# PerfectHue-Web

A static, GitHub Pages-friendly version of PerfectHue.

## Files
- `index.html` — page structure
- `style.css` — original PerfectHue styling, retained and extended
- `script.js` — browser-side face detection, skin-colour sampling, shade matching and PDF export
- `foundation_dataset.csv` — foundation shade dataset
- `images/beauty-hero.png` — supplied homepage hero image

## Run locally
Because the browser loads the CSV and MediaPipe model, run this folder through a local web server (not by double-clicking `index.html`).

For example, in VS Code install/use Live Server and open `index.html`.

## Publish with GitHub Pages
1. Create or open the `PerfectHue-Web` GitHub repository.
2. Upload the contents of this folder (not the enclosing folder).
3. Open **Settings → Pages**.
4. Under Build and deployment, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`, then Save.

## Important limitations
- This version does not send the uploaded photograph to a backend. Face analysis and matching run in the visitor's browser.
- It requires an internet connection to load the MediaPipe and jsPDF libraries from their CDNs.
- The shade match is based on RGB distance and can be affected by lighting, makeup, camera processing and screen differences. It is a guide, not a guaranteed product match.
- The face preview is a simple colour overlay for visualisation; it is not a physically accurate makeup simulation.
