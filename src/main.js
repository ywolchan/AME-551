import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import "./style.css";

const viewport = document.querySelector(".viewport");
const statusMessage = document.querySelector("#status-message");
const errorMessage = document.querySelector("#error-message");
const canvasHelp = document.querySelector("#canvas-help");
const meshInfo = document.querySelector("#mesh-info");
const radiusInput = document.querySelector("#brush-size");
const strengthInput = document.querySelector("#brush-strength");
const arInstructions = document.querySelector("#ar-instructions");
const arPlaceButton = document.querySelector("#ar-place-button");
const cameraHandsButton = document.querySelector("#camera-hands-button");
const arCameraHandsButton = document.querySelector("#ar-camera-hands-button");
const cameraHandsButtons = [cameraHandsButton, arCameraHandsButton];
const handCameraVideo = document.querySelector("#hand-camera-feed");
const handCameraLandmarks = document.querySelector("#hand-camera-landmarks");
const cameraHandStatus = document.querySelector("#camera-hand-status");
const handCameraContext = handCameraLandmarks.getContext("2d");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#1a1b21");
scene.fog = new THREE.Fog("#1a1b21", 6, 12);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(0, 1.25, 4.7);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
renderer.setClearColor(0x000000, 0);
viewport.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.05, 0);
controls.minDistance = 2.2;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.83;

scene.add(new THREE.HemisphereLight("#d9d9e8", "#3b3030", 2.1));

const keyLight = new THREE.DirectionalLight("#ffe0c4", 3.2);
keyLight.position.set(-3, 5, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -3;
keyLight.shadow.camera.right = 3;
keyLight.shadow.camera.top = 3;
keyLight.shadow.camera.bottom = -3;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight("#8e9dc7", 1.7);
fillLight.position.set(4, 1.5, -3);
scene.add(fillLight);

const rimLight = new THREE.PointLight("#d98968", 16, 8);
rimLight.position.set(1.7, 2.4, 1.8);
scene.add(rimLight);

const ground = new THREE.Mesh(
	new THREE.PlaneGeometry(200, 200),
	new THREE.MeshStandardMaterial({ color: "#222329", roughness: 0.84, metalness: 0.05 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.84;
ground.receiveShadow = true;
scene.add(ground);

const groundGrid = new THREE.GridHelper(12, 48, "#454047", "#313139");
groundGrid.position.y = -0.835;
groundGrid.material.transparent = true;
groundGrid.material.opacity = 0.28;
scene.add(groundGrid);

const clayMaterial = new THREE.MeshStandardMaterial({
	color: "#c7775b",
	roughness: 0.78,
	metalness: 0,
});

const brushMaterial = new THREE.MeshBasicMaterial({
	color: "#f0ac8d",
	wireframe: true,
	transparent: true,
	opacity: 0.55,
	depthTest: false,
});
const brushIndicator = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), brushMaterial);
brushIndicator.visible = false;
brushIndicator.renderOrder = 2;
scene.add(brushIndicator);

const placementReticle = new THREE.Mesh(
	new THREE.RingGeometry(0.13, 0.16, 40),
	new THREE.MeshBasicMaterial({ color: "#f4aa88", side: THREE.DoubleSide })
);
placementReticle.geometry.rotateX(-Math.PI / 2);
placementReticle.matrixAutoUpdate = false;
placementReticle.visible = false;
placementReticle.renderOrder = 3;
scene.add(placementReticle);

const sculptRoot = new THREE.Group();
scene.add(sculptRoot);

let sculptMeshes = [];
let originalGeometries = new Map();
let activeMode = "raise";
let brushRadius = Number(radiusInput.value);
let brushStrength = Number(strengthInput.value);
let isPointerSculpting = false;
let lastSculptTime = 0;
let hitTestSource = null;
let hitTestReferenceSpace = null;
let arSession = null;
let arSurfaceFound = false;
let arFallbackPlacementReady = false;
let arPlacementMode = "searching";
let clayPlacedInAR = false;
let arPlacementStartedAt = null;
let savedBackground = scene.background;
let savedFog = scene.fog;
let cameraHandStream = null;
let handLandmarker = null;
let cameraHandsActive = false;
let lastCameraDetectionAt = 0;

const handConnections = [
	[0, 1], [1, 2], [2, 3], [3, 4],
	[0, 5], [5, 6], [6, 7], [7, 8],
	[0, 9], [9, 10], [10, 11], [11, 12],
	[0, 13], [13, 14], [14, 15], [15, 16],
	[0, 17], [17, 18], [18, 19], [19, 20],
	[5, 9], [9, 13], [13, 17],
];

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const worldNormal = new THREE.Vector3();
const worldHit = new THREE.Vector3();
const reticleQuaternion = new THREE.Quaternion();
const localHit = new THREE.Vector3();
const localDirection = new THREE.Vector3();
const localVertex = new THREE.Vector3();
const inverseWorld = new THREE.Matrix4();
const worldScale = new THREE.Vector3();
const hitMeshes = [];

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

function configureSculptableGeometry(geometry) {
	const weldable = new THREE.BufferGeometry();
	weldable.setAttribute("position", geometry.attributes.position.clone());
	if (geometry.index) weldable.setIndex(geometry.index.clone());
	const welded = BufferGeometryUtils.mergeVertices(weldable);
	weldable.dispose();
	geometry.dispose();
	welded.computeVertexNormals();
	welded.attributes.position.setUsage(THREE.DynamicDrawUsage);
	return welded;
}

function setSculptMeshes(meshes, imported = false) {
	for (const mesh of sculptMeshes) {
		if (!meshes.includes(mesh)) mesh.geometry.dispose();
	}
	originalGeometries.forEach((geometry) => geometry.dispose());
	originalGeometries = new Map();
	sculptMeshes = meshes;
	for (const mesh of sculptMeshes) {
		mesh.geometry = configureSculptableGeometry(mesh.geometry);
		mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		originalGeometries.set(mesh, mesh.geometry.clone());
		mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
	}
	updateMeshInfo(imported);
}

function createDefaultClay() {
	const geometry = new THREE.SphereGeometry(0.82, 96, 64);
	const mesh = new THREE.Mesh(geometry, clayMaterial);
	mesh.position.y = 0;
	sculptRoot.add(mesh);
	setSculptMeshes([mesh]);
}

function updateMeshInfo(imported = false) {
	const faces = sculptMeshes.reduce((total, mesh) => {
		const position = mesh.geometry.attributes.position;
		return total + (mesh.geometry.index ? mesh.geometry.index.count : position.count) / 3;
	}, 0);
	const label = imported ? "IMPORTED MODEL" : "CLAY FORM";
	meshInfo.textContent = `${label} · ${Math.round(faces).toLocaleString()} FACES`;
	document.querySelector("#model-label").textContent = label;
}

function resetClay() {
	for (const [mesh, geometry] of originalGeometries) {
		mesh.geometry.dispose();
		mesh.geometry = geometry.clone();
		mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
	}
	brushIndicator.visible = false;
	setStatus("Shape reset");
}

function refreshBrushIndicator() {
	brushIndicator.scale.setScalar(brushRadius);
}

function sculptAt(worldPosition, direction, mode = activeMode) {
	if (!sculptMeshes.length) return;
	const displacement = mode === "lower" ? -brushStrength : brushStrength;

	for (const mesh of sculptMeshes) {
		mesh.updateWorldMatrix(true, false);
		inverseWorld.copy(mesh.matrixWorld).invert();
		localHit.copy(mesh.worldToLocal(worldPosition.clone()));
		localDirection.copy(direction).transformDirection(inverseWorld);
		mesh.getWorldScale(worldScale);
		const averageScale = (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3;
		const radius = brushRadius / Math.max(averageScale, 0.0001);
		const localStrength = displacement / Math.max(averageScale, 0.0001);
		const radiusSquared = radius * radius;
		const position = mesh.geometry.attributes.position;
		let changed = false;

		for (let index = 0; index < position.count; index += 1) {
			localVertex.fromBufferAttribute(position, index);
			const distanceSquared = localVertex.distanceToSquared(localHit);
			if (distanceSquared >= radiusSquared) continue;

			const distance = Math.sqrt(distanceSquared);
			const weight = Math.pow(1 - distance / radius, 2);
			localVertex.addScaledVector(localDirection, localStrength * weight);
			position.setXYZ(index, localVertex.x, localVertex.y, localVertex.z);
			changed = true;
		}

		if (changed) {
			position.needsUpdate = true;
			mesh.geometry.computeVertexNormals();
			mesh.geometry.computeBoundingSphere();
		}
	}
}

function updatePointer(event) {
	const bounds = renderer.domElement.getBoundingClientRect();
	pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
	pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
	raycaster.setFromCamera(pointer, camera);
	hitMeshes.length = 0;
	for (const mesh of sculptMeshes) hitMeshes.push(mesh);
	const hits = raycaster.intersectObjects(hitMeshes, false);
	if (!hits.length) return null;

	const hit = hits[0];
	worldHit.copy(hit.point);
	worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
	brushIndicator.position.copy(worldHit);
	brushIndicator.scale.setScalar(brushRadius);
	brushIndicator.visible = true;
	canvasHelp.classList.add("is-hidden");
	return hit;
}

renderer.domElement.addEventListener("pointerdown", (event) => {
	if (event.button !== 0 || renderer.xr.isPresenting || event.altKey || event.shiftKey) return;
	const hit = updatePointer(event);
	if (!hit) return;
	isPointerSculpting = true;
	renderer.domElement.setPointerCapture(event.pointerId);
	controls.enabled = false;
	sculptAt(worldHit, worldNormal);
	setStatus(activeMode === "raise" ? "Raising clay" : "Lowering clay");
});

renderer.domElement.addEventListener("pointermove", (event) => {
	const hit = updatePointer(event);
	if (hit && isPointerSculpting) {
		worldHit.copy(hit.point);
		worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
		sculptAt(worldHit, worldNormal);
	}
});

function endPointerSculpt() {
	if (!isPointerSculpting) return;
	isPointerSculpting = false;
	controls.enabled = true;
	setStatus("Ready to sculpt");
}

renderer.domElement.addEventListener("pointerup", endPointerSculpt);
renderer.domElement.addEventListener("pointercancel", endPointerSculpt);
renderer.domElement.addEventListener("pointerleave", (event) => {
	if (!isPointerSculpting && !renderer.domElement.hasPointerCapture(event.pointerId)) {
		brushIndicator.visible = false;
	}
});

function setMode(mode) {
	activeMode = mode;
	document.querySelectorAll(".tool-button").forEach((button) => {
		const selected = button.dataset.mode === mode;
		button.classList.toggle("is-active", selected);
		button.setAttribute("aria-pressed", String(selected));
	});
	setStatus(mode === "raise" ? "Raise tool selected" : "Lower tool selected");
}

document.querySelectorAll(".tool-button").forEach((button) => {
	button.addEventListener("click", () => setMode(button.dataset.mode));
});

radiusInput.addEventListener("input", () => {
	brushRadius = Number(radiusInput.value);
	document.querySelector("#radius-value").value = brushRadius.toFixed(2);
	radiusInput.style.background = `linear-gradient(to right, #d88767 ${((brushRadius - Number(radiusInput.min)) / (Number(radiusInput.max) - Number(radiusInput.min))) * 100}%, #373943 0)`;
	refreshBrushIndicator();
});

strengthInput.addEventListener("input", () => {
	brushStrength = Number(strengthInput.value);
	document.querySelector("#strength-value").value = brushStrength.toFixed(3);
	strengthInput.style.background = `linear-gradient(to right, #d88767 ${((brushStrength - Number(strengthInput.min)) / (Number(strengthInput.max) - Number(strengthInput.min))) * 100}%, #373943 0)`;
});

document.querySelector("#reset-button").addEventListener("click", resetClay);
document.querySelector("#import-button").addEventListener("click", () => {
	document.querySelector("#model-file").click();
});

function normalizeImportedModel(root) {
	root.updateWorldMatrix(true, true);
	const bounds = new THREE.Box3().setFromObject(root);
	if (bounds.isEmpty()) throw new Error("The selected file does not contain any mesh geometry.");
	const center = bounds.getCenter(new THREE.Vector3());
	const size = bounds.getSize(new THREE.Vector3());
	const largestDimension = Math.max(size.x, size.y, size.z);
	if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
		throw new Error("The selected model has no measurable dimensions.");
	}

	const fitScale = 1.65 / largestDimension;
	const placement = new THREE.Group();
	placement.scale.setScalar(fitScale);
	placement.position.set(-center.x * fitScale, -center.y * fitScale, -center.z * fitScale);
	placement.add(root);
	placement.position.y += 0.15;
	sculptRoot.add(placement);

	const meshes = [];
	root.traverse((object) => {
		if (!object.isMesh || !object.geometry?.attributes?.position) return;
		object.material = clayMaterial;
		meshes.push(object);
	});
	if (!meshes.length) {
		sculptRoot.remove(placement);
		throw new Error("No sculptable mesh was found in the selected file.");
	}
	return meshes;
}

async function loadModel(file) {
	clearError();
	setStatus(`Loading ${file.name}`);
	const extension = file.name.split(".").pop()?.toLowerCase();
	let root;
	if (extension === "stl") {
		const geometry = new STLLoader().parse(await file.arrayBuffer());
		root = new THREE.Mesh(geometry, clayMaterial);
	} else if (extension === "obj") {
		root = new OBJLoader().parse(await file.text());
	} else if (extension === "3mf") {
		root = new ThreeMFLoader().parse(await file.arrayBuffer());
	} else {
		throw new Error("Choose a supported .stl, .obj, or .3mf model.");
	}

	const imported = normalizeImportedModel(root);
	setSculptMeshes(imported, true);
	document.querySelector(".project-name").textContent = file.name;
	document.querySelector(".project-meta").textContent = "Imported model";
	document.querySelector(".breadcrumb strong").textContent = file.name;
	setStatus("Model ready to sculpt");
	canvasHelp.classList.add("is-hidden");
}

document.querySelector("#model-file").addEventListener("change", async (event) => {
	const input = event.currentTarget;
	const [file] = input.files;
	if (!file) return;
	try {
		for (const child of [...sculptRoot.children]) {
			sculptRoot.remove(child);
		}
		await loadModel(file);
	} catch (error) {
		console.error("Could not import model:", error);
		showError(error instanceof Error ? error.message : "The model could not be imported.");
		setStatus("Import failed");
		createDefaultClay();
		document.querySelector(".project-name").textContent = "Untitled form";
		document.querySelector(".project-meta").textContent = "Unsaved project";
		document.querySelector(".breadcrumb strong").textContent = "Untitled form";
	} finally {
		input.value = "";
	}
});

function updateARPlacementAvailability(found, fallbackReady = false) {
	const mode = clayPlacedInAR ? "placed" : found ? "surface" : fallbackReady ? "fallback" : "searching";
	arSurfaceFound = mode === "surface";
	arFallbackPlacementReady = mode === "fallback";
	arPlaceButton.disabled = mode !== "surface" && mode !== "fallback";
	if (mode === arPlacementMode) return;
	arPlacementMode = mode;

	arPlaceButton.textContent = mode === "surface"
		? "Place clay"
		: mode === "fallback"
			? "Place clay ahead"
			: mode === "placed"
				? "Clay placed"
				: "Scanning...";
	if (mode !== "placed") {
		arInstructions.textContent = mode === "surface"
			? "Surface found. Tap Place clay."
			: mode === "fallback"
				? "No surface detected yet. You can place clay about one meter in front of you."
				: "Move your phone slowly to find a surface.";
	}
}

function placeClayAtReticle() {
	if (arSurfaceFound && placementReticle.visible) {
		placementReticle.matrix.decompose(worldHit, reticleQuaternion, worldScale);
	} else if (arFallbackPlacementReady) {
		const xrCamera = renderer.xr.getCamera(camera);
		xrCamera.updateWorldMatrix(true, false);
		xrCamera.getWorldPosition(worldHit);
		xrCamera.getWorldQuaternion(reticleQuaternion);
		worldNormal.set(0, 0, -1).applyQuaternion(reticleQuaternion);
		worldNormal.y = 0;
		if (worldNormal.lengthSq() < 0.000001) worldNormal.set(0, 0, -1);
		worldNormal.normalize();
		worldHit.addScaledVector(worldNormal, 1);
		worldHit.y = Math.max(0.35, worldHit.y - 0.85);
		reticleQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-worldNormal.x, -worldNormal.z));
	} else {
		return;
	}

	sculptRoot.quaternion.copy(reticleQuaternion);
	sculptRoot.scale.setScalar(0.28);
	if (arSurfaceFound && placementReticle.visible) {
		worldNormal.set(0, 1, 0).applyQuaternion(reticleQuaternion).normalize();
		worldHit.addScaledVector(worldNormal, 0.82 * 0.28);
	}
	sculptRoot.position.copy(worldHit);
	sculptRoot.visible = true;
	clayPlacedInAR = true;
	updateARPlacementAvailability(false);
	arInstructions.textContent = "Clay placed. Tap the clay to sculpt.";
	setStatus("Clay placed in AR");
}

const xrController = renderer.xr.getController(0);
scene.add(xrController);
xrController.addEventListener("select", () => {
	if (!clayPlacedInAR) {
		placeClayAtReticle();
		return;
	}

	raycaster.setFromXRController(xrController);
	hitMeshes.length = 0;
	for (const mesh of sculptMeshes) hitMeshes.push(mesh);
	const [hit] = raycaster.intersectObjects(hitMeshes, false);
	if (!hit) return;
	worldHit.copy(hit.point);
	worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
	sculptAt(worldHit, worldNormal);
	setStatus(activeMode === "raise" ? "Raising clay" : "Lowering clay");
});

arPlaceButton.addEventListener("click", placeClayAtReticle);

window.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
		event.preventDefault();
		document.querySelector("#model-file").click();
	} else if (event.key === "1") {
		setMode("raise");
	} else if (event.key === "2") {
		setMode("lower");
	} else if (event.key === "Escape") {
		endPointerSculpt();
	}
});

function cameraPointForLandmark(landmark) {
	const bounds = viewport.getBoundingClientRect();
	const videoWidth = handCameraVideo.videoWidth;
	const videoHeight = handCameraVideo.videoHeight;
	if (!bounds.width || !bounds.height || !videoWidth || !videoHeight) return null;

	const scale = Math.max(bounds.width / videoWidth, bounds.height / videoHeight);
	const displayedWidth = videoWidth * scale;
	const displayedHeight = videoHeight * scale;
	return {
		x: landmark.x * displayedWidth - (displayedWidth - bounds.width) / 2,
		y: landmark.y * displayedHeight - (displayedHeight - bounds.height) / 2,
	};
}

function drawCameraHandLandmarks(hands) {
	const bounds = viewport.getBoundingClientRect();
	handCameraContext.clearRect(0, 0, bounds.width, bounds.height);
	handCameraContext.lineWidth = 2;
	handCameraContext.strokeStyle = "#69f1d8";
	handCameraContext.fillStyle = "#a8ffed";

	for (const landmarks of hands) {
		const points = landmarks.map(cameraPointForLandmark);
		handCameraContext.beginPath();
		for (const [start, end] of handConnections) {
			const startPoint = points[start];
			const endPoint = points[end];
			if (!startPoint || !endPoint) continue;
			handCameraContext.moveTo(startPoint.x, startPoint.y);
			handCameraContext.lineTo(endPoint.x, endPoint.y);
		}
		handCameraContext.stroke();

		for (const index of [4, 8]) {
			const point = points[index];
			if (!point) continue;
			handCameraContext.beginPath();
			handCameraContext.arc(point.x, point.y, 5, 0, Math.PI * 2);
			handCameraContext.fill();
		}
	}
}

function raycastCameraHand(point) {
	const bounds = renderer.domElement.getBoundingClientRect();
	pointer.set((point.x / bounds.width) * 2 - 1, -(point.y / bounds.height) * 2 + 1);
	raycaster.setFromCamera(pointer, camera);
	hitMeshes.length = 0;
	for (const mesh of sculptMeshes) hitMeshes.push(mesh);
	return raycaster.intersectObjects(hitMeshes, false)[0] ?? null;
}

function updateCameraHandTracking(time) {
	if (!cameraHandsActive || !handLandmarker || handCameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
	if (time - lastCameraDetectionAt < 75) return;
	lastCameraDetectionAt = time;

	try {
		const result = handLandmarker.detectForVideo(handCameraVideo, time);
		const detectedHands = result.landmarks ?? [];
		drawCameraHandLandmarks(detectedHands);
		if (!detectedHands.length) {
			brushIndicator.visible = false;
			cameraHandStatus.textContent = "Show your hand to the rear camera.";
			return;
		}

		const landmarks = detectedHands[0];
		const thumbTip = landmarks[4];
		const indexTip = landmarks[8];
		const isPinching = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) < 0.06;
		const handPoint = cameraPointForLandmark(isPinching
			? { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 }
			: indexTip);
		if (!handPoint) return;

		const hit = raycastCameraHand(handPoint);
		if (hit) {
			worldHit.copy(hit.point);
			worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
			brushIndicator.position.copy(worldHit);
			brushIndicator.scale.setScalar(brushRadius);
			brushIndicator.visible = true;
			canvasHelp.classList.add("is-hidden");
			if (isPinching) {
				sculptAt(worldHit, worldNormal);
				cameraHandStatus.textContent = "Pinching to sculpt · release to stop.";
				setStatus(activeMode === "raise" ? "Raising clay with hand tracking" : "Lowering clay with hand tracking");
			} else {
				cameraHandStatus.textContent = "Pinch thumb and index finger over the clay to sculpt.";
			}
		} else {
			brushIndicator.visible = false;
			cameraHandStatus.textContent = isPinching
				? "Move your pinch over the clay to sculpt."
				: "Move your index fingertip over the clay, then pinch to sculpt.";
		}
	} catch (error) {
		console.error("Camera hand tracking failed:", error);
		stopCameraHands();
		showError(error instanceof Error ? `Camera hand tracking stopped: ${error.message}` : "Camera hand tracking stopped unexpectedly.");
		setStatus("Camera hand tracking stopped");
	}
}

function stopCameraHands() {
	cameraHandsActive = false;
	handLandmarker?.close();
	handLandmarker = null;
	cameraHandStream?.getTracks().forEach((track) => track.stop());
	cameraHandStream = null;
	handCameraVideo.pause();
	handCameraVideo.srcObject = null;
	handCameraContext.clearRect(0, 0, handCameraLandmarks.width, handCameraLandmarks.height);
	document.body.classList.remove("camera-hands");
	cameraHandStatus.hidden = true;
	brushIndicator.visible = false;
	if (!renderer.xr.isPresenting) {
		ground.visible = true;
		groundGrid.visible = true;
		scene.background = savedBackground;
		scene.fog = savedFog;
	}
	controls.enabled = !renderer.xr.isPresenting;
	updateCameraHandsButtons(false);
}

function updateCameraHandsButtons(isStarting) {
	for (const button of cameraHandsButtons) {
		button.disabled = isStarting;
		button.textContent = isStarting
			? "Starting camera…"
			: cameraHandsActive
				? "Stop camera"
				: renderer.xr.isPresenting && button === arCameraHandsButton
					? "Exit AR for Camera hands"
					: "Camera hands";
		button.classList.toggle("is-active", cameraHandsActive);
	}
}

async function startCameraHands() {
	if (renderer.xr.isPresenting) {
		showError("Exit AR before starting rear-camera hand tracking.");
		return;
	}
	if (!navigator.mediaDevices?.getUserMedia) {
		showError("Camera access requires a secure HTTPS connection and a browser with getUserMedia support.");
		return;
	}

	updateCameraHandsButtons(true);
	clearError();
	cameraHandStatus.hidden = false;
	cameraHandStatus.textContent = "Requesting rear-camera access for hand tracking…";
	setStatus("Requesting camera access");
	try {
		cameraHandStream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				facingMode: { exact: "environment" },
				width: { ideal: 640 },
				height: { ideal: 480 },
				frameRate: { ideal: 24, max: 30 },
			},
		});
		handCameraVideo.srcObject = cameraHandStream;
		await handCameraVideo.play();
		document.body.classList.add("camera-hands");
		controls.enabled = false;
		scene.background = null;
		scene.fog = null;
		ground.visible = false;
		groundGrid.visible = false;
		cameraHandStatus.textContent = "Loading hand tracking…";
		setStatus("Loading hand-tracking model");

		const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
		const vision = await FilesetResolver.forVisionTasks(
			"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm",
		);
		handLandmarker = await HandLandmarker.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
			},
			runningMode: "VIDEO",
			numHands: 2,
			minHandDetectionConfidence: 0.55,
			minHandPresenceConfidence: 0.55,
			minTrackingConfidence: 0.5,
		});
		cameraHandsActive = true;
		lastCameraDetectionAt = 0;
		updateCameraHandsButtons(false);
		cameraHandStatus.textContent = "Show your hand to the rear camera.";
		setStatus("Rear-camera hand tracking ready");
	} catch (error) {
		console.error("Could not start camera hand tracking:", error);
		stopCameraHands();
		const message = error instanceof DOMException && error.name === "NotAllowedError"
			? "Camera permission was denied. Allow camera access in your browser settings, then try again."
			: error instanceof DOMException && ["NotFoundError", "OverconstrainedError"].includes(error.name)
				? "A rear camera is not available in this browser or device."
				: error instanceof DOMException && ["NotReadableError", "AbortError"].includes(error.name)
					? "The rear camera could not start. Exit AR or close other camera apps, then try again."
					: error instanceof Error
						? error.message
						: "Could not start camera hand tracking.";
		showError(message);
		setStatus("Camera hand tracking unavailable");
	}
}

function toggleCameraHands() {
	if (cameraHandsActive) {
		stopCameraHands();
		setStatus("Camera hand tracking stopped");
		return;
	}
	startCameraHands();
}

cameraHandsButton.addEventListener("click", toggleCameraHands);
arCameraHandsButton.addEventListener("click", () => {
	if (renderer.xr.isPresenting) {
		setStatus("Exit AR, then start Camera hands with the rear camera");
		arSession?.end();
		return;
	}
	toggleCameraHands();
});
window.addEventListener("pagehide", stopCameraHands);

const xrButton = document.createElement("button");
xrButton.type = "button";
xrButton.textContent = "Place in AR";
xrButton.addEventListener("click", async () => {
	if (arSession) {
		await arSession.end();
		return;
	}
	if (cameraHandsActive || cameraHandStream) stopCameraHands();
	clearError();
	try {
		if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar"))) {
			throw new Error("Immersive AR is not available in this browser. Try Chrome on an ARCore-supported device.");
		}
		const session = await navigator.xr.requestSession("immersive-ar", {
			optionalFeatures: ["hit-test", "local-floor", "dom-overlay"],
			domOverlay: { root: document.body },
		});
		arSession = session;
		await renderer.xr.setSession(session);
	} catch (error) {
		console.error("Could not start an AR session:", error);
		showError(error instanceof Error ? error.message : "Could not start an AR session.");
		setStatus("AR could not start");
	}
});
document.querySelector("#xr-button-container").append(xrButton);
renderer.xr.addEventListener("sessionstart", async () => {
	controls.enabled = false;
	document.documentElement.classList.add("xr-ar");
	document.body.classList.add("xr-ar");
	updateCameraHandsButtons(false);
	scene.background = null;
	scene.fog = null;
	renderer.setClearColor(0x000000, 0);
	renderer.setClearAlpha(0);
	ground.visible = false;
	groundGrid.visible = false;
	sculptRoot.visible = false;
	clayPlacedInAR = false;
	arSurfaceFound = false;
	arFallbackPlacementReady = false;
	arPlacementMode = "searching";
	arPlacementStartedAt = performance.now();
	placementReticle.visible = false;
	arPlaceButton.textContent = "Place clay";
	arInstructions.textContent = "Scanning for a surface. Exit AR to use Camera hands.";
	updateARPlacementAvailability(false);
	setStatus("Scanning for a surface");
	canvasHelp.classList.add("is-hidden");
	try {
		hitTestReferenceSpace = await arSession.requestReferenceSpace("viewer");
		hitTestSource = await arSession.requestHitTestSource({ space: hitTestReferenceSpace });
	} catch (error) {
		console.error("Could not start AR surface detection:", error);
		showError(error instanceof Error ? error.message : "Could not start surface detection.");
		setStatus("Surface detection unavailable");
	}
});
renderer.xr.addEventListener("sessionend", () => {
	hitTestSource?.cancel();
	hitTestSource = null;
	hitTestReferenceSpace = null;
	arSession = null;
	arPlacementStartedAt = null;
	arSurfaceFound = false;
	arFallbackPlacementReady = false;
	arPlacementMode = "searching";
	controls.enabled = true;
	document.documentElement.classList.remove("xr-ar");
	document.body.classList.remove("xr-ar");
	updateCameraHandsButtons(false);
	scene.background = savedBackground;
	scene.fog = savedFog;
	renderer.setClearColor(0x000000, 0);
	renderer.setClearAlpha(0);
	ground.visible = true;
	groundGrid.visible = true;
	sculptRoot.visible = true;
	sculptRoot.position.set(0, 0, 0);
	sculptRoot.quaternion.identity();
	sculptRoot.scale.setScalar(1);
	placementReticle.visible = false;
	brushIndicator.visible = false;
	setStatus("Ready to sculpt");
});

function resizeRenderer() {
	const { width, height } = viewport.getBoundingClientRect();
	if (!width || !height) return;
	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
	handCameraLandmarks.width = Math.round(width * pixelRatio);
	handCameraLandmarks.height = Math.round(height * pixelRatio);
	handCameraContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(viewport);
window.addEventListener("resize", resizeRenderer);
resizeRenderer();
createDefaultClay();

renderer.setAnimationLoop((time) => {
	if (!renderer.xr.isPresenting) controls.update();
	if (renderer.xr.isPresenting && hitTestSource) {
		const frame = renderer.xr.getFrame();
		const referenceSpace = renderer.xr.getReferenceSpace();
		const [hit] = frame?.getHitTestResults(hitTestSource) ?? [];
		const pose = hit?.getPose(referenceSpace);
		if (pose) {
			placementReticle.matrix.fromArray(pose.transform.matrix);
			placementReticle.matrixWorldNeedsUpdate = true;
			placementReticle.visible = !clayPlacedInAR;
			updateARPlacementAvailability(!clayPlacedInAR);
		} else if (!clayPlacedInAR && arSurfaceFound) {
			placementReticle.visible = false;
			updateARPlacementAvailability(false);
		}
	}
	if (
		renderer.xr.isPresenting &&
		!clayPlacedInAR &&
		!arSurfaceFound &&
		arPlacementStartedAt !== null &&
		performance.now() - arPlacementStartedAt > 4000
	) {
		updateARPlacementAvailability(false, true);
	}
	updateCameraHandTracking(time);
	renderer.render(scene, camera);
});
