const smoothingFactor = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

// One Euro filter: heavy smoothing while the signal is slow (kills jitter), light smoothing
// while it moves fast (keeps latency low).
export class OneEuroFilter {
	constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
		this.minCutoff = minCutoff;
		this.beta = beta;
		this.dCutoff = dCutoff;
		this.reset();
	}

	reset() {
		this.time = null;
		this.value = 0;
		this.derivative = 0;
	}

	filter(value, time) {
		if (this.time === null) {
			this.time = time;
			this.value = value;
			return value;
		}
		const dt = Math.max(time - this.time, 1e-3);
		const rawDerivative = (value - this.value) / dt;
		this.derivative += smoothingFactor(this.dCutoff, dt) * (rawDerivative - this.derivative);
		const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
		this.value += smoothingFactor(cutoff, dt) * (value - this.value);
		this.time = time;
		return this.value;
	}
}

export class LandmarkSmoother {
	constructor(options, count = 21) {
		this.filters = Array.from({ length: count }, () => ({
			x: new OneEuroFilter(options),
			y: new OneEuroFilter(options),
			z: new OneEuroFilter(options),
		}));
	}

	filter(landmarks, time) {
		return landmarks.map((landmark, index) => {
			const filters = this.filters[index];
			return {
				x: filters.x.filter(landmark.x, time),
				y: filters.y.filter(landmark.y, time),
				z: filters.z.filter(landmark.z, time),
			};
		});
	}
}
