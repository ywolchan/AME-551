import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ARCameraManager } from "./ARCameraManager.js";
import { HandTracker } from "./HandTracker.js";
import { ModelLoader } from "./ModelLoader.js";
import { SculptEngine } from "./SculptEngine.js";
import {
	AR_WALK_MODE,
	PLACE_MODE,
	WALK_SCULPT_MODE,
	WALK_VIEW_MODE,
	SpatialTracker,
} from "./SpatialTracker.js";
import "./style.css";

const viewport = document.querySelector(".viewport");
const statusMessage = document.querySelector("#status-message");
const errorMessage = document.querySelector("#error-message");
const canvasHelp = document.querySelector("#canvas-help");
const meshInfo = document.querySelector("#mesh-info");
const modelLabel = document.querySelector("#model-label");
const radiusInput = document.querySelector("#brush-size");
const strengthInput = document.querySelector("#brush-strength");
const depthInput = document.querySelector("#depth-calibration");
const arButton = document.querySelector("#ar-button");
const webxrButton = document.querySelector("#webxr-button");
const cameraPlaceButton = document.querySelector("#camera-place-button");
const cameraStatus = document.querySelector("#camera-hand-status");
const arToolbar = document.querySelector("#ar-toolbar");
const video = document.querySelector("#hand-camera-feed");
const walkViewButton = document.querySelector("#walk-view-button");
const walkSculptButton = document.querySelector("#walk-sculpt-button");
const recenterButton = document.querySelector("#recenter-anchor-button");
const launchNativeWalkButton = document.querySelector("#launch-native-walk-button");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#1a1b21");
scene.fog = new THREE.Fog("#1a1b21", 2.4, 8);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 20);
camera.position.set(0, 0.2, 1.4);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x000000, 0);
viewport.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.minDistance = 0.55;
controls.maxDistance = 4;

scene.add(new THREE.HemisphereLight("#e3e3ed", "#443536", 2.2));
const keyLight = new THREE.DirectionalLight("#ffe0c4", 3.2);
keyLight.position.set(-2, 3, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight("#9eaed3", 1.6);
fillLight.position.set(3, 1, -3);
scene.add(fillLight);

const ground = new THREE.Mesh(
	new THREE.PlaneGeometry(20, 20),
	new THREE.MeshStandardMaterial({ color: "#222329", roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.22;
scene.add(ground);
const groundGrid = new THREE.GridHelper(4, 40, "#55505a", "#393940");
groundGrid.position.y = -0.218;
scene.add(groundGrid);

const modelRoot = new THREE.Group();
const worldAnchorGroup = new THREE.Group();
scene.add(worldAnchorGroup);
worldAnchorGroup.add(modelRoot);
worldAnchorGroup.visible = true;
const anchorGround = new THREE.Group();
anchorGround.visible = false;
worldAnchorGroup.add(anchorGround);
renderer.shadowMap.enabled = true;
const shadowLight = new THREE.DirectionalLight("#ffffff", 1.1);
shadowLight.position.set(-1.5, 2.8, 1.5);
shadowLight.castShadow = true;
shadowLight.shadow.mapSize.set(512, 512);
shadowLight.shadow.camera.left = -1;
shadowLight.shadow.camera.right = 1;
shadowLight.shadow.camera.top = 1;
shadowLight.shadow.camera.bottom = -1;
scene.add(shadowLight);
const anchorFloor = new THREE.Mesh(
	new THREE.PlaneGeometry(1.8, 1.8),
	new THREE.ShadowMaterial({ color: "#000000", opacity: 0.22 }),
);
anchorFloor.rotation.x = -Math.PI / 2;
anchorFloor.position.y = 0.001;
anchorFloor.receiveShadow = true;
anchorGround.add(anchorFloor);
const anchorGrid = new THREE.GridHelper(1.6, 32, "#89b9ae", "#55766e");
anchorGrid.position.y = 0.003;
anchorGrid.material.transparent = true;
anchorGrid.material.opacity = 0.22;
anchorGround.add(anchorGrid);
const reticle = new THREE.Mesh(
	new THREE.RingGeometry(0.055, 0.064, 40),
	new THREE.MeshBasicMaterial({ color: "#83f4db", side: THREE.DoubleSide }),
);
reticle.rotation.x = -Math.PI / 2;
reticle.visible = false;
scene.add(reticle);
const brushIndicator = new THREE.Mesh(
	new THREE.SphereGeometry(1, 24, 16),
	new THREE.MeshBasicMaterial({ color: "#52ff80", wireframe: true, transparent: true, opacity: 0.45 }),
);
brushIndicator.visible = false;
brushIndicator.renderOrder = 4;
scene.add(brushIndicator);

let mesh = null;
let originalGeometry = null;
let activeMode = "raise";
let brushRadius = Number(radiusInput.value);
let brushStrength = Number(strengthInput.value);
let sculptEnabled = true;
let arActive = false;
let modelPlaced = false;
let nativeXRActive = false;
let nativeXRSupported = false;
let nativeXRSupportMessage = "Checking native WebXR support…";
let arSessionMode = null;
let arWalkMode = null;
let importedModelName = "";
let lastPointerSculptAt = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cameraManager = new ARCameraManager({
	video,
	renderer,
	camera,
	reticle,
	overlayRoot: document.getElementById("ui-overlay"),
	onSessionEnd: () => {
		if (arActive && nativeXRActive) {
			_exitAR();
			void cameraManager.stop();
			return;
		}
		if (!cameraManager.stream && arActive) {
			_exitAR();
			return;
		}
		updateARButtons();
	},
});
const handTracker = new HandTracker({
	video,
	scene,
	camera,
	viewport,
	onStatus: (message) => {
		if (arActive && modelPlaced) cameraStatus.textContent = message;
	},
});
const sculptEngine = new SculptEngine({ root: modelRoot, brushRadius, strength: brushStrength });
const spatialTracker = new SpatialTracker({
	camera,
	renderer,
	viewport: renderer.domElement,
	cameraManager,
	worldAnchorGroup,
	anchorGround,
	modelRoot,
	reticle,
	onStatus: (message) => {
		if (arActive) cameraStatus.textContent = message;
	},
	onModeChange: (mode) => {
		arWalkMode = mode;
		modelPlaced = mode !== PLACE_MODE;
		sculptEngine.enabled = mode === WALK_SCULPT_MODE && sculptEnabled;
		if (mode !== WALK_SCULPT_MODE) handTracker.resetInteraction();
		handTracker.setVisible(mode === WALK_SCULPT_MODE);
		brushIndicator.visible = false;
		updateARButtons();
	},
});

function setStatus(message) {
	statusMessage.textContent = message;
}

function showError(message) {
	errorMessage.textContent = message;
	errorMessage.hidden = false;
}

function clearError() {
	errorMessage.hidden = true;
	errorMessage.textContent = "";
}

function updateModelDetails() {
	if (!mesh) return;
	const faces = mesh.geometry.index
		? mesh.geometry.index.count / 3
		: mesh.geometry.attributes.position.count / 3;
	const label = importedModelName ? "IMPORTED MODEL" : "CLAY FORM";
	meshInfo.textContent = `${label} · ${Math.round(faces).toLocaleString()} FACES`;
	modelLabel.textContent = label;
	document.querySelector(".project-name").textContent = importedModelName || "Untitled form";
	document.querySelector(".project-meta").textContent = importedModelName ? "Imported model" : "Unsaved project";
	document.querySelector(".breadcrumb strong").textContent = importedModelName || "Untitled form";
}

function installModel(nextMesh, name = "") {
	if (mesh) {
		modelRoot.remove(mesh);
		mesh.geometry.dispose();
		mesh.material.dispose();
		originalGeometry?.dispose();
	}
	mesh = nextMesh;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	modelRoot.add(mesh);
	originalGeometry = mesh.geometry.clone();
	originalGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
	importedModelName = name;
	sculptEngine.setMeshes([mesh]);
	updateModelDetails();
}

function setMode(mode) {
	activeMode = mode;
	sculptEngine.mode = mode;
	document.querySelector("#ar-mode-button").textContent = `Tool: ${mode === "raise" ? "Raise" : "Lower"}`;
	document.querySelectorAll(".tool-button").forEach((button) => {
		const selected = button.dataset.mode === mode;
		button.classList.toggle("is-active", selected);
		button.setAttribute("aria-pressed", String(selected));
	});
	setStatus(mode === "raise" ? "Raise tool selected" : "Lower tool selected");
}

function setSculptEnabled(enabled) {
	sculptEnabled = enabled;
	sculptEngine.enabled = arActive
		? arWalkMode === WALK_SCULPT_MODE && enabled
		: enabled;
	for (const button of [document.querySelector("#sculpt-toggle"), document.querySelector("#ar-sculpt-toggle")]) {
		button.setAttribute("aria-pressed", String(enabled));
		button.classList.toggle("is-active", enabled);
		button.querySelector("span")?.replaceChildren(document.createTextNode(enabled ? "ON" : "OFF"));
		if (button.id === "ar-sculpt-toggle") button.textContent = `Sculpt ${enabled ? "ON" : "OFF"}`;
	}
	setStatus(enabled ? "Sculpt mode on" : "Sculpt mode paused");
}

function syncRange(source, targets, output, formatter) {
	for (const target of targets) target.value = source.value;
	if (output) output.value = formatter(Number(source.value));
}

function configureRange(input, targets, output, formatter, callback) {
	const update = () => {
		syncRange(input, targets, output, formatter);
		callback(Number(input.value));
	};
	input.addEventListener("input", update);
	for (const target of targets) target.addEventListener("input", () => {
		input.value = target.value;
		update();
	});
	update();
}

configureRange(radiusInput, [document.querySelector("#ar-brush-size")], document.querySelector("#radius-value"),
	(value) => value.toFixed(3) + " m", (value) => {
		brushRadius = value;
		sculptEngine.brushRadius = value;
		brushIndicator.scale.setScalar(value);
	});
configureRange(strengthInput, [document.querySelector("#ar-brush-strength")], document.querySelector("#strength-value"),
	(value) => value.toFixed(3) + " m", (value) => {
		brushStrength = value;
		sculptEngine.strength = value;
	});
configureRange(depthInput, [document.querySelector("#ar-depth-calibration")], document.querySelector("#depth-value"),
	(value) => value.toFixed(2) + "×", (value) => handTracker.setDepthCalibration(value));

document.querySelectorAll(".tool-button").forEach((button) => {
	button.addEventListener("click", () => setMode(button.dataset.mode));
});
document.querySelector("#sculpt-toggle").addEventListener("click", () => setSculptEnabled(!sculptEnabled));
document.querySelector("#ar-sculpt-toggle").addEventListener("click", () => setSculptEnabled(!sculptEnabled));
document.querySelector("#ar-mode-button").addEventListener("click", () => setMode(activeMode === "raise" ? "lower" : "raise"));

function resetModel() {
	if (!mesh || !originalGeometry) return;
	mesh.geometry.dispose();
	mesh.geometry = originalGeometry.clone();
	mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
	brushIndicator.visible = false;
	setStatus("Shape reset");
}

document.querySelector("#reset-button").addEventListener("click", resetModel);
function openModelPicker() {
	document.querySelector("#model-file").click();
}
document.querySelector("#import-button").addEventListener("click", openModelPicker);
document.querySelector("#ar-import-button").addEventListener("click", openModelPicker);
document.querySelector("#model-file").addEventListener("change", async (event) => {
	const input = event.currentTarget;
	const [file] = input.files;
	if (!file) return;
	clearError();
	setStatus(`Loading ${file.name}`);
	try {
		const loaded = await ModelLoader.load(file);
		installModel(loaded, file.name);
		canvasHelp.classList.add("is-hidden");
		setStatus("Model ready to sculpt");
	} catch (error) {
		console.error("Could not import model:", error);
		showError(error instanceof Error ? error.message : "The model could not be imported.");
		setStatus("Import failed");
	} finally {
		input.value = "";
	}
});

function exportSTL() {
	clearError();
	try {
		const data = ModelLoader.exportSTL(mesh);
		const blob = new Blob([data], { type: "model/stl" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${importedModelName ? importedModelName.replace(/\.[^.]+$/, "") : "clay-sculpt"}.stl`;
		link.click();
		URL.revokeObjectURL(url);
		setStatus("STL exported");
	} catch (error) {
		console.error("Could not export STL:", error);
		showError(error instanceof Error ? error.message : "Could not export the sculpt as STL.");
	}
}

document.querySelector("#export-button").addEventListener("click", exportSTL);
document.querySelector("#ar-export-button").addEventListener("click", exportSTL);

function hitTestPointer(event) {
	const bounds = renderer.domElement.getBoundingClientRect();
	pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
	raycaster.setFromCamera(pointer, camera);
	return raycaster.intersectObject(mesh, false)[0] ?? null;
}

function pointerSculpt(event) {
	const hit = hitTestPointer(event);
	if (!hit) {
		if (!arActive) brushIndicator.visible = false;
		return;
	}
	brushIndicator.position.copy(hit.point);
	brushIndicator.scale.setScalar(brushRadius);
	brushIndicator.visible = true;
	canvasHelp.classList.add("is-hidden");
	if (!sculptEnabled || !event.buttons) return;
	const now = performance.now();
	if (now - lastPointerSculptAt < 25) return;
	lastPointerSculptAt = now;
	const points = Array.from({ length: 9 }, () => new THREE.Vector3(10, 10, 10));
	points[4].copy(hit.point);
	points[8].copy(hit.point).add(new THREE.Vector3(1, 0, 0));
	sculptEngine.update({ hands: [{ points }] });
}

renderer.domElement.addEventListener("pointerdown", (event) => {
	if (arActive || event.button !== 0 || event.altKey || !mesh) return;
	const hit = hitTestPointer(event);
	if (!hit) return;
	controls.enabled = false;
	renderer.domElement.setPointerCapture(event.pointerId);
	pointerSculpt(event);
});
renderer.domElement.addEventListener("pointermove", (event) => {
	if (arActive) return;
	pointerSculpt(event);
});
function endPointerSculpt() {
	controls.enabled = true;
}
renderer.domElement.addEventListener("pointerup", endPointerSculpt);
renderer.domElement.addEventListener("pointercancel", endPointerSculpt);

function updateARButtons(starting = false) {
	document.body.dataset.arMode = arActive ? arSessionMode ?? "" : "";
	arButton.disabled = starting;
	webxrButton.disabled = starting || !nativeXRSupported;
	arButton.textContent = starting ? "Starting…" : arActive ? "Exit Walk-Around" : "Passthrough AR + Hands";
	webxrButton.textContent = starting
		? "Starting…"
		: nativeXRSupported ? "Native XR 6DoF" : "Native XR unavailable";
	arButton.classList.toggle("is-active", arActive);
	webxrButton.classList.toggle("is-active", nativeXRActive);
	webxrButton.hidden = !navigator.xr && !arActive;
	webxrButton.title = nativeXRSupportMessage;
	cameraPlaceButton.hidden = !arActive || arWalkMode !== PLACE_MODE;
	arToolbar.hidden = !arActive;
	walkViewButton.setAttribute("aria-pressed", String(arWalkMode === WALK_VIEW_MODE));
	walkSculptButton.setAttribute("aria-pressed", String(arWalkMode === WALK_SCULPT_MODE));
	walkSculptButton.disabled = !cameraManager.stream || !handTracker.landmarker;
	walkSculptButton.title = walkSculptButton.disabled
		? "Requires direct rear-camera access and MediaPipe hand tracking."
		: "Enable 3D hand collisions and clay sculpting.";
	walkViewButton.disabled = !modelPlaced;
	recenterButton.hidden = !arActive || nativeXRActive || !modelPlaced;
	launchNativeWalkButton.hidden = nativeXRActive || !navigator.xr;
	launchNativeWalkButton.disabled = starting || !nativeXRSupported;
	launchNativeWalkButton.textContent = nativeXRSupported
		? "Native XR 6DoF · camera hands may be unavailable"
		: "Native XR unavailable";
	launchNativeWalkButton.title = `${nativeXRSupportMessage} WebXR may reserve the rear camera, disabling MediaPipe hand tracking.`;
	document.body.classList.toggle("camera-hands", arActive);
	document.body.classList.toggle("native-xr", arActive && nativeXRActive);
}

async function checkNativeXRSupport() {
	if (!navigator.xr?.isSessionSupported) {
		nativeXRSupportMessage = "This browser does not expose immersive WebXR AR.";
		nativeXRSupported = false;
		updateARButtons();
		return;
	}
	try {
		nativeXRSupported = await navigator.xr.isSessionSupported("immersive-ar");
		nativeXRSupportMessage = nativeXRSupported
			? "Start a native immersive WebXR AR session."
			: "This browser or device does not support immersive WebXR AR. Try a compatible ARCore browser/device.";
	} catch (error) {
		console.warn("Could not check immersive WebXR support:", error);
		nativeXRSupported = false;
		nativeXRSupportMessage = "Could not verify immersive WebXR AR support.";
	}
	updateARButtons();
}

async function startAR(useWebXR = false) {
	clearError();
	if (useWebXR && !nativeXRSupported) {
		showError(nativeXRSupportMessage);
		setStatus("Native WebXR unavailable");
		return;
	}
	updateARButtons(true);
	cameraStatus.hidden = false;
	cameraStatus.textContent = useWebXR ? "Starting native WebXR session…" : "Requesting rear camera and motion sensors…";
	setStatus(useWebXR ? "Starting native WebXR walk-around" : "Starting rear-camera walk-around");
	arSessionMode = AR_WALK_MODE;
	let spatialStart = null;
	let directCameraUnavailable = false;
	let handTrackingUnavailable = false;
	try {
		if (useWebXR) {
			if (!navigator.xr) throw new Error("WebXR AR is not available in this browser.");
			await cameraManager.enterWebXR();
		}
		spatialStart = spatialTracker.start({ nativeXR: useWebXR });
		if (!useWebXR && !cameraManager.stream) {
			await cameraManager.startPassthrough();
		} else if (useWebXR && !cameraManager.stream) {
			try {
				await cameraManager.startPassthrough();
			} catch (error) {
				console.warn("Direct rear-camera access is unavailable during WebXR; native walk view remains active.", error);
				directCameraUnavailable = true;
			}
		}
		await spatialStart;
		if (cameraManager.stream && !handTracker.landmarker) {
			cameraStatus.textContent = "Loading MediaPipe hand tracking…";
			try {
				await handTracker.initialize();
				cameraStatus.textContent = handTracker.delegate === "CPU"
					? "MediaPipe ready (CPU fallback). Anchor the model, then choose Walk Sculpt to see hands."
					: "MediaPipe ready. Anchor the model, then choose Walk Sculpt to see hands.";
			} catch (error) {
				console.error("MediaPipe hand tracking could not initialize:", error);
				handTrackingUnavailable = true;
				showError(`AR Walk View is available, but hand tracking could not initialize. ${error instanceof Error ? error.message : ""}`);
			}
		}
		arActive = true;
		nativeXRActive = useWebXR;
		modelPlaced = false;
		worldAnchorGroup.visible = false;
		anchorGround.visible = false;
		ground.visible = false;
		groundGrid.visible = false;
		controls.enabled = false;
		scene.background = null;
		scene.fog = null;
		cameraStatus.textContent = useWebXR
			? directCameraUnavailable
				? "Native XR is for 6DoF inspection. It has reserved the camera, so hand skeletons and sculpting are unavailable. Use Passthrough AR + Hands for sculpting."
				: "Native XR ready. Aim at a surface, then anchor. After placement, choose Walk Sculpt if direct camera access is available."
			: spatialTracker.sensorWarning || "Passthrough AR ready. Move the phone to position the reticle.";
		if (!useWebXR && handTrackingUnavailable) {
			cameraStatus.textContent = "Passthrough AR works, but hand tracking failed to initialize. See the error message.";
		}
		setStatus(useWebXR ? "Native WebXR hit-test ready" : "Passthrough walk-around ready");
		updateARButtons();
	} catch (error) {
		console.error("Could not start AR:", error);
		await cameraManager.stop();
		spatialTracker.stop();
		handTracker.close();
		arActive = false;
		nativeXRActive = false;
		arSessionMode = null;
		worldAnchorGroup.visible = true;
		anchorGround.visible = false;
		ground.visible = true;
		groundGrid.visible = true;
		scene.background = new THREE.Color("#1a1b21");
		scene.fog = new THREE.Fog("#1a1b21", 2.4, 8);
		camera.position.set(0, 0.2, 1.4);
		camera.lookAt(0, 0, 0);
		controls.enabled = true;
		updateARButtons();
		const message = error instanceof DOMException && error.name === "NotAllowedError"
			? "Camera or AR permission was denied. Allow access in browser settings, then try again."
			: error instanceof DOMException && ["NotFoundError", "OverconstrainedError"].includes(error.name)
				? "A rear-facing camera is not available on this device."
				: error instanceof DOMException && error.name === "NotSupportedError"
					? "Native WebXR could not start. This device or browser may lack local-floor or hit-test support."
				: error instanceof Error ? error.message : "Could not start rear-camera AR.";
		showError(message);
		setStatus("AR unavailable");
	}
}

function _exitAR() {
	arActive = false;
	modelPlaced = false;
	nativeXRActive = false;
	arSessionMode = null;
	arWalkMode = null;
	spatialTracker.stop();
	handTracker.close();
	worldAnchorGroup.visible = true;
	ground.visible = true;
	groundGrid.visible = true;
	scene.background = new THREE.Color("#1a1b21");
	scene.fog = new THREE.Fog("#1a1b21", 2.4, 8);
	camera.position.set(0, 0.2, 1.4);
	camera.lookAt(0, 0, 0);
	worldAnchorGroup.position.set(0, 0, 0);
	worldAnchorGroup.quaternion.identity();
	worldAnchorGroup.scale.setScalar(1);
	worldAnchorGroup.matrixAutoUpdate = true;
	modelRoot.position.set(0, 0, 0);
	modelRoot.quaternion.identity();
	controls.enabled = true;
	brushIndicator.visible = false;
	cameraStatus.hidden = true;
	updateARButtons();
}

async function stopAR() {
	await cameraManager.stop();
	_exitAR();
	setStatus("AR ended");
}

arButton.addEventListener("click", () => {
	if (arActive) void stopAR();
	else void startAR();
});
async function launchNativeWalkAround() {
	if (arActive) await stopAR();
	await startAR(true);
}
webxrButton.addEventListener("click", () => void launchNativeWalkAround());
launchNativeWalkButton.addEventListener("click", () => void launchNativeWalkAround());
walkViewButton.addEventListener("click", () => spatialTracker.setMode(WALK_VIEW_MODE));
walkSculptButton.addEventListener("click", () => {
	if (!cameraManager.stream || !handTracker.landmarker) {
		cameraStatus.textContent = "Walk Sculpt needs the direct rear-camera feed and initialized MediaPipe. Exit Native XR and use Passthrough AR + Hands if unavailable.";
		return;
	}
	spatialTracker.setMode(WALK_SCULPT_MODE);
});
recenterButton.addEventListener("click", () => spatialTracker.recenter(0.45));

function placeModel() {
	if (!arActive) return;
	if (!spatialTracker.anchorHere()) return;
	worldAnchorGroup.visible = true;
	cameraStatus.textContent = "Placed in Walk View (inspection only). Tap Walk Sculpt to show the hand skeleton and enable sculpting. Native XR may reserve the camera; use Passthrough AR + Hands for hand sculpting.";
	canvasHelp.classList.add("is-hidden");
	setStatus("Object anchored in world space");
}

cameraPlaceButton.addEventListener("click", placeModel);
window.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
		event.preventDefault();
		document.querySelector("#model-file").click();
	} else if (event.key === "1") {
		setMode("raise");
	} else if (event.key === "2") {
		setMode("lower");
	} else if (event.key === "Escape") {
		if (arActive) void stopAR();
		endPointerSculpt();
	}
});
window.addEventListener("pagehide", () => {
	void cameraManager.stop();
	handTracker.close();
});

function updateHandTracking(time, frame) {
	if (!arActive) return;
	spatialTracker.update(frame);
	if (arWalkMode !== WALK_SCULPT_MODE || !cameraManager.stream || !handTracker.landmarker) {
		handTracker.setVisible(false);
		brushIndicator.visible = false;
		return;
	}
	const trackingCamera = renderer.xr.isPresenting
		? renderer.xr.getCamera(camera).cameras[0] ?? camera
		: camera;
	const result = handTracker.detect(time, trackingCamera);
	if (!result) return;
	const collision = modelPlaced ? sculptEngine.update(result) : { colliding: false, pinching: false };
	handTracker.setColliderState(collision);
	if (result.hands[0]) {
		const tip = result.hands[0].points[8];
		brushIndicator.position.copy(tip);
		brushIndicator.scale.setScalar(brushRadius);
		brushIndicator.visible = modelPlaced && collision.colliding;
		if (collision.sculpted) {
			cameraStatus.textContent = collision.pinching
				? "Pinching — stretching clay."
				: "Finger contact — sculpting clay.";
		}
	} else {
		brushIndicator.visible = false;
	}
}

function resizeRenderer() {
	const { width, height } = viewport.getBoundingClientRect();
	if (!width || !height) return;
	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(viewport);
window.addEventListener("resize", resizeRenderer);
renderer.setAnimationLoop((time, frame) => {
	if (!arActive) controls.update();
	updateHandTracking(time, frame);
	renderer.render(scene, camera);
});

installModel(ModelLoader.createDefault());
resizeRenderer();
updateARButtons();
void checkNativeXRSupport();
