# Clay Studio

A small browser-based clay sculpting studio built with Three.js, Vite, and MediaPipe hand tracking.

## Run locally

```sh
npm install
npm run dev
```

Vite serves the studio over HTTPS using a locally generated certificate so rear-camera access can be enabled. Open the HTTPS address printed in the terminal.

## GitHub Pages

The `main` branch deploys to [GitHub Pages](https://ywolchan.github.io/AME-551/) after the GitHub Actions workflow completes. The workflow builds the app with the repository path configured for project Pages.

## Sculpt

- Drag on the clay to sculpt; orbit the view by dragging outside the model or holding Alt/Option.
- Choose Raise or Lower, then adjust brush radius and strength in the sidebar.
- Use Reset shape to restore the current model, or import an `.stl`, `.obj`, or `.3mf` file.
- On a supported mobile browser, choose Place in AR and allow rear-camera access. Tap Place clay to place the model in the camera view, then pinch with your thumb and index finger over the clay to sculpt with the selected tool. Placement and hand sculpting use the same camera view and MediaPipe session. The model is overlaid at a fixed camera-relative depth, not anchored to real-world surfaces as you move the phone, because browsers do not provide WebXR camera frames to MediaPipe. The app selects a rear-labeled camera when available, requires the browser's rear-facing constraint, and verifies the active track; it never falls back to the front camera. The camera stream is processed on-device and is not uploaded. The tracking model and runtime are downloaded from MediaPipe's public CDNs the first time.

Run `npm run build` to create the production bundle.
