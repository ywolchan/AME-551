# Project Instructions: Rear-Camera AR + MediaPipe Hand Sculpting App

## Tech Stack
- Bundler: Vite (Vanilla ES6 JS) with `@vitejs/plugin-basic-ssl` for HTTPS (strictly required for Rear Camera & WebXR).
- 3D Engine: `three` (latest) + `STLLoader`, `OBJLoader`, `ThreeMFLoader`, `BufferGeometryUtils`, `STLExporter`.
- Hand Tracking: `@mediapipe/tasks-vision` (`FilesetResolver`, `HandLandmarker`).

## Strict Camera, Depth & Graphics Rules
1. **Rear Camera Only:** Always request `facingMode: { ideal: "environment" }` in `navigator.mediaDevices.getUserMedia`. Never use the front/selfie camera (`user`) or mirror/flip the video feed horizontally.
2. **MediaPipe 3D Depth Mapping:** MediaPipe provides normalized `landmarks` (`x, y` in `[0,1]`, `z` relative to wrist) and metric `worldLandmarks`. To estimate absolute hand depth ($Z_{\text{camera}}$) from the rear camera to the hand:
   - Measure the apparent 2D screen distance between the wrist (`landmark[0]`) and middle finger MCP (`landmark[9]`).
   - Use inverse-proportional scaling calibrated against average human palm size (~0.08m) combined with `landmark[i].z` to unproject 2D screen coordinates (`ndcX, ndcY`) into 3D Three.js camera space using `vector.unproject(camera)`.
3. **3D Hand Collision & Visual Rig:** Render 21 `THREE.Mesh` spheres for hand joints in world space, with collider spheres on `index_finger_tip` (landmark 8) and `thumb_tip` (landmark 4).
4. **STL/OBJ Topology Welding:** Always run `BufferGeometryUtils.mergeVertices(geometry)` on imported models so vertex sculpting deforms smoothly like clay instead of tearing holes.
5. **Clay Deformation & Normals:** Convert hand collision points into the mesh's local space (`mesh.worldToLocal()`). Apply quadratic falloff `w = Math.pow(1 - d / R, 2)`, update `geometry.attributes.position.needsUpdate = true`, and call `geometry.computeVertexNormals()`.
## Section 7: World-Anchored AR Walk-Around Mode (6DoF / 3DoF Spatial Tracking)
1. **World Space vs Camera Space:** Once a model is placed in `AR_WALK_MODE`, its `mesh.position` and `mesh.quaternion` must be locked to a `worldAnchorGroup` in scene world-space—NEVER parented to the camera.
2. **Dynamic Camera Pose:**
   - When WebXR `immersive-ar` is active (`renderer.xr.isPresenting`), Three.js updates the XR `ArrayCamera` matrix automatically via `local-floor` reference space.
   - When running in Rear-Camera Video Passthrough mode (so MediaPipe has `<video>` access or on iOS), update the Three.js `camera` rotation using `DeviceOrientationControls` / `window.addEventListener('deviceorientation')` and estimate translational movement using `devicemotion` acceleration + touch-to-orbit/dolly controls so the user can walk and look around all 360° of the model.
3. **MediaPipe World-Space Projection:** Always unproject MediaPipe 2.5D hand landmarks using the *current frame's* `camera.matrixWorld` (`vector.applyMatrix4(camera.matrixWorld)`), so hand collisions work from any angle as the user walks around the sculpture.