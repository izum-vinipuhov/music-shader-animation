import {Vec3, Vec2} from 'ogl'
import {EasedValue, EasedColor} from '@/lib/easing'
import {hslToRgb, oppositeHue, shiftHue, randomInt, clamp} from '@/lib/color'

export interface ShaderOptions {
    transparent: boolean
    canvasSize: {
        mobileSizePx: number
        desktopSizePx: number
        mobileScale: number
        desktopScale: number
    }
}

export const defaultShaderOptions: ShaderOptions = {
    transparent: false,
    canvasSize: {
        mobileSizePx: 430,
        desktopSizePx: 650,
        mobileScale: 0.4,
        desktopScale: 0.35,
    },
}

export interface AudioFrequencies {
    low: number
    middle: number
    high: number
}

export interface ApplySettingsArgs {
    hue?: number
    collectionHue?: number
    energy?: number
    backgroundColor?: number
    baseScale?: number
    useDefaultHue?: boolean
}

/** Palette of 6 colors (3 pairs: bottom / middle / top — start/end) */
class Palette {
    topStart: EasedColor
    topEnd: EasedColor
    middleStart: EasedColor
    middleEnd: EasedColor
    bottomStart: EasedColor
    bottomEnd: EasedColor

    constructor(hue = 10) {
        const [b, m, t, bE, mE, tE] = this.createParts(hue)
        this.bottomStart = b
        this.middleStart = m
        this.topStart = t
        this.bottomEnd = bE
        this.middleEnd = mE
        this.topEnd = tE
    }

    private createParts(hue: number): EasedColor[] {
        const op = oppositeHue(hue)
        const altHue = shiftHue(op + randomInt(30, 40), op)
        return [
            new EasedColor(hslToRgb(op, 1, 0.5)),
            new EasedColor(hslToRgb(300, 1, 0.5)),
            new EasedColor(hslToRgb(50, 1, 0.5)),
            new EasedColor(hslToRgb(altHue, 1, 0.5)),
            new EasedColor(hslToRgb(320, 1, 0.5)),
            new EasedColor(hslToRgb(50, 1, 0.5)),
        ]
    }

    /** All 6 colors in shader order: [b, m, t, bE, mE, tE] */
    get values(): [number, number, number][] {
        return [
            this.bottomStart.value,
            this.middleStart.value,
            this.topStart.value,
            this.bottomEnd.value,
            this.middleEnd.value,
            this.topEnd.value,
        ]
    }

    update(hue: number, collectionHue: number) {
        const top = oppositeHue(hue)
        const middle = shiftHue(top + randomInt(40, 80), top)
        const bottom = oppositeHue(collectionHue)

        this.topStart.update(hslToRgb(top, 1, 0.5))
        this.topEnd.update(hslToRgb(shiftHue(top + randomInt(30, 40), top), 1, 0.5))

        this.middleStart.update(hslToRgb(middle, 1, 0.5))
        this.middleEnd.update(hslToRgb(shiftHue(middle + randomInt(30, 40), top), 1, 0.5))

        this.bottomStart.update(hslToRgb(bottom, 1, 0.5))
        this.bottomEnd.update(hslToRgb(shiftHue(bottom + randomInt(30, 40), top), 1, 0.5))
    }

    next(dt: number) {
        this.topStart.next(dt)
        this.topEnd.next(dt)
        this.middleStart.next(dt)
        this.middleEnd.next(dt)
        this.bottomStart.next(dt)
        this.bottomEnd.next(dt)
    }
}

export class UniformsState {
    isMobile = false
    audioFrequencies: AudioFrequencies | null = null
    background: [number, number, number] = [0, 0, 0]
    /** Background brightness from the slider (used in normal mode) */
    backgroundLevel = 0
    /** Monochrome mode — the background is taken as a darkened vColor[0] */
    monochrome = false
    /** Background darkening factor in monochrome mode */
    monochromeBgFactor = 0.50
    /** Additive background lift in monochrome mode (makes the background lighter) */
    monochromeBgLift = 0.05
    baseScale = 1
    energy: EasedValue
    time = Math.floor(Math.random() * 3600)
    palette: Palette
    rotation: [number, number, number][] = [
        [-0.4, 0.4, 0.25],
        [-0.4, -0.4, -0.25],
        [-0.4, -0.4, 0.25],
    ]
    audioLow = 0
    audioMiddle = 0
    audioHigh = 0
    audioRatio: EasedValue
    reactiveTop: EasedValue
    reactiveMiddle: EasedValue
    reactiveBottom: EasedValue
    point: [number, number] = [0, 0]
    interaction = 0

    /** Sizes in physical pixels (for the shader) */
    width = 0
    height = 0
    /** CSS sizes (for the canvas element) */
    cssWidth = 0
    cssHeight = 0
    dpr = 1

    shaderOptions: ShaderOptions

    // ===== Cached objects for GPU uniforms (no allocations in the hot path) =====
    private _vScreenSize: Vec2
    private _vColorBackground: Vec3
    private _vColorArr: Vec3[]
    private _vRotationArr: Vec3[]
    private _vAudioArr: number[]
    private _vReactiveArr: number[]
    private _vInteractionPoint: Vec2

    constructor(hue: number, opts: ShaderOptions) {
        this.shaderOptions = opts
        this.palette = new Palette(hue)
        this.energy = new EasedValue(0.2, 0.2, 1000)
        this.audioRatio = new EasedValue(0, 0, 1000)
        this.reactiveTop = new EasedValue(0, 0, 600)
        this.reactiveMiddle = new EasedValue(0, 0, 600)
        this.reactiveBottom = new EasedValue(0, 0, 600)

        // Create once — then only mutate
        this._vScreenSize = new Vec2(0, 0)
        this._vColorBackground = new Vec3(0, 0, 0)
        this._vColorArr = [
            new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(0, 0, 0),
            new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(0, 0, 0),
        ]
        this._vRotationArr = [
            new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(0, 0, 0),
        ]
        this._vAudioArr = [0, 0, 0]
        this._vReactiveArr = [0, 0, 0]
        this._vInteractionPoint = new Vec2(0, 0)
    }

    get size() {
        return {
            width: this.width,
            height: this.height,
            cssWidth: this.cssWidth,
            cssHeight: this.cssHeight,
        }
    }

    get fragmentScale() {
        return this.isMobile
            ? this.baseScale * this.shaderOptions.canvasSize.mobileScale
            : this.baseScale * this.shaderOptions.canvasSize.desktopScale
    }

    updateLayout(isMobile: boolean) {
        this.isMobile = isMobile
    }

    updateAudioFrequencies(f: AudioFrequencies) {
        this.audioFrequencies = f
    }

    /** Sets the canvas size taking DPR into account */
    setSize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1) {
        this.cssWidth = cssWidth
        this.cssHeight = cssHeight
        this.dpr = dpr
        this.width = Math.round(cssWidth * dpr)
        this.height = Math.round(cssHeight * dpr)
    }

    updatePlayingState(isPlaying: boolean) {
        this.audioRatio.update(isPlaying ? 1 : 0)
    }

    updateColor(hue: number, collectionHue: number) {
        this.palette.update(hue, collectionHue)
        if (this.monochrome) this.applyMonochromeBackground()
    }

    /** Enables/disables monochrome and updates the background accordingly */
    setMonochrome(value: boolean) {
        this.monochrome = value
        if (value) {
            this.applyMonochromeBackground()
        } else {
            this.updateBackgroundColor(this.backgroundLevel)
        }
    }

    /**
     * Takes the current vColor[0] color and makes the background the same color but darker.
     * monochromeBgLift adds an overall lift so the background isn't almost black.
     */
    private applyMonochromeBackground() {
        const base = this.palette.values[0]
        const f = this.monochromeBgFactor
        const lift = this.monochromeBgLift
        this.background[0] = clamp(base[0] * f + lift)
        this.background[1] = clamp(base[1] * f + lift)
        this.background[2] = clamp(base[2] * f + lift)
    }

    updateBackgroundColor(value: number) {
        this.backgroundLevel = value
        // In monochrome mode the background is driven by color, the slider is ignored
        if (this.monochrome) {
            this.applyMonochromeBackground()
            return
        }
        this.background[0] = value
        this.background[1] = value
        this.background[2] = value
    }

    updateBaseScale(scale: number) {
        this.baseScale = clamp(scale)
    }

    updateEnergy(energy: number) {
        this.energy.update(energy)
    }

    updateReactiveTop(v: number) {
        this.reactiveTop.update(v)
    }

    updateReactiveMiddle(v: number) {
        this.reactiveMiddle.update(v)
    }

    updateReactiveBottom(v: number) {
        this.reactiveBottom.update(v)
    }

    private updateTime(dt: number) {
        const incr = (this.energy.value * dt) / 1000
        this.time = (this.time + incr) % 86400
    }

    private getUpdatedAudioParam(prev: number, target: number, decay = 0.02) {
        const cur = clamp(prev)
        const next = clamp(target)
        if (next > cur) return next
        if (next < cur) return cur - Math.min(decay, cur - next)
        return cur
    }

    update(dt: number) {
        this.energy.next(dt)
        this.palette.next(dt)
        if (this.monochrome) this.applyMonochromeBackground()
        this.reactiveTop.next(dt)
        this.reactiveMiddle.next(dt)
        this.reactiveBottom.next(dt)
        this.updateTime(dt)

        if (this.audioFrequencies) {
            this.audioRatio.next(dt)
            this.audioLow =
                this.getUpdatedAudioParam(this.audioLow, this.audioFrequencies.low) *
                this.audioRatio.value
            this.audioMiddle =
                this.getUpdatedAudioParam(this.audioMiddle, this.audioFrequencies.middle) *
                this.audioRatio.value
            this.audioHigh =
                this.getUpdatedAudioParam(this.audioHigh, this.audioFrequencies.high) *
                this.audioRatio.value
        }
    }

    toUniforms() {
        // Fill the caches with current values
        this.syncCache()

        return {
            vScreenSize: {value: this._vScreenSize},
            vTime: {value: this.time},
            vScale: {value: this.fragmentScale},
            vColorBackground: {value: this._vColorBackground},
            vColor: {value: this._vColorArr},
            vRotation: {value: this._vRotationArr},
            vAudio: {value: this._vAudioArr},
            vReactive: {value: this._vReactiveArr},
            vInteractionPoint: {value: this._vInteractionPoint},
            vInteraction: {value: this.interaction},
        }
    }

    /**
     * Updates the Program uniforms in-place — NO ALLOCATIONS.
     * Called every frame.
     */
    applyToProgram(program: any) {
        this.syncCache()

        const u = program.uniforms
        if (!u) return

        // Scalar values — just replace .value (a number, not an object)
        if (u.vTime) u.vTime.value = this.time
        if (u.vScale) u.vScale.value = this.fragmentScale
        if (u.vInteraction) u.vInteraction.value = this.interaction
    }

    /** Fills the cached Vec2/Vec3/arrays with current values (no allocations) */
    private syncCache() {
        // vScreenSize
        this._vScreenSize.x = this.width
        this._vScreenSize.y = this.height

        // vColorBackground
        this._vColorBackground.x = this.background[0]
        this._vColorBackground.y = this.background[1]
        this._vColorBackground.z = this.background[2]

        // vColor (palette — 6 colors)
        const paletteValues = this.palette.values
        for (let i = 0; i < 6; i++) {
            const c = paletteValues[i]
            const v = this._vColorArr[i]
            v.x = c[0]
            v.y = c[1]
            v.z = c[2]
        }

        // vRotation (3 vectors)
        for (let i = 0; i < 3; i++) {
            const r = this.rotation[i]
            const v = this._vRotationArr[i]
            v.x = r[0]
            v.y = r[1]
            v.z = r[2]
        }

        // vAudio
        this._vAudioArr[0] = this.audioLow
        this._vAudioArr[1] = this.audioMiddle
        this._vAudioArr[2] = this.audioHigh

        // vReactive
        this._vReactiveArr[0] = this.reactiveTop.value
        this._vReactiveArr[1] = this.reactiveMiddle.value
        this._vReactiveArr[2] = this.reactiveBottom.value

        // vInteractionPoint
        this._vInteractionPoint.x = this.point[0]
        this._vInteractionPoint.y = this.point[1]
    }
}