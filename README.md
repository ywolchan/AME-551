# Clay Studio

A small browser-based clay sculpting studio built with Three.js, Vite, and WebXR.

## Run locally

```sh
npm install
npm run dev
```

Vite serves the studio over HTTPS using a locally generated certificate so WebXR can be enabled. Open the HTTPS address printed in the terminal. The XR button is available in browsers and devices that support immersive VR.

## GitHub Pages

The `main` branch deploys to [GitHub Pages](https://ywolchan.github.io/AME-551/) after the GitHub Actions workflow completes. The workflow builds the app with the repository path configured for project Pages.

## Sculpt

- Drag on the clay to sculpt; orbit the view by dragging outside the model or holding Alt/Option.
- Choose Raise or Lower, then adjust brush radius and strength in the sidebar.
- Use Reset shape to restore the current model, or import an `.stl`, `.obj`, or `.3mf` file.
- On a supported mobile browser, choose Place in AR and move the phone until the surface reticle appears, then tap Place clay. If surface detection does not find a surface after a few seconds, use Place clay ahead to put it in front of you.
- Choose Hands AR to show the verified rear-camera view with the clay overlaid; MediaPipe tracks your index finger and thumb so pinching over the clay sculpts it with the selected tool. If you are in spatial WebXR AR, choose Switch to Hands AR to transition directly into this live camera-and-hands mode. Browsers do not provide WebXR's passthrough camera frames to MediaPipe, so Hands AR uses a camera overlay rather than world-locked WebXR placement. The app selects a rear-labeled camera when available, also requires the browser's rear-facing constraint, and verifies the active track; it never falls back to the front camera. The camera stream is processed on-device and is not uploaded. The tracking model and runtime are downloaded from MediaPipe's public CDNs the first time.

Run `npm run build` to create the production bundle.
