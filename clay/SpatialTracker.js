import * as THREE from "three";

export const AR_WALK_MODE = "AR_WALK_MODE";
export const PLACE_MODE = "PLACE_MODE";
export const WALK_VIEW_MODE = "WALK_VIEW_MODE";
export const WALK_SCULPT_MODE = "WALK_SCULPT_MODE";

const GRAVITY = 9.80665;
const MAX_MOTION_STEP = 0.012;

export class SpatialTracker {
	constructor({
		camera,
		renderer,
		viewport,
		cameraManager,
		worldAnchorGroup,
		anchorGround,
		modelRoot,
		reticle,
		onStatus = () => {},
		onModeChange = () => {},
	}) {
		this.camera = camera;
		this.renderer = renderer;
		this.viewport = viewport;
		this.cameraManager = cameraManager;
		this.worldAnchorGroup = worldAnchorGroup;
		this.anchorGround = anchorGround;
		this.modelRoot = modelRoot;
		this.reticle = reticle;
		this.onStatus = onStatus;
		this.onModeChange = onModeChange;
		this.mode = null;
		this.active = false;
		this.nativeXR = false;
		this.hasAnchor = false;
		this.latestHitPose = null;
		this.pendingAnchorPose = null;
		this.xrAnchor = null;
		this.anchorPending = false;
		this.orientationPermissionGranted = false;
		this.sensorWarning = "";
		this.orientationBaseline = null;
		this.sensorWarning = "";
		this.startCameraQuaternion = new THREE.Quaternion();
		this.deviceQuaternion = new THREE.Quaternion();
		this.deviceDelta = new THREE.Quaternion();
		this.screenQuaternion = new THREE.Quaternion();
		this._euler = new THREE.Euler();
		this._axis = new THREE.Vector3(0, 0, 1);
		this._gravity = new THREE.Vector3(0, GRAVITY, 0);
		this._acceleration = new THREE.Vector3();
		this._velocity = new THREE.Vector3();
		this._translation = new THREE.Vector3();
		this._position = new THREE.Vector3();
		this._forward = new THREE.Vector3();
		this._lookTarget = new THREE.Vector3();
		this._spherical = new THREE.Spherical();
		this._pointerPositions = new Map();
		this._gesture = null;
		this._lastMotionAt = 0;
		this._boundOrientation = (event) => this._handleOrientation(event);
		this._boundMotion = (event) => this._handleMotion(event);
		this._boundPointerDown = (event) => this._onPointerDown(event);
		this._boundPointerMove = (event) => this._onPointerMove(event);
		this._boundPointerUp = (event) => this._onPointerUp(event);
	}

	async start({ nativeXR = false } = {}) {
		this.active = true;
		this.nativeXR = nativeXR;
		this.hasAnchor = false;
		this.latestHitPose = null;
		this.pendingAnchorPose = null;
		this.xrAnchor = null;
		this.anchorPending = false;
		this.worldAnchorGroup.matrixAutoUpdate = true;
		this._velocity.set(0, 0, 0);
		this.worldAnchorGroup.visible = false;
		this.anchorGround.visible = false;
		this.reticle.visible = false;
		this.camera.position.set(0, 0, 0);
		this.camera.quaternion.identity();
		this.camera.updateMatrixWorld(true);
		this.startCameraQuaternion.copy(this.camera.quaternion);
		this.orientationBaseline = null;
		if (!nativeXR) {
			await this._enableDeviceSensors();
			window.addEventListener("deviceorientation", this._boundOrientation);
			window.addEventListener("devicemotion", this._boundMotion);
			this.viewport.addEventListener("pointerdown", this._boundPointerDown);
			this.viewport.addEventListener("pointermove", this._boundPointerMove);
			this.viewport.addEventListener("pointerup", this._boundPointerUp);
			this.viewport.addEventListener("pointercancel", this._boundPointerUp);
		}
		this.setMode(PLACE_MODE);
	}

	setMode(mode) {
		if (![PLACE_MODE, WALK_VIEW_MODE, WALK_SCULPT_MODE].includes(mode)) {
			throw new Error(`Unknown AR walk mode: ${mode}`);
		}
		if (!this.active && mode !== PLACE_MODE) return;
		if (mode !== PLACE_MODE && !this.hasAnchor) {
			this.onStatus("Anchor the model before switching walk modes.");
			return;
		}
		this.mode = mode;
		this.reticle.visible = mode === PLACE_MODE;
		this.onModeChange(mode);
		if (mode === PLACE_MODE) this.onStatus("Move the device to position the reticle, then anchor the model.");
		if (mode === WALK_VIEW_MODE) this.onStatus("Walk View — orbit, move, or tilt to inspect. Hand sculpting is paused.");
		if (mode === WALK_SCULPT_MODE) this.onStatus("Walk Sculpt — move around the anchor and sculpt with thumb and index finger.");
	}

	update(frame = null) {
		if (!this.active) return;
		if (this.nativeXR) {
			this._updateNativeXR(frame);
			return;
		}
		this.camera.updateMatrixWorld(true);
		if (this.mode === PLACE_MODE) {
			this.camera.getWorldDirection(this._forward);
			this.reticle.position.copy(this.camera.position).addScaledVector(this._forward, 0.5);
			this.reticle.quaternion.copy(this.camera.quaternion);
			this.reticle.visible = true;
		}
	}

	anchorHere() {
		if (!this.active || this.mode !== PLACE_MODE || (this.nativeXR && !this.reticle.visible)) {
			this.onStatus("Wait for a placement reticle before anchoring.");
			return false;
		}
		this.worldAnchorGroup.position.copy(this.reticle.position);
		if (this.nativeXR && this.latestHitPose?.orientation) {
			const { x, y, z, w } = this.latestHitPose.orientation;
			this.worldAnchorGroup.quaternion.set(x, y, z, w);
			this.modelRoot.position.set(0, 0.3, 0);
		} else {
			this.worldAnchorGroup.quaternion.copy(this.reticle.quaternion);
			this.modelRoot.position.set(0, 0, 0);
		}
		this.worldAnchorGroup.scale.setScalar(1);
		this.worldAnchorGroup.visible = true;
		this.anchorGround.visible = true;
		this.worldAnchorGroup.updateMatrixWorld(true);
		this.hasAnchor = true;
		if (this.nativeXR && this.latestHitPose) {
			this.pendingAnchorPose = this.latestHitPose;
			this.anchorPending = true;
		}
		this.reticle.visible = false;
		this.setMode(WALK_VIEW_MODE);
		return true;
	}

	recenter(distance = 0.45) {
		if (!this.active || this.nativeXR) {
			this.onStatus("Re-center is available in rear-camera passthrough mode.");
			return false;
		}
		this.camera.updateMatrixWorld(true);
		this.camera.getWorldPosition(this._position);
		this.camera.getWorldDirection(this._forward);
		this.worldAnchorGroup.position.copy(this._position).addScaledVector(this._forward, distance);
		this.worldAnchorGroup.quaternion.identity();
		this.modelRoot.position.set(0, 0, 0);
		this.worldAnchorGroup.updateMatrixWorld(true);
		this.anchorGround.visible = true;
		this.hasAnchor = true;
		if (this.mode === PLACE_MODE) this.setMode(WALK_VIEW_MODE);
		this.onStatus("Anchor re-centered 0.45 m in front of the camera.");
		return true;
	}

	stop() {
		this.active = false;
		this.nativeXR = false;
		this.mode = null;
		this.hasAnchor = false;
		this.anchorPending = false;
		this.xrAnchor = null;
		this.orientationBaseline = null;
		this.pendingAnchorPose = null;
		this._pointerPositions.clear();
		this._gesture = null;
		this.reticle.visible = false;
		this.worldAnchorGroup.visible = true;
		this.anchorGround.visible = false;
		window.removeEventListener("deviceorientation", this._boundOrientation);
		window.removeEventListener("devicemotion", this._boundMotion);
		this.viewport.removeEventListener("pointerdown", this._boundPointerDown);
		this.viewport.removeEventListener("pointermove", this._boundPointerMove);
		this.viewport.removeEventListener("pointerup", this._boundPointerUp);
		this.viewport.removeEventListener("pointercancel", this._boundPointerUp);
	}

	async _enableDeviceSensors() {
		const orientationPermission = window.DeviceOrientationEvent?.requestPermission;
		const motionPermission = window.DeviceMotionEvent?.requestPermission;
		try {
			const permissionRequests = [];
			if (orientationPermission) {
				permissionRequests.push(orientationPermission.call(window.DeviceOrientationEvent));
			}
			if (motionPermission) {
				permissionRequests.push(motionPermission.call(window.DeviceMotionEvent));
			}
			const results = await Promise.all(permissionRequests);
			if (results.some((result) => result !== "granted")) {
				throw new Error("Device sensor permission was not granted.");
			}
			this.orientationPermissionGranted = true;
		} catch (error) {
			this.orientationPermissionGranted = false;
			this.sensorWarning = error instanceof Error
				? `${error.message} Touch walk-around remains available.`
				: "Device sensors unavailable. Touch walk-around remains available.";
			this.onStatus(this.sensorWarning);
		}
	}

	_handleOrientation(event) {
		if (!this.active || this.nativeXR || event.alpha == null || event.beta == null || event.gamma == null) return;
		const screenAngle = THREE.MathUtils.degToRad(window.screen?.orientation?.angle ?? window.orientation ?? 0);
		this._euler.set(
			THREE.MathUtils.degToRad(event.beta),
			THREE.MathUtils.degToRad(event.alpha),
			-THREE.MathUtils.degToRad(event.gamma),
			"YXZ",
		);
		this.deviceQuaternion.setFromEuler(this._euler);
		this.deviceQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
		this.screenQuaternion.setFromAxisAngle(this._axis, -screenAngle);
		this.deviceQuaternion.multiply(this.screenQuaternion);
		if (!this.orientationBaseline) {
			this.orientationBaseline = this.deviceQuaternion.clone();
			this.startCameraQuaternion.copy(this.camera.quaternion);
			return;
		}
		this.deviceDelta.copy(this.orientationBaseline).invert().multiply(this.deviceQuaternion);
		if (this.mode === PLACE_MODE) {
			this.camera.quaternion.copy(this.startCameraQuaternion).multiply(this.deviceDelta);
			this.camera.updateMatrixWorld(true);
			return;
		}
		if (this.mode !== WALK_VIEW_MODE && this.mode !== WALK_SCULPT_MODE) return;
		this._lookTarget.copy(this.worldAnchorGroup.position);
		this.camera.lookAt(this._lookTarget);
		this.camera.quaternion.premultiply(this.deviceDelta);
		this.camera.updateMatrixWorld(true);
	}

	_handleMotion(event) {
		if (!this.active || this.nativeXR || (this.mode !== WALK_VIEW_MODE && this.mode !== WALK_SCULPT_MODE)) return;
		const now = performance.now();
		const dt = this._lastMotionAt ? Math.min((now - this._lastMotionAt) / 1000, 0.05) : 0;
		this._lastMotionAt = now;
		if (!dt) return;
		const raw = event.acceleration;
		const includingGravity = event.accelerationIncludingGravity;
		if (raw && raw.x != null && raw.y != null && raw.z != null) {
			this._acceleration.set(raw.x, raw.y, raw.z).applyQuaternion(this.deviceQuaternion);
		} else if (includingGravity && includingGravity.x != null && includingGravity.y != null && includingGravity.z != null) {
			this._acceleration.set(includingGravity.x, includingGravity.y, includingGravity.z);
			this._acceleration.applyQuaternion(this.deviceQuaternion).sub(this._gravity);
		} else {
			return;
		}
		if (this._acceleration.length() < 0.35) this._acceleration.set(0, 0, 0);
		this._velocity.addScaledVector(this._acceleration, dt);
		this._velocity.multiplyScalar(Math.exp(-4.5 * dt));
		this._translation.copy(this._velocity).multiplyScalar(dt);
		if (this._translation.length() > MAX_MOTION_STEP) this._translation.setLength(MAX_MOTION_STEP);
		this.camera.position.add(this._translation);
		this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, -0.5, 1.8);
		const distanceFromAnchor = this.camera.position.distanceTo(this.worldAnchorGroup.position);
		if (distanceFromAnchor > 3.5) {
			this.camera.position.sub(this.worldAnchorGroup.position).setLength(3.5).add(this.worldAnchorGroup.position);
		}
	}

	_updateNativeXR(frame) {
		if (!frame) return;
		this.cameraManager.updateXR(frame);
		this.latestHitPose = this.cameraManager.latestHitPose;
		if (this.mode !== PLACE_MODE) this.reticle.visible = false;
		if (this.anchorPending && this.pendingAnchorPose && typeof frame.createAnchor === "function") {
			this.anchorPending = false;
			frame.createAnchor(this.pendingAnchorPose, this.cameraManager.referenceSpace).then((anchor) => {
				if (!this.active) return;
				this.xrAnchor = anchor;
				this.pendingAnchorPose = null;
			}).catch((error) => {
				console.warn("Native spatial anchor could not be created; retaining the hit-test transform.", error);
			});
		}
		if (!this.xrAnchor || !this.cameraManager.referenceSpace) return;
		const pose = frame.getPose(this.xrAnchor.anchorSpace, this.cameraManager.referenceSpace);
		if (!pose) return;
		this.worldAnchorGroup.matrix.fromArray(pose.transform.matrix);
		this.worldAnchorGroup.matrix.decompose(
			this.worldAnchorGroup.position,
			this.worldAnchorGroup.quaternion,
			this.worldAnchorGroup.scale,
		);
		this.worldAnchorGroup.matrixAutoUpdate = false;
	}

	_onPointerDown(event) {
		if (!this.active || this.nativeXR || this.mode === PLACE_MODE) return;
		this._pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
		this.viewport.setPointerCapture(event.pointerId);
		if (this._pointerPositions.size === 1) {
			this._gesture = { type: "orbit", lastX: event.clientX, lastY: event.clientY };
		} else if (this._pointerPositions.size === 2) {
			const [first, second] = [...this._pointerPositions.values()];
			this._gesture = {
				type: "multi",
				distance: Math.hypot(first.x - second.x, first.y - second.y),
				centerX: (first.x + second.x) / 2,
				centerY: (first.y + second.y) / 2,
			};
		}
		event.preventDefault();
	}

	_onPointerMove(event) {
		if (!this.active || this.nativeXR || !this._pointerPositions.has(event.pointerId)) return;
		this._pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
		const radius = Math.max(0.35, this.camera.position.distanceTo(this.worldAnchorGroup.position));
		if (this._pointerPositions.size === 1 && this._gesture?.type === "orbit") {
			const dx = event.clientX - this._gesture.lastX;
			const dy = event.clientY - this._gesture.lastY;
			this._gesture.lastX = event.clientX;
			this._gesture.lastY = event.clientY;
			this.camera.position.sub(this.worldAnchorGroup.position);
			this._spherical.setFromVector3(this.camera.position);
			this._spherical.theta -= dx * 0.006;
			this._spherical.phi = THREE.MathUtils.clamp(this._spherical.phi + dy * 0.006, 0.18, Math.PI - 0.18);
			this._spherical.radius = radius;
			this.camera.position.setFromSpherical(this._spherical).add(this.worldAnchorGroup.position);
			this.camera.lookAt(this.worldAnchorGroup.position);
		} else if (this._pointerPositions.size >= 2 && this._gesture?.type === "multi") {
			const [first, second] = [...this._pointerPositions.values()];
			const distance = Math.hypot(first.x - second.x, first.y - second.y);
			const centerX = (first.x + second.x) / 2;
			const centerY = (first.y + second.y) / 2;
			const scale = this._gesture.distance ? distance / this._gesture.distance : 1;
			const dollyRadius = THREE.MathUtils.clamp(radius / Math.max(scale, 0.1), 0.25, 3.5);
			this._forward.subVectors(this.camera.position, this.worldAnchorGroup.position).normalize();
			this.camera.position.copy(this.worldAnchorGroup.position).addScaledVector(this._forward, dollyRadius);
			const panX = (centerX - this._gesture.centerX) * 0.0015;
			const panY = (centerY - this._gesture.centerY) * 0.0015;
			this._translation.set(-panX, panY, 0).applyQuaternion(this.camera.quaternion);
			this.camera.position.add(this._translation);
			this.camera.lookAt(this.worldAnchorGroup.position);
			this._gesture = { type: "multi", distance, centerX, centerY };
		}
		this.camera.updateMatrixWorld(true);
		event.preventDefault();
	}

	_onPointerUp(event) {
		this._pointerPositions.delete(event.pointerId);
		if (this._pointerPositions.size === 1) {
			const [remaining] = this._pointerPositions.values();
			this._gesture = { type: "orbit", lastX: remaining.x, lastY: remaining.y };
		} else if (!this._pointerPositions.size) {
			this._gesture = null;
		}
	}
}
