import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { XRButton } from "three/addons/webxr/XRButton.js";
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

const scene = new THREE.Scene();
scene.background = new THREE.Color("#1a1b21");
scene.fog = new THREE.Fog("#1a1b21", 6, 12);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(0, 1.25, 4.7);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = true;
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

const sculptRoot = new THREE.Group();
scene.add(sculptRoot);

let sculptMeshes = [];
let originalGeometries = new Map();
let activeMode = "raise";
let brushRadius = Number(radiusInput.value);
let brushStrength = Number(strengthInput.value);
let isPointerSculpting = false;
let lastSculptTime = 0;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const worldNormal = new THREE.Vector3();
const worldCenter = new THREE.Vector3();
const worldHit = new THREE.Vector3();
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
	destination.setFromMatrixPosition(joint.matrixWorld);
	return true;
}

const handModelFactory = new XRHandModelFactory();
const hands = [0, 1].map((index) => {
	const hand = renderer.xr.getHand(index);
	hand.add(handModelFactory.createHandModel(hand, "mesh"));
	scene.add(hand);
	return hand;
});

function updateHands(time) {
	if (!renderer.xr.isPresenting || activeMode === null) return;
	let sculpted = false;
	for (const hand of hands) {
		const indexTip = hand.joints?.["index-finger-tip"];
		const thumbTip = hand.joints?.["thumb-tip"];
		if (!worldJointPosition(indexTip, worldHit)) continue;
		if (!worldJointPosition(thumbTip, worldCenter)) continue;
		const pinching = worldHit.distanceTo(worldCenter) < 0.045;
		brushIndicator.position.copy(worldHit);
		brushIndicator.scale.setScalar(brushRadius);
		brushIndicator.visible = true;
		if (!pinching || time - lastSculptTime < 55) continue;

		let closest = null;
		let closestDistance = Infinity;
		for (const mesh of sculptMeshes) {
			mesh.getWorldPosition(worldCenter);
			const distance = worldCenter.distanceTo(worldHit);
			if (distance < closestDistance) {
				closest = mesh;
				closestDistance = distance;
			}
		}
		if (!closest || closestDistance > 2.5) continue;
		closest.getWorldPosition(worldCenter);
		worldNormal.copy(worldHit).sub(worldCenter).normalize();
		sculptAt(worldHit, worldNormal);
		sculpted = true;
		lastSculptTime = time;
	}
	if (sculpted) setStatus("Sculpting with hands");
}

const xrButton = XRButton.createButton(renderer, {
	optionalFeatures: ["hand-tracking", "local-floor", "bounded-floor"],
});
xrButton.textContent = "Enter VR";
document.querySelector("#xr-button-container").append(xrButton);
renderer.xr.addEventListener("sessionstart", () => {
	controls.enabled = false;
	setStatus("XR session active · pinch to sculpt");
	canvasHelp.classList.add("is-hidden");
});
renderer.xr.addEventListener("sessionend", () => {
	controls.enabled = true;
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
	updateHands(time);
	renderer.render(scene, camera);
});
