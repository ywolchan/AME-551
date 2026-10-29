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
- Choose Camera hands and allow rear-camera access to sculpt with hand tracking. MediaPipe tracks your index finger and thumb; pinch over the clay to sculpt with the selected tool. Camera hands requests and verifies the rear camera; it never falls back to the front camera. Camera hands and immersive WebXR AR are separate modes: choose Exit AR for Camera hands in the AR overlay, then start Camera hands after AR ends. The rear camera stream is processed on-device and is not uploaded. The tracking model and runtime are downloaded from MediaPipe's public CDNs the first time.

Run `npm run build` to create the production bundle.