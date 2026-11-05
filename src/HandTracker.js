import * as THREE from "three";

const CONNECTIONS = [
	[0, 1], [1, 2], [2, 3], [3, 4],
	[0, 5], [5, 6], [6, 7], [7, 8],
	[0, 9], [9, 10], [10, 11], [11, 12],
	[0, 13], [13, 14], [14, 15], [15, 16],
	[0, 17], [17, 18], [18, 19], [19, 20],
	[5, 9], [9, 13], [13, 17],
];

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
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
		this.lastTimestamp = -1;
		this.previousPinchMidpoint = new THREE.Vector3();
		this.resetInteraction();
		this.hands = [];
		this.rigs = [];
		this._forward = new THREE.Vector3();
		this._origin = new THREE.Vector3();
		this._cameraQuaternion = new THREE.Quaternion();
		this._cameraScale = new THREE.Vector3();
		this._raycaster = new THREE.Raycaster();
		this._point = new THREE.Vector3();
		this._boneDirection = new THREE.Vector3();
		this._boneMidpoint = new THREE.Vector3();
		this._up = new THREE.Vector3(0, 1, 0);
		this._createRigs();
	}

	async initialize() {
		this.visionTasks = await import("@mediapipe/tasks-vision");
		const { FilesetResolver, HandLandmarker } = this.visionTasks;
		const vision = await FilesetResolver.forVisionTasks(WASM_URL);
		const options = {
			baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
			runningMode: "VIDEO",
			numHands: 2,
			minHandDetectionConfidence: 0.55,
			minHandPresenceConfidence: 0.55,
			minTrackingConfidence: 0.5,
		};
		try {
			this.landmarker = await HandLandmarker.createFromOptions(vision, options);
			this.delegate = "GPU";
		} catch (gpuError) {
			console.warn("MediaPipe GPU delegate failed; retrying with CPU.", gpuError);
			options.baseOptions.delegate = "CPU";
			try {
				this.landmarker = await HandLandmarker.createFromOptions(vision, options);
				this.delegate = "CPU";
			} catch (cpuError) {
				throw new Error(
					`MediaPipe hand tracking failed with both GPU and CPU delegates. GPU: ${gpuError instanceof Error ? gpuError.message : String(gpuError)} CPU: ${cpuError instanceof Error ? cpuError.message : String(cpuError)}`,
					{ cause: cpuError },
				);
			}
		}
	}

	setDepthCalibration(value) {
		this.depthCalibration = THREE.MathUtils.clamp(value, 0.5, 2);
	}

	detect(timestamp, camera = this.camera) {
		if (!this.landmarker || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
		const videoTimestamp = Math.max(timestamp, this.lastTimestamp + 1);
		this.lastTimestamp = videoTimestamp;
		const results = this.landmarker.detectForVideo(this.video, videoTimestamp);
		this.hands = (results.landmarks ?? []).map((landmarks, index) => {
			const points = this._reconstruct(landmarks, camera);
			this._updateRig(index, points);
			return { landmarks, points };
		});
		for (let index = this.hands.length; index < this.rigs.length; index += 1) {
			this.rigs[index].group.visible = false;
		}
		const hand = this.hands[0];
		if (!hand) {
			this.hasPreviousPinch = false;
			this.onStatus("Show your hand to the rear camera.");
			return { hands: this.hands, pinch: false, midpoint: null, delta: new THREE.Vector3() };
		}

		const thumb = hand.points[4];
		const index = hand.points[8];
		const midpoint = thumb.clone().add(index).multiplyScalar(0.5);
		const pinch = thumb.distanceTo(index) < 0.035;
		const delta = this.hasPreviousPinch ? midpoint.clone().sub(this.previousPinchMidpoint) : new THREE.Vector3();
		this.previousPinchMidpoint.copy(midpoint);
		this.hasPreviousPinch = pinch;
		this.onStatus(pinch ? "Pinching — move to pull the clay." : "Pinch thumb and index finger to sculpt.");
		return { hands: this.hands, pinch, midpoint, delta };
	}

	setColliderState({ colliding = false, pinching = false } = {}) {
		for (let handIndex = 0; handIndex < this.hands.length; handIndex += 1) {
			const rig = this.rigs[handIndex];
			const color = pinching ? 0xff9b54 : colliding ? 0x52ff80 : 0x7ce8dc;
			for (const material of rig.tipMaterials) {
				material.color.setHex(color);
				material.emissive.setHex(pinching ? 0x71310b : colliding ? 0x135b20 : 0x0c3430);
			}
		}
	}

	close() {
		this.landmarker?.close();
		this.landmarker = null;
		this.delegate = null;
		this.visionTasks = null;
		this.hands = [];
		this.hasPreviousPinch = false;
		for (const rig of this.rigs) rig.group.visible = false;
	}

	_reconstruct(landmarks, camera) {
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
		const palmDistance = Math.max(palmPixels, 1);
		const wristDepth = THREE.MathUtils.clamp(0.08 * focalPixels / palmDistance * this.depthCalibration, 0.18, 1.5);
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

	setVisible(visible) {
		for (const rig of this.rigs) rig.group.visible = visible && this.hands.length > 0;
	}

	resetInteraction() {
		this.hasPreviousPinch = false;
		this.previousPinchMidpoint.set(0, 0, 0);
	}

	_createRigs() {
		const jointGeometry = new THREE.SphereGeometry(0.008, 10, 8);
		const boneGeometry = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6);
		for (let hand = 0; hand < 2; hand += 1) {
			const group = new THREE.Group();
			const material = new THREE.MeshStandardMaterial({
				color: 0x7ce8dc,
				emissive: 0x0c3430,
				roughness: 0.45,
			});
			const joints = Array.from({ length: 21 }, () => {
				const sphereMaterial = material.clone();
				const sphere = new THREE.Mesh(jointGeometry, sphereMaterial);
				group.add(sphere);
				return sphere;
			});
			const tipMaterials = [joints[4].material, joints[8].material];
			const bones = CONNECTIONS.map(() => {
				const cylinder = new THREE.Mesh(boneGeometry, material);
				group.add(cylinder);
				return cylinder;
			});
			group.visible = false;
			group.renderOrder = 5;
			this.scene.add(group);
			this.rigs.push({ group, joints, bones, tipMaterials });
		}
	}

	_updateRig(handIndex, points) {
		const rig = this.rigs[handIndex];
		if (!rig) return;
		rig.group.visible = true;
		for (let index = 0; index < rig.joints.length; index += 1) {
			rig.joints[index].position.copy(points[index]);
			rig.joints[index].scale.setScalar(index === 4 || index === 8 ? 1.35 : 1);
		}
		for (let index = 0; index < CONNECTIONS.length; index += 1) {
			const [start, end] = CONNECTIONS[index];
			const bone = rig.bones[index];
			this._boneDirection.subVectors(points[end], points[start]);
			const length = this._boneDirection.length();
			if (length < 0.0001) {
				bone.visible = false;
				continue;
			}
			bone.visible = true;
			this._boneMidpoint.addVectors(points[start], points[end]).multiplyScalar(0.5);
			bone.position.copy(this._boneMidpoint);
			bone.quaternion.setFromUnitVectors(this._up, this._boneDirection.normalize());
			bone.scale.y = length;
		}
	}
}
