import * as THREE from "three";

export class ARCameraManager {
	constructor({ video, renderer, camera, reticle, overlayRoot, onSessionEnd = () => {} }) {
		this.video = video;
		this.renderer = renderer;
		this.camera = camera;
		this.reticle = reticle;
		this.overlayRoot = overlayRoot;
		this.onSessionEnd = onSessionEnd;
		this.stream = null;
		this.session = null;
		this.hitTestSource = null;
		this.referenceSpace = null;
		this.viewerSpace = null;
		this.latestHitPose = null;
		this.mode = "studio";
		this._cameraPosition = new THREE.Vector3();
		this._cameraForward = new THREE.Vector3();
		this._placementPlane = new THREE.Plane();
		this._ray = new THREE.Ray();
		this._placementPoint = new THREE.Vector3();
		this._reticleAlignment = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(1, 0, 0),
			-Math.PI / 2,
		);
	}

	async startPassthrough() {
		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			throw new Error("Rear-camera access requires HTTPS and a browser with camera support.");
		}

		const stream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				facingMode: { ideal: "environment" },
				width: { ideal: 1280 },
				height: { ideal: 720 },
			},
		});
		const track = stream.getVideoTracks()[0];
		const settings = track?.getSettings();
		const label = track?.label ?? "";
		const confirmedRear = settings?.facingMode === "environment" ||
			/\b(back|rear|environment|world)\b/i.test(label);
		if (!track || !confirmedRear || /\b(front|selfie|facetime)\b/i.test(label)) {
			stream.getTracks().forEach((item) => item.stop());
			throw new Error("The browser could not confirm a rear-facing camera. Front-camera fallback is disabled.");
		}

		this.stream = stream;
		this.video.srcObject = stream;
		await this.video.play();
		this.video.classList.toggle("is-visible", !this.session);
		this.mode = this.session ? "webxr" : "passthrough";
		return { label, settings };
	}

	async enterWebXR() {
		if (!navigator.xr) throw new Error("WebXR is not available in this browser.");

		const sessionPromise = navigator.xr.requestSession("immersive-ar", {
			requiredFeatures: ["local-floor", "hit-test"],
			optionalFeatures: ["dom-overlay", "anchors"],
			domOverlay: { root: this.overlayRoot },
		});
		const session = await sessionPromise;
		try {
			this.session = session;
			this.latestHitPose = null;
			this.renderer.xr.enabled = true;
			this.renderer.xr.setReferenceSpaceType("local-floor");
			await this.renderer.xr.setSession(session);
			this.viewerSpace = await session.requestReferenceSpace("viewer");
			this.referenceSpace = this.renderer.xr.getReferenceSpace();
			if (!this.referenceSpace) {
				throw new Error("The WebXR renderer did not provide its local-floor reference space.");
			}
			this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
			this.video.classList.remove("is-visible");
			this.mode = "webxr";
			session.addEventListener("end", () => this._handleSessionEnd(), { once: true });
			return session;
		} catch (error) {
			await session.end();
			this._handleSessionEnd();
			throw error;
		}
	}

	updateXR(frame) {
		if (!this.session || !frame || !this.referenceSpace || !this.hitTestSource) return null;
		const hit = frame.getHitTestResults(this.hitTestSource)[0];
		if (!hit) {
			this.latestHitPose = null;
			this.reticle.visible = false;
			return null;
		}
		const pose = hit.getPose(this.referenceSpace);
		if (!pose) {
			this.latestHitPose = null;
			this.reticle.visible = false;
			return null;
		}
		this.latestHitPose = pose.transform;
		this.reticle.matrix.fromArray(pose.transform.matrix);
		this.reticle.matrix.decompose(this.reticle.position, this.reticle.quaternion, this.reticle.scale);
		this.reticle.quaternion.multiply(this._reticleAlignment);
		this.reticle.visible = true;
		return this.reticle.position;
	}

	getPassthroughPlacement(distance = 0.55) {
		this.camera.updateWorldMatrix(true, false);
		this.camera.getWorldPosition(this._cameraPosition);
		this.camera.getWorldDirection(this._cameraForward);
		this._placementPlane.setFromNormalAndCoplanarPoint(
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, -0.08, 0),
		);
		this._ray.origin.copy(this._cameraPosition);
		this._ray.direction.copy(this._cameraForward);
		if (this._ray.intersectPlane(this._placementPlane, this._placementPoint) &&
			this._placementPoint.distanceTo(this._cameraPosition) < 2) {
			return this._placementPoint.clone();
		}
		return this._cameraPosition.clone().addScaledVector(this._cameraForward, distance);
	}

	async stop() {
		if (this.session) {
			const session = this.session;
			this.session = null;
			try {
				await session.end();
			} finally {
				this._handleSessionEnd();
			}
		}
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.video.pause();
		this.video.srcObject = null;
		this.video.classList.remove("is-visible");
		this.mode = "studio";
	}

	_handleSessionEnd() {
		this.hitTestSource?.cancel();
		this.hitTestSource = null;
		this.referenceSpace = null;
		this.viewerSpace = null;
		this.latestHitPose = null;
		this.session = null;
		this.renderer.xr.enabled = false;
		this.video.classList.toggle("is-visible", Boolean(this.stream));
		this.mode = this.stream ? "passthrough" : "studio";
		this.reticle.visible = false;
		this.onSessionEnd();
	}
}
