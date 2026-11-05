import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

const clayMaterial = new THREE.MeshStandardMaterial({
	color: "#c7775b",
	roughness: 0.82,
	metalness: 0,
});

export class ModelLoader {
	static createDefault() {
		return this._normalizeGeometry(new THREE.IcosahedronGeometry(0.12, 24));
	}

	static async load(file) {
		const extension = file.name.split(".").pop()?.toLowerCase();
		let root;
		if (extension === "stl") {
			root = new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer()));
		} else if (extension === "obj") {
			root = new OBJLoader().parse(await file.text());
		} else if (extension === "3mf") {
			root = new ThreeMFLoader().parse(await file.arrayBuffer());
		} else {
			throw new Error("Choose a supported .stl, .obj, or .3mf model.");
		}

		root.updateWorldMatrix(true, true);
		const geometries = [];
		root.traverse((object) => {
			if (!object.isMesh || !object.geometry?.attributes?.position) return;
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", object.geometry.attributes.position.clone());
			if (object.geometry.index) geometry.setIndex(object.geometry.index.clone());
			geometry.applyMatrix4(object.matrixWorld);
			geometries.push(geometry);
		});
		if (!geometries.length) throw new Error("The selected file contains no mesh geometry.");

		const merged = geometries.length === 1
			? geometries[0]
			: BufferGeometryUtils.mergeGeometries(geometries, false);
		for (const geometry of geometries) {
			if (geometry !== merged) geometry.dispose();
		}
		if (!merged) throw new Error("The model's separate mesh parts could not be combined.");
		return this._normalizeGeometry(merged);
	}

	static exportSTL(object) {
		return new STLExporter().parse(object, { binary: true });
	}

	static _normalizeGeometry(sourceGeometry, maximumRadius = 0.3) {
		const positionsOnly = new THREE.BufferGeometry();
		positionsOnly.setAttribute("position", sourceGeometry.attributes.position.clone());
		if (sourceGeometry.index) positionsOnly.setIndex(sourceGeometry.index.clone());
		sourceGeometry.dispose();
		const welded = BufferGeometryUtils.mergeVertices(positionsOnly, 0.0001);
		positionsOnly.dispose();
		welded.computeVertexNormals();
		const bounds = new THREE.Box3().setFromBufferAttribute(welded.attributes.position);
		const center = bounds.getCenter(new THREE.Vector3());
		welded.translate(-center.x, -center.y, -center.z);
		welded.computeBoundingSphere();
		if (!welded.boundingSphere || !Number.isFinite(welded.boundingSphere.radius) || welded.boundingSphere.radius <= 0) {
			welded.dispose();
			throw new Error("The model has no measurable dimensions.");
		}
		welded.scale(maximumRadius / welded.boundingSphere.radius, maximumRadius / welded.boundingSphere.radius, maximumRadius / welded.boundingSphere.radius);
		welded.computeVertexNormals();
		welded.attributes.position.setUsage(THREE.DynamicDrawUsage);
		welded.computeBoundingSphere();
		welded.computeBoundingBox();
		return new THREE.Mesh(welded, clayMaterial.clone());
	}
}
