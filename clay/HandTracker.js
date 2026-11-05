import * as THREE from "three";
import { LandmarkSmoother, OneEuroFilter } from "./OneEuroFilter.js";

// Metric palm/finger-base bone pairs used to estimate distance from the camera.
const DISTANCE_PAIRS = [[0, 9], [0, 5], [0, 17], [0, 13], [5, 17], [5, 9], [9, 13], [13, 17]];
const IMAGE_FILTER = { minCutoff: 1.2, beta: 12, dCutoff: 1 };
const WORLD_FILTER = { minCutoff: 1.2, beta: 25, dCutoff: 1 };
const DISTANCE_FILTER = { minCutoff: 0.6, beta: 1, dCutoff: 1 };
const PINCH_ENTER = 0.032;
const PINCH_EXIT = 0.05;

const JOINT_RADIUS = [
	0.011,
	0.0105, 0.0095, 0.009, 0.0085,
	0.0098, 0.0088, 0.0082, 0.0078,
	0.01, 0.009, 0.0084, 0.008,
	0.0095, 0.0085, 0.008, 0.0076,
	0.0088, 0.0078, 0.0072, 0.0068,
];
const PALM_FAN = [0, 1, 5, 9, 13, 17];
const GLOVE_IDLE = 0x000000;
const GLOVE_TOUCH = 0x1f7a3a;
const GLOVE_PINCH = 0xa8541a;

const CONNECTIONS = [
	[0, 1], [1, 2], [2, 3], [3, 4],
	[0, 5], [5, 6], [6, 7], [7, 8],
	[0, 9], [9, 10], [10, 11], [11, 12],
	[0, 13], [13, 14], [14, 15], [15, 16],
	[0, 17], [17, 18], [18, 19], [19, 20],
	[5, 9], [9, 13], [13, 17],
];

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const DESKTOP_REACH = 0.65;
const DESKTOP_REFERENCE_DISTANCE = 0.4;
const WEBCAM_VERTICAL_FOV = THREE.MathUtils.degToRad(50);
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";

export class HandTracker {
	constructor({ video, scene, camera, viewport, onStatus = () => {} }) {
		this.video = video;
		this.scene = scene;
		this.camera = camera;
		this.viewport = viewport;
		this.onStatus = onStatus;
		this.landmarker = null;
		this.visionTasks = null;
		this.depthCalibration = 1;
		this.source = "ar";
		this.focusDistance = 1.4;
		this.lastTimestamp = -1;
		this.previousPinchMidpoint = new THREE.Vector3();
		this.resetInteraction();
		this.hands = [];
		this.rigs = [];
		this.smoothers = [];
		this.lastDistance = null;
		this._forward = new THREE.Vector3();
		this._origin = new THREE.Vector3();
		this._cameraQuaternion = new THREE.Quaternion();
		this._cameraScale = new THREE.Vector3();
		this._raycaster = new THREE.Raycaster();
		this._point = new THREE.Vector3();
		this._boneDirection = new THREE.Vector3();
		this._boneMidpoint = new THREE.Vector3();
		this._cuffEnd = new THREE.Vector3();
		this._up = new THREE.Vector3(0, 1, 0);
		this._createRigs();
	}

	async initialize() {
		this.visionTasks = await import("@mediapipe/tasks-vision");
		const { FilesetResolver, HandLandmarker } = this.visionTasks;
		const vision = await FilesetResolver.forVisionTasks(WASM_URL);
		this.landmarker = await HandLandmarker.createFromOptions(vision, {
			baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
			runningMode: "VIDEO",
			numHands: 2,
			minHandDetectionConfidence: 0.55,
			minHandPresenceConfidence: 0.55,
			minTrackingConfidence: 0.5,
		});
	}

	setSource(source) {
		this.source = source;
		this.smoothers = [];
		this.resetInteraction();
	}

	get cameraLabel() {
		return this.source === "desktop" ? "webcam" : "rear camera";
	}

	setDepthCalibration(value) {
		this.depthCalibration = THREE.MathUtils.clamp(value, 0.5, 2);
	}

	detect(timestamp, camera = this.camera) {
		if (!this.landmarker || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
		const videoTimestamp = Math.max(timestamp, this.lastTimestamp + 1);
		this.lastTimestamp = videoTimestamp;
		const results = this.landmarker.detectForVideo(this.video, videoTimestamp);
		const time = videoTimestamp / 1000;
		const detected = results.landmarks ?? [];
		if (detected.length !== this.smoothers.length) {
			this.smoothers = detected.map(() => this._createSmoother());
		}
		this.hands = detected.map((rawLandmarks, index) => {
			const smoother = this.smoothers[index];
			const landmarks = smoother.image.filter(rawLandmarks, time);
			const rawWorld = results.worldLandmarks?.[index];
			const world = rawWorld ? smoother.world.filter(rawWorld, time) : null;
			const points = this.source === "desktop"
				? this._reconstructDesktop(landmarks, world, camera, smoother, time)
				: this._reconstruct(landmarks, world, camera, smoother, time);
			this._updateRig(index, points);
			return { landmarks, points };
		});
		this.lastDistance = this.hands.length ? this.smoothers[0].lastDistance : null;
		for (let index = this.hands.length; index < this.rigs.length; index += 1) {
			this.rigs[index].group.visible = false;
		}
		const hand = this.hands[0];
		if (!hand) {
			this.hasPreviousPinch = false;
			this.onStatus(`Show your hand to the ${this.cameraLabel}.`);
			return { hands: this.hands, pinch: false, midpoint: null, delta: new THREE.Vector3() };
		}

		const thumb = hand.points[4];
		const index = hand.points[8];
		const midpoint = thumb.clone().add(index).multiplyScalar(0.5);
		const pinchDistance = thumb.distanceTo(index);
		const pinch = pinchDistance < (this.hasPreviousPinch ? PINCH_EXIT : PINCH_ENTER);
		const delta = this.hasPreviousPinch ? midpoint.clone().sub(this.previousPinchMidpoint) : new THREE.Vector3();
		this.previousPinchMidpoint.copy(midpoint);
		this.hasPreviousPinch = pinch;
		const range = this.lastDistance ? ` · hand ≈ ${Math.round(this.lastDistance * 100)} cm away` : "";
		this.onStatus((pinch ? "Pinching — move to pull the clay." : "Pinch thumb and index finger to sculpt.") + range);
		return { hands: this.hands, pinch, midpoint, delta };
	}

	setColliderState({ colliding = false, pinching = false } = {}) {
		for (let handIndex = 0; handIndex < this.hands.length; handIndex += 1) {
			const rig = this.rigs[handIndex];
			for (const material of rig.tipMaterials) {
				material.emissive.setHex(pinching ? GLOVE_PINCH : colliding ? GLOVE_TOUCH : GLOVE_IDLE);
			}
		}
	}

	close() {
		this.landmarker?.close();
		this.landmarker = null;
		this.visionTasks = null;
		this.hands = [];
		this.smoothers = [];
		this.lastDistance = null;
		this.hasPreviousPinch = false;
		for (const rig of this.rigs) rig.group.visible = false;
	}

	_createSmoother() {
		return {
			image: new LandmarkSmoother(IMAGE_FILTER),
			world: new LandmarkSmoother(WORLD_FILTER),
			distance: new OneEuroFilter(DISTANCE_FILTER),
			lastDistance: null,
		};
	}

	// World landmarks are metric and camera-aligned, so comparing their x/y extent with the
	// on-screen pixel extent gives distance = focal * metricSize / pixelSize, independent of hand tilt.
	_estimateDistance(landmarks, world, width, height, focalPixels) {
		let pixels = 0;
		let metric = 0;
		if (world) {
			for (const [a, b] of DISTANCE_PAIRS) {
				pixels += Math.hypot((landmarks[a].x - landmarks[b].x) * width, (landmarks[a].y - landmarks[b].y) * height);
				metric += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
			}
		}
		if (pixels < 1 || metric < 0.01) {
			pixels = Math.max(Math.hypot((landmarks[0].x - landmarks[9].x) * width, (landmarks[0].y - landmarks[9].y) * height), 1);
			metric = 0.08;
		}
		return focalPixels * metric / pixels;
	}

	_reconstruct(landmarks, world, camera, smoother, time) {
		const width = this.video.videoWidth;
		const height = this.video.videoHeight;
		if (!width || !height) return Array.from({ length: 21 }, () => new THREE.Vector3());
		const viewportBounds = this.viewport.getBoundingClientRect();
		const coverScale = Math.max(viewportBounds.width / width, viewportBounds.height / height);
		const displayedWidth = width * coverScale;
		const displayedHeight = height * coverScale;
		const cropX = (displayedWidth - viewportBounds.width) / 2;
		const cropY = (displayedHeight - viewportBounds.height) / 2;
		const wrist = landmarks[0];
		const middleMcp = landmarks[9];
		const palmPixels = Math.hypot((wrist.x - middleMcp.x) * width, (wrist.y - middleMcp.y) * height);
		const focalPixels = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
		const distance = smoother.distance.filter(this._estimateDistance(landmarks, world, width, height, focalPixels), time);
		smoother.lastDistance = distance;
		const wristDepth = THREE.MathUtils.clamp(distance * this.depthCalibration, 0.18, 1.5);
		camera.updateMatrixWorld(true);
		camera.matrixWorld.decompose(this._origin, this._cameraQuaternion, this._cameraScale);
		this._forward.set(0, 0, -1).applyQuaternion(this._cameraQuaternion).normalize();

		return landmarks.map((landmark) => {
			const screenX = landmark.x * displayedWidth - cropX;
			const screenY = landmark.y * displayedHeight - cropY;
			const ndcX = (screenX / viewportBounds.width) * 2 - 1;
			const ndcY = -(screenY / viewportBounds.height) * 2 + 1;
			this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
			const ray = this._raycaster.ray;
			const cameraDepth = Math.max(0.15, wristDepth + landmark.z * 0.08 / Math.max(palmPixels / height, 0.01));
			const rayDepth = cameraDepth / Math.max(0.15, -ray.direction.dot(this._forward));
			this._point.set(ndcX, ndcY, 0.5).unproject(camera);
			const viewRay = this._point.sub(this._origin).normalize();
			this._point.copy(this._origin).addScaledVector(viewRay, rayDepth);
			return this._point.clone();
		});
	}

	// Desktop webcam: the hand is placed at the clay's depth from its 2D wrist position and
	// palm size; its shape comes from MediaPipe's metric worldLandmarks, mirrored like a selfie view.
	_reconstructDesktop(landmarks, worldLandmarks, camera, smoother, time) {
		const width = this.video.videoWidth;
		const height = this.video.videoHeight;
		if (!width || !height || !worldLandmarks) return Array.from({ length: 21 }, () => new THREE.Vector3());
		const wrist = landmarks[0];
		const webcamFocal = height / (2 * Math.tan(WEBCAM_VERTICAL_FOV / 2));
		const rawDistance = this._estimateDistance(landmarks, worldLandmarks, width, height, webcamFocal);
		const handDistance = smoother.distance.filter(THREE.MathUtils.clamp(rawDistance, 0.15, 1.2), time);
		smoother.lastDistance = handDistance;
		const depth = THREE.MathUtils.clamp(
			this.focusDistance + (handDistance - DESKTOP_REFERENCE_DISTANCE) * this.depthCalibration,
			0.25,
			this.focusDistance * 2,
		);
		camera.updateMatrixWorld(true);
		camera.matrixWorld.decompose(this._origin, this._cameraQuaternion, this._cameraScale);
		this._forward.set(0, 0, -1).applyQuaternion(this._cameraQuaternion).normalize();
		const ndcX = -(wrist.x * 2 - 1) * DESKTOP_REACH;
		const ndcY = -(wrist.y * 2 - 1) * DESKTOP_REACH;
		this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
		const rayDirection = this._raycaster.ray.direction;
		const wristWorld = this._origin.clone().addScaledVector(
			rayDirection,
			depth / Math.max(0.15, rayDirection.dot(this._forward)),
		);
		const root = worldLandmarks[0];
		return worldLandmarks.map((landmark) => this._point
			.set(-(landmark.x - root.x), -(landmark.y - root.y), -(landmark.z - root.z))
			.applyQuaternion(this._cameraQuaternion)
			.add(wristWorld)
			.clone());
	}

	setVisible(visible) {
		for (const rig of this.rigs) rig.group.visible = visible && this.hands.length > 0;
	}

	resetInteraction() {
		this.hasPreviousPinch = false;
		this.previousPinchMidpoint.set(0, 0, 0);
	}

	_createRigs() {
		const jointGeometry = new THREE.SphereGeometry(1, 14, 10);
		const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
		for (let hand = 0; hand < 2; hand += 1) {
			const group = new THREE.Group();
			const material = new THREE.MeshStandardMaterial({
				color: 0xffffff,
				emissive: GLOVE_IDLE,
				emissiveIntensity: 0.7,
				roughness: 0.6,
				metalness: 0,
				side: THREE.DoubleSide,
			});
			const joints = Array.from({ length: 21 }, (_, index) => {
				const sphere = new THREE.Mesh(jointGeometry, index === 4 || index === 8 ? material.clone() : material);
				group.add(sphere);
				return sphere;
			});
			const tipMaterials = [joints[4].material, joints[8].material];
			const bones = CONNECTIONS.map(() => {
				const cylinder = new THREE.Mesh(boneGeometry, material);
				group.add(cylinder);
				return cylinder;
			});
			const palmGeometry = new THREE.BufferGeometry();
			palmGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PALM_FAN.length * 3), 3));
			palmGeometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
			const palm = new THREE.Mesh(palmGeometry, material);
			palm.frustumCulled = false;
			group.add(palm);
			const cuff = new THREE.Mesh(boneGeometry, material);
			group.add(cuff);
			group.visible = false;
			group.renderOrder = 5;
			this.scene.add(group);
			this.rigs.push({ group, joints, bones, tipMaterials, palm, cuff });
		}
	}

	_orientBone(bone, start, end, radius) {
		this._boneDirection.subVectors(end, start);
		const length = this._boneDirection.length();
		bone.visible = length >= 0.0001;
		if (!bone.visible) return;
		this._boneMidpoint.addVectors(start, end).multiplyScalar(0.5);
		bone.position.copy(this._boneMidpoint);
		bone.quaternion.setFromUnitVectors(this._up, this._boneDirection.normalize());
		bone.scale.set(radius, length, radius);
	}

	_updateRig(handIndex, points) {
		const rig = this.rigs[handIndex];
		if (!rig) return;
		rig.group.visible = true;
		for (let index = 0; index < rig.joints.length; index += 1) {
			rig.joints[index].position.copy(points[index]);
			rig.joints[index].scale.setScalar(JOINT_RADIUS[index] * (index === 4 || index === 8 ? 1.2 : 1));
		}
		for (let index = 0; index < CONNECTIONS.length; index += 1) {
			const [start, end] = CONNECTIONS[index];
			this._orientBone(
				rig.bones[index],
				points[start],
				points[end],
				(JOINT_RADIUS[start] + JOINT_RADIUS[end]) / 2,
			);
		}
		const palmPositions = rig.palm.geometry.attributes.position;
		PALM_FAN.forEach((landmark, index) => palmPositions.setXYZ(index, points[landmark].x, points[landmark].y, points[landmark].z));
		palmPositions.needsUpdate = true;
		rig.palm.geometry.computeVertexNormals();

		// Cuff extends from the wrist away from the fingers, like the end of a glove.
		this._boneDirection.subVectors(points[0], points[9]).normalize();
		this._cuffEnd.copy(points[0]).addScaledVector(this._boneDirection, 0.045);
		this._orientBone(rig.cuff, points[0], this._cuffEnd, JOINT_RADIUS[0] * 1.15);
	}
}
