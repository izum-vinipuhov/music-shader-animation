/** Smooth interpolation of a value toward target over duration ms */
export class EasedValue {
    private currentValue: number
    private targetValue: number
    private elapsedTime = 0
    private duration: number

    constructor(initial: number, target: number, duration: number) {
        this.currentValue = initial
        this.targetValue = target
        this.duration = duration
    }

    get value() {
        return this.currentValue
    }

    update(target: number) {
        this.targetValue = target
        this.elapsedTime = 0
    }

    next(deltaMs: number): number {
        const t = Math.min(Math.max(this.elapsedTime / this.duration, 0), 1)
        this.elapsedTime += deltaMs
        this.currentValue = this.currentValue + (this.targetValue - this.currentValue) * t
        return this.currentValue
    }
}

export class EasedColor {
    r: EasedValue
    g: EasedValue
    b: EasedValue

    constructor(rgb: [number, number, number], duration = 3000) {
        this.r = new EasedValue(rgb[0], rgb[0], duration)
        this.g = new EasedValue(rgb[1], rgb[1], duration)
        this.b = new EasedValue(rgb[2], rgb[2], duration)
    }

    get value(): [number, number, number] {
        return [this.r.value, this.g.value, this.b.value]
    }

    update(rgb: [number, number, number]) {
        this.r.update(rgb[0])
        this.g.update(rgb[1])
        this.b.update(rgb[2])
    }

    next(deltaMs: number) {
        this.r.next(deltaMs)
        this.g.next(deltaMs)
        this.b.next(deltaMs)
    }
}