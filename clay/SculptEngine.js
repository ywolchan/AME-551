import * as THREE from "three";

export class SculptEngine {
	constructor({ root, meshes = [], brushRadius = 0.035, strength = 0.012 }) {
		this.root = root;
		this.meshes = meshes;
		this.brushRadius = brushRadius;
		this.strength = strength;
		this.enabled = true;
		this.mode = "raise";
		this._localPoint = new THREE.Vector3();
		this._localDelta = new THREE.Vector3();
		this._vertex = new THREE.Vector3();
		this._normal = new THREE.Vector3();
		this._inverseLinear = new THREE.Matrix3();
		this._worldScale = new THREE.Vector3();
		this._worldBounds = new THREE.Box3();
		this._worldSphere = new THREE.Sphere();
	}

	setMeshes(meshes) {
		this.meshes = meshes;
	}

	update({ hands = [], pinch = false, midpoint = null, delta = new THREE.Vector3() } = {}) {
		if (!this.enabled || !this.root.visible || !hands.length) {
			return { colliding: false, pinching: false, sculpted: false };
		}
		let colliding = false;
		let sculpted = false;
		if (pinch && midpoint) {
			const hit = this._deform(midpoint, delta, "pull");
			colliding ||= hit.colliding;
			sculpted ||= hit.sculpted;
		} else {
			const points = hands[0].points;
			for (const index of [4, 8]) {
				const hit = this._deform(points[index], new THREE.Vector3(), this.mode);
				colliding ||= hit.colliding;
				sculpted ||= hit.sculpted;
			}
		}
		return { colliding, pinching: pinch && colliding, sculpted };
	}

	_deform(worldPoint, delta, mode) {
		if (!worldPoint || !this._mayCollide(worldPoint)) return { colliding: false, sculpted: false };
		let colliding = false;
		let sculpted = false;
		for (const mesh of this.meshes) {
			mesh.updateWorldMatrix(true, false);
			mesh.geometry.computeBoundingSphere();
			const sphere = mesh.geometry.boundingSphere;
			if (!sphere) continue;
			mesh.getWorldScale(this._worldScale);
			const maxScale = Math.max(Math.abs(this._worldScale.x), Math.abs(this._worldScale.y), Math.abs(this._worldScale.z));
			this._worldSphere.center.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
			this._worldSphere.radius = sphere.radius * maxScale + this.brushRadius;
			if (!this._worldSphere.containsPoint(worldPoint)) continue;

			this._localPoint.copy(worldPoint);
			mesh.worldToLocal(this._localPoint);
			const radius = this.brushRadius / Math.max(maxScale, 0.0001);
			const radiusSquared = radius * radius;
			const position = mesh.geometry.attributes.position;
			const normal = mesh.geometry.attributes.normal;
			const deltaLength = delta.length();
			const pull = mode === "pull" && deltaLength > 0.0001 && deltaLength < 0.12;
			if (mode === "pull" && pull) {
				this._inverseLinear.setFromMatrix4(mesh.matrixWorld).invert();
				this._localDelta.copy(delta).applyMatrix3(this._inverseLinear);
			}
			let changed = false;
			for (let index = 0; index < position.count; index += 1) {
				this._vertex.fromBufferAttribute(position, index);
				const distanceSquared = this._vertex.distanceToSquared(this._localPoint);
				if (distanceSquared >= radiusSquared) continue;
				colliding = true;
				const weight = Math.pow(1 - Math.sqrt(distanceSquared) / radius, 2);
				if (mode === "pull") {
					if (!pull) continue;
					this._vertex.addScaledVector(this._localDelta, weight);
				} else {
					if (normal) this._normal.fromBufferAttribute(normal, index).normalize().negate();
					else this._normal.set(0, 0, 1);
					const sign = this.mode === "lower" ? 1 : -1;
					this._vertex.addScaledVector(this._normal, this.strength * sign * weight);
				}
				position.setXYZ(index, this._vertex.x, this._vertex.y, this._vertex.z);
				changed = true;
			}
			if (changed) {
				position.needsUpdate = true;
				mesh.geometry.computeVertexNormals();
				mesh.geometry.computeBoundingSphere();
				mesh.geometry.computeBoundingBox();
				sculpted = true;
			}
		}
		return { colliding, sculpted };
	}

	_mayCollide(worldPoint) {
		this.root.updateWorldMatrix(true, true);
		this._worldBounds.setFromObject(this.root);
		return this._worldBounds.isEmpty() || this._worldBounds.distanceToPoint(worldPoint) <= this.brushRadius;
	}
}
