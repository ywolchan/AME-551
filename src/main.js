import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
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
const handTrackingStatus = document.querySelector("#hand-tracking-status");
const arPlaceButton = document.querySelector("#ar-place-button");

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
let handTrackingStartedAt = null;
let lastHandTrackingMessage = "";
let savedBackground = scene.background;
let savedFog = scene.fog;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const worldNormal = new THREE.Vector3();
const worldCenter = new THREE.Vector3();
const worldHit = new THREE.Vector3();
const reticleQuaternion = new THREE.Quaternion();
const localHit = new THREE.Vector3();
const localDelta = new THREE.Vector3();
const localDirection = new THREE.Vector3();
const localVertex = new THREE.Vector3();
const inverseWorld = new THREE.Matrix4();
const inverseLinear = new THREE.Matrix3();
const worldScale = new THREE.Vector3();
const pullDelta = new THREE.Vector3();
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

function pullSurface(mesh, localAnchor, worldDisplacement) {
	mesh.updateWorldMatrix(true, false);
	inverseWorld.copy(mesh.matrixWorld).invert();
	inverseLinear.setFromMatrix4(inverseWorld);
	localDelta.copy(worldDisplacement).applyMatrix3(inverseLinear);
	mesh.getWorldScale(worldScale);
	const averageScale = (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3;
	const radius = brushRadius / Math.max(averageScale, 0.0001);
	const radiusSquared = radius * radius;
	const position = mesh.geometry.attributes.position;
	let changed = false;

	for (let index = 0; index < position.count; index += 1) {
		localVertex.fromBufferAttribute(position, index);
		const distanceSquared = localVertex.distanceToSquared(localAnchor);
		if (distanceSquared >= radiusSquared) continue;

		const distance = Math.sqrt(distanceSquared);
		const weight = Math.pow(1 - distance / radius, 2);
		localVertex.addScaledVector(localDelta, weight);
		position.setXYZ(index, localVertex.x, localVertex.y, localVertex.z);
		changed = true;
	}

	if (changed) {
		position.needsUpdate = true;
		mesh.geometry.computeVertexNormals();
		mesh.geometry.computeBoundingSphere();
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
	arInstructions.textContent = "Clay placed. Tap it to sculpt, or touch it with a fingertip, pinch, then pull.";
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

function worldJointPosition(joint, destination) {
	if (!joint || !joint.visible) return false;
	joint.getWorldPosition(destination);
	return true;
}

const fingerChains = [
	["wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
	["wrist", "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
	["wrist", "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
	["wrist", "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
	["wrist", "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
];
const fingerTips = [
	["thumb-tip", "thumb-phalanx-distal"],
	["index-finger-tip", "index-finger-phalanx-distal"],
	["middle-finger-tip", "middle-finger-phalanx-distal"],
	["ring-finger-tip", "ring-finger-phalanx-distal"],
	["pinky-finger-tip", "pinky-finger-phalanx-distal"],
];
const allJointNames = [...new Set(fingerChains.flat())];
const gloveMaterial = new THREE.MeshBasicMaterial({
	color: "#ffb454",
	toneMapped: false,
	depthTest: false,
	depthWrite: false,
});
const jointMarkerMaterial = new THREE.MeshBasicMaterial({
	color: "#39efff",
	toneMapped: false,
	depthTest: false,
	depthWrite: false,
});
const jointMarkerGeometry = new THREE.SphereGeometry(1, 12, 10);
const gloveLinkGeometry = new THREE.CylinderGeometry(0.82, 1, 1, 10);
const glovePalmGeometry = new THREE.SphereGeometry(1, 20, 14);
const gloveUp = new THREE.Vector3(0, 1, 0);
const handModelFactory = new XRHandModelFactory();

function createGlove(hand) {
	const group = new THREE.Group();
	const links = [];
	const localJoints = new Map();
	const jointMarkers = new Map();
	const palm = new THREE.Mesh(glovePalmGeometry, gloveMaterial);
	palm.scale.set(0.045, 0.018, 0.06);
	group.add(palm);

	for (const chain of fingerChains) {
		for (let index = 0; index < chain.length - 1; index += 1) {
			const link = new THREE.Mesh(gloveLinkGeometry, gloveMaterial);
			link.visible = false;
			group.add(link);
			links.push({ mesh: link, start: chain[index], end: chain[index + 1] });
		}
	}

	const handModel = handModelFactory.createHandModel(hand, "spheres");
	hand.add(handModel);
	hand.addEventListener("connected", () => {
		const handMesh = handModel.motionController?.handMesh;
		if (!handMesh) return;
		handMesh.material = gloveMaterial;
		handMesh.frustumCulled = false;
		handMesh.renderOrder = 20;
	});

	hand.add(group);
	return { hand, group, links, localJoints, jointMarkers, palm, pull: null };
}

function updateGlove(glove) {
	glove.hand.updateWorldMatrix(true, true);
	glove.localJoints.clear();

	for (const name of allJointNames) {
		const joint = glove.hand.joints?.[name];
		if (!worldJointPosition(joint, worldHit)) {
			continue;
		}

		const localPosition = joint.position.clone();
		glove.localJoints.set(name, localPosition);

		let marker = glove.jointMarkers.get(name);
		if (!marker) {
			marker = new THREE.Mesh(jointMarkerGeometry, jointMarkerMaterial);
			marker.renderOrder = 21;
			marker.position.set(0, 0, 0);
			joint.add(marker);
			glove.jointMarkers.set(name, marker);
		}
		const radius = joint.jointRadius || (name === "wrist" ? 0.018 : 0.011);
		marker.scale.setScalar(radius * 1.7);
	}

	for (const { mesh, start, end } of glove.links) {
		const startPosition = glove.localJoints.get(start);
		const endPosition = glove.localJoints.get(end);
		if (!startPosition || !endPosition) {
			mesh.visible = false;
			continue;
		}

		const direction = endPosition.clone().sub(startPosition);
		const length = direction.length();
		if (length < 0.001) {
			mesh.visible = false;
			continue;
		}
		mesh.position.copy(startPosition).add(endPosition).multiplyScalar(0.5);
		mesh.scale.set(0.009, length, 0.009);
		mesh.quaternion.setFromUnitVectors(gloveUp, direction.normalize());
		mesh.renderOrder = 20;
		mesh.visible = true;
	}

	const wrist = glove.localJoints.get("wrist");
	const indexMcp = glove.localJoints.get("index-finger-metacarpal");
	const middleMcp = glove.localJoints.get("middle-finger-metacarpal");
	const pinkyMcp = glove.localJoints.get("pinky-finger-metacarpal");
	if (wrist && indexMcp && middleMcp && pinkyMcp) {
		const acrossPalm = new THREE.Vector3().subVectors(indexMcp, pinkyMcp);
		const towardFingers = new THREE.Vector3().subVectors(middleMcp, wrist);
		if (acrossPalm.lengthSq() > 0.000001 && towardFingers.lengthSq() > 0.000001) {
			const xAxis = acrossPalm.normalize();
			const yAxis = towardFingers.addScaledVector(xAxis, -towardFingers.dot(xAxis)).normalize();
			const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
			yAxis.crossVectors(zAxis, xAxis).normalize();
			const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
			glove.palm.position.copy(wrist).add(indexMcp).add(pinkyMcp).multiplyScalar(1 / 3);
			glove.palm.quaternion.setFromRotationMatrix(basis);
			glove.palm.scale.set(acrossPalm.length() * 0.56, towardFingers.length() * 0.48, 0.019);
			glove.palm.visible = true;
		}
	} else {
		glove.palm.visible = false;
	}
}

function findHandSurfaceContact(hand) {
	hitMeshes.length = 0;
	for (const mesh of sculptMeshes) hitMeshes.push(mesh);
	const origin = new THREE.Vector3();
	const direction = new THREE.Vector3();

	for (const [tipName, distalName] of fingerTips) {
		const tip = hand.joints?.[tipName];
		const distal = hand.joints?.[distalName];
		if (!worldJointPosition(distal, origin) || !worldJointPosition(tip, worldCenter)) continue;
		direction.copy(worldCenter).sub(origin);
		if (direction.lengthSq() < 0.000001) continue;
		const segmentLength = direction.length();
		raycaster.set(origin, direction.normalize());
		raycaster.near = 0;
		raycaster.far = segmentLength + 0.015;
		const [hit] = raycaster.intersectObjects(hitMeshes, false);
		if (hit) {
			raycaster.far = Infinity;
			return { mesh: hit.object, point: hit.point.clone() };
		}
	}
	raycaster.far = Infinity;
	return null;
}

const hands = [0, 1].map((index) => {
	const hand = renderer.xr.getHand(index);
	scene.add(hand);
	return createGlove(hand);
});

function updateHands(time) {
	if (!renderer.xr.isPresenting) return;
	let isPulling = false;
	let isTouching = false;
	let trackedJointCount = 0;
	let trackedHandCount = 0;
	brushIndicator.visible = false;

	for (const glove of hands) {
		updateGlove(glove);
		const visibleJointCount = allJointNames.filter((name) => glove.hand.joints?.[name]?.visible).length;
		trackedJointCount += visibleJointCount;
		if (visibleJointCount > 0) trackedHandCount += 1;
		if (!clayPlacedInAR) {
			glove.pull = null;
			continue;
		}

		const indexTip = glove.hand.joints?.["index-finger-tip"];
		const thumbTip = glove.hand.joints?.["thumb-tip"];
		if (!worldJointPosition(indexTip, worldHit) || !worldJointPosition(thumbTip, worldCenter)) {
			glove.pull = null;
			continue;
		}

		const pinchCenter = worldHit.clone().add(worldCenter).multiplyScalar(0.5);
		const pinching = worldHit.distanceTo(worldCenter) < 0.045;
		const contact = findHandSurfaceContact(glove.hand);

		if (pinching && contact && !glove.pull) {
			glove.pull = {
				mesh: contact.mesh,
				anchor: contact.mesh.worldToLocal(contact.point.clone()),
				previousPinch: pinchCenter.clone(),
				lastPullTime: 0,
			};
		}

		if (glove.pull && pinching) {
			if (time - glove.pull.lastPullTime >= 30) {
				pullDelta.copy(pinchCenter).sub(glove.pull.previousPinch).clampLength(0, 0.08);
				if (pullDelta.lengthSq() > 0.000001) {
					pullSurface(glove.pull.mesh, glove.pull.anchor, pullDelta);
					glove.pull.previousPinch.copy(pinchCenter);
					glove.pull.lastPullTime = time;
				}
			}
			isPulling = true;
		} else {
			if (glove.pull) glove.pull = null;
			if (contact) {
				brushIndicator.position.copy(contact.point);
				brushIndicator.scale.setScalar(0.045);
				brushIndicator.visible = true;
				isTouching = true;
			}
		}
	}

	const inputHandCount = Array.from(arSession?.inputSources ?? [])
		.filter((inputSource) => inputSource.hand).length;
	let trackingMessage = "Hand tracking: checking...";
	if (trackedJointCount > 0) {
		trackingMessage = `Hand tracking active: ${trackedHandCount} hand${trackedHandCount === 1 ? "" : "s"}, ${trackedJointCount} joints. Cyan dots mark tracked joints.`;
	} else if (inputHandCount > 0) {
		trackingMessage = "Hand input detected, but no joint poses yet. Keep your hands in view and check tracking permissions.";
	} else if (handTrackingStartedAt !== null && time - handTrackingStartedAt > 2500) {
		trackingMessage = "No hand-tracking input detected. This browser/device may not support WebXR hand tracking.";
	}
	if (trackingMessage !== lastHandTrackingMessage) {
		handTrackingStatus.textContent = trackingMessage;
		lastHandTrackingMessage = trackingMessage;
	}

	if (isPulling) setStatus("Pulling clay · release pinch to let go");
	else if (isTouching) setStatus("Hand touching clay · pinch and pull to stretch");
	else if (trackedJointCount > 0 && clayPlacedInAR) setStatus("Touch the clay with a fingertip, then pinch and pull to stretch");
	else if (trackingMessage.startsWith("No hand-tracking")) setStatus("Tap the clay to sculpt; hand tracking is unavailable");
}

const xrButton = document.createElement("button");
xrButton.type = "button";
xrButton.textContent = "Place in AR";
xrButton.addEventListener("click", async () => {
	if (arSession) {
		await arSession.end();
		return;
	}
	clearError();
	try {
		if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar"))) {
			throw new Error("Immersive AR is not available in this browser. Try Chrome on an ARCore-supported device.");
		}
		const session = await navigator.xr.requestSession("immersive-ar", {
			optionalFeatures: ["hit-test", "local-floor", "dom-overlay", "hand-tracking"],
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
	handTrackingStartedAt = null;
	lastHandTrackingMessage = "";
	document.documentElement.classList.add("xr-ar");
	document.body.classList.add("xr-ar");
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
	handTrackingStartedAt = performance.now();
	handTrackingStatus.textContent = "Hand tracking: checking...";
	placementReticle.visible = false;
	arPlaceButton.textContent = "Place clay";
	arInstructions.textContent = "Scanning for a surface. Hand tracking will appear here if supported by your browser.";
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
	handTrackingStartedAt = null;
	lastHandTrackingMessage = "";
	arSurfaceFound = false;
	arFallbackPlacementReady = false;
	arPlacementMode = "searching";
	controls.enabled = true;
	document.documentElement.classList.remove("xr-ar");
	document.body.classList.remove("xr-ar");
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
		handTrackingStartedAt !== null &&
		performance.now() - handTrackingStartedAt > 4000
	) {
		updateARPlacementAvailability(false, true);
	}
	updateHands(time);
	renderer.render(scene, camera);
});
