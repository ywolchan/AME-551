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
- Choose Raise or Lower, then adjust brush radius and strength. Enable or pause Sculpt Mode as needed.
- Import `.stl`, `.obj`, or `.3mf` models, reset the current shape, and export the result as STL.
- For rear-camera passthrough, choose **Rear Camera AR**, allow rear-camera access, and tap **Place model**. MediaPipe tracks both hands and maps the 21 joints into approximate camera space using the wrist-to-middle-MCP palm size and the adjustable depth calibration. Pinch thumb and index finger over the model to pull clay; finger-tip contact pokes the surface.
- **Passthrough AR + Hands** has Place, Walk View, and Walk Sculpt states. After placing, it starts in Walk View, which is inspection-only and intentionally hides the hand skeleton and pauses sculpting. Tap **Walk Sculpt** in the on-screen toolbar to show the MediaPipe skeleton and enable hand interaction. The model stays fixed while touch orbit/pan/dolly, device orientation, and damped motion estimates move the passthrough view. Re-center places the model 0.45 m in front of the camera.
- Passthrough movement is an approximation, not physical 6DoF room tracking: phone accelerometer integration drifts and cannot reliably reconstruct a person's position. Use **Native XR 6DoF** on supported ARCore/WebXR devices for room-scale 6DoF tracking, surface hit tests, and native anchors. Native WebXR requests `local-floor`, `hit-test`, and optional DOM overlay/anchors; browsers may reserve the camera for WebXR, preventing MediaPipe from accessing frames. Use Passthrough AR + Hands when you need hand tracking. MediaPipe first tries the GPU delegate and falls back to CPU if GPU initialization fails.
- The app requires a confirmed rear-facing camera and never falls back to a front camera. Camera frames are processed on-device and are not uploaded. The MediaPipe runtime and tracking model are downloaded from their public CDNs the first time.

Run `npm run build` to create the production bundle.
