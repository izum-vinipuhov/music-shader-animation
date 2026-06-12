import {Renderer, Camera, Transform, Plane, Program, Mesh} from 'ogl'
import {vertexShader} from '@/shaders/vertex.glsl'
import {createFragmentShader} from '@/shaders/fragment.glsl'
import {
    UniformsState,
    defaultShaderOptions,
    type ShaderOptions,
    type ApplySettingsArgs,
    type AudioFrequencies,
} from '@/lib/uniforms'
import {clamp} from '@/lib/color'

export enum AnimationState {
    DEFAULT = 'DEFAULT',
    LITE = 'LITE',
}

interface PlatformProfile {
    isAndroid: boolean
    isIOS: boolean
    isMobile: boolean
    dprCap: number
    renderScale: number
    fps: number
    forceLite: boolean
}

function detectPlatform(): PlatformProfile {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    const isAndroid = /Android/i.test(ua)
    const isIOS =
        /iPad|iPhone|iPod/.test(ua) ||
        (typeof navigator !== 'undefined' &&
            navigator.platform === 'MacIntel' &&
            (navigator as any).maxTouchPoints > 1)

    if (isAndroid) {
        return {
            isAndroid: true,
            isIOS: false,
            isMobile: true,
            dprCap: 1.2,
            renderScale: 0.75,
            fps: 60,
            forceLite: true,
        }
    }
    if (isIOS) {
        return {
            isAndroid: false,
            isIOS: true,
            isMobile: true,
            dprCap: 1.5,
            renderScale: 0.85,
            fps: 60,
            forceLite: false,
        }
    }
    return {
        isAndroid: false,
        isIOS: false,
        isMobile: false,
        dprCap: 1.5,
        renderScale: 0.85,
        fps: 60,
        forceLite: false,
    }
}

class Ticker {
    private fps: number
    private render: (dt: number) => void
    private isActive = false
    private requestId = 0

    constructor(fps: number, render: (dt: number) => void) {
        this.fps = fps
        this.render = render
    }

    setFps(fps: number) {
        this.fps = fps
    }

    start() {
        if (this.isActive) return
        let last = performance.now()
        const interval = 1000 / this.fps
        const loop = (now: number) => {
            this.requestId = requestAnimationFrame(loop)
            const dt = now - last
            if (dt >= interval - 0.1) {
                last = now - (dt % interval)
                this.render(dt)
            }
        }
        this.isActive = true
        this.requestId = requestAnimationFrame(loop)
    }

    stop() {
        if (!this.isActive) return
        this.isActive = false
        cancelAnimationFrame(this.requestId)
        this.requestId = 0
    }

    get active() {
        return this.isActive
    }
}

export interface MusicAnimationCoreConfig {
    canvas: HTMLCanvasElement
    state?: AnimationState
    collectionHue?: number
    shaderOptions?: Partial<ShaderOptions>
    onError?: (e: unknown) => void
    forceProfile?: Partial<PlatformProfile>
    monochrome?: boolean
    manageLifecycleExternally?: boolean
}

export class MusicAnimationCore {
    private isRenderingEnabled = true
    private state: AnimationState
    private renderer!: Renderer
    private camera!: Camera
    private scene = new Transform()
    private program!: Program
    private mesh!: Mesh
    private ticker!: Ticker
    uniforms!: UniformsState
    private shaderOptions: ShaderOptions
    private monochrome: boolean
    private canvas: HTMLCanvasElement
    private resizeObserver: ResizeObserver | null = null
    private profile: PlatformProfile

    private contextLost = false
    private wasRenderingBeforeContextLoss = false

    private isPaused = false
    private wasRenderingBeforePause = false

    private resizeRafId = 0
    private lastResizeTs = 0

    private destroyed = false
    private manageLifecycleExternally: boolean

    private onContextLost = (e: Event) => this.handleContextLost(e)
    private onContextRestored = () => this.handleContextRestored()
    private onVisibilityChange = () => this.handleVisibilityChange()
    private onPageHide = () => this.handlePageHide()
    private onPageShow = () => this.handlePageShow()
    private onFreeze = () => this.handlePageHide()
    private onResume = () => this.handlePageShow()

    private onError?: (e: unknown) => void

    constructor(config: MusicAnimationCoreConfig) {
        this.canvas = config.canvas
        this.shaderOptions = {...defaultShaderOptions, ...config.shaderOptions}
        this.monochrome = config.monochrome ?? false
        this.profile = {...detectPlatform(), ...(config.forceProfile ?? {})}
        this.onError = config.onError
        this.manageLifecycleExternally = config.manageLifecycleExternally ?? false

        const requestedState = config.state ?? AnimationState.DEFAULT
        this.state =
            this.profile.forceLite && requestedState === AnimationState.DEFAULT
                ? AnimationState.LITE
                : requestedState

        try {
            this.uniforms = new UniformsState(config.collectionHue ?? 10, this.shaderOptions)
            this.uniforms.setMonochrome(this.monochrome)
            this.initRenderer()
            this.attachContextListeners()
            this.initShader()
            this.initResizeObserver()

            if (!this.manageLifecycleExternally) {
                this.attachLifecycleListeners()
            }

            this.ticker = new Ticker(this.profile.fps, this.render.bind(this))
            this.ticker.start()
        } catch (e) {
            this.onError?.(e)
        }
    }

    private getEffectiveDpr(): number {
        const raw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
        return Math.min(raw, this.profile.dprCap)
    }

    private initRenderer() {
        const dpr = this.getEffectiveDpr()
        this.renderer = new Renderer({
            canvas: this.canvas,
            alpha: this.shaderOptions.transparent,
            antialias: false,
            premultipliedAlpha: this.shaderOptions.transparent,
            preserveDrawingBuffer: this.shaderOptions.transparent && !this.profile.isAndroid,
            dpr,
            powerPreference: this.profile.isAndroid ? 'high-performance' : 'default',
        } as any)
        this.camera = new Camera(this.renderer.gl)
    }

    private attachContextListeners() {
        this.canvas.addEventListener('webglcontextlost', this.onContextLost, false)
        this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false)
    }

    private detachContextListeners() {
        this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
        this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    }

    private attachLifecycleListeners() {
        if (typeof document === 'undefined') return
        document.addEventListener('visibilitychange', this.onVisibilityChange)
        window.addEventListener('pagehide', this.onPageHide)
        window.addEventListener('pageshow', this.onPageShow)
        document.addEventListener('freeze', this.onFreeze as any)
        document.addEventListener('resume', this.onResume as any)
    }

    private detachLifecycleListeners() {
        if (typeof document === 'undefined') return
        document.removeEventListener('visibilitychange', this.onVisibilityChange)
        window.removeEventListener('pagehide', this.onPageHide)
        window.removeEventListener('pageshow', this.onPageShow)
        document.removeEventListener('freeze', this.onFreeze as any)
        document.removeEventListener('resume', this.onResume as any)
    }

    private getShaderSources() {
        const circleCount = this.state === AnimationState.LITE ? 2 : 3
        return {
            vertex: vertexShader,
            fragment: createFragmentShader(circleCount, this.shaderOptions.transparent, this.monochrome),
        }
    }

    private disposeGpuResources() {
        try {
            const gl = this.renderer?.gl
            if (!gl) return
            if (this.program && (this.program as any).program) {
                try {
                    gl.deleteProgram((this.program as any).program)
                } catch {
                }
            }
            if (this.mesh?.geometry) {
                const geom = this.mesh.geometry as any
                try {
                    if (geom.attributes) {
                        Object.values(geom.attributes).forEach((attr: any) => {
                            if (attr?.buffer) {
                                try {
                                    gl.deleteBuffer(attr.buffer)
                                } catch {
                                }
                            }
                        })
                    }
                    if (geom.index?.buffer) {
                        try {
                            gl.deleteBuffer(geom.index.buffer)
                        } catch {
                        }
                    }
                } catch {
                }
            }
        } catch {
        }
    }

    private initShader() {
        const gl = this.renderer.gl
        const geometry = new Plane(gl, {width: 2, height: 2})
        this.program = new Program(gl, {
            ...this.getShaderSources(),
            uniforms: this.uniforms.toUniforms(),
        })
        this.mesh = new Mesh(gl, {geometry, program: this.program})
        this.mesh.setParent(this.scene)
    }

    private recreateGpuResources() {
        try {
            this.disposeGpuResources()
            this.scene = new Transform()
            this.initShader()
        } catch (e) {
            this.onError?.(e)
        }
    }

    private initResizeObserver() {
        const parent = this.canvas.parentElement
        if (!parent) return

        const update = () => {
            if (this.destroyed) return
            const rect = parent.getBoundingClientRect()
            const cssW = rect.width
            const cssH = rect.height
            if (cssW <= 0 || cssH <= 0) return

            const renderW = cssW * this.profile.renderScale
            const renderH = cssH * this.profile.renderScale

            this.uniforms.setSize(renderW, renderH, this.getEffectiveDpr())
            this.renderer.setSize(renderW, renderH)

            if (this.profile.renderScale < 1) {
                this.canvas.style.width = `${cssW}px`
                this.canvas.style.height = `${cssH}px`
            }
        }

        update()

        const throttled = () => {
            if (this.destroyed) return
            if (this.resizeRafId) return
            this.resizeRafId = requestAnimationFrame(() => {
                this.resizeRafId = 0
                if (this.destroyed) return
                const now = performance.now()
                if (now - this.lastResizeTs < 80) return
                this.lastResizeTs = now
                update()
            })
        }

        this.resizeObserver = new ResizeObserver(throttled)
        this.resizeObserver.observe(parent)
    }

    private handleContextLost(e: Event) {
        e.preventDefault()
        this.contextLost = true
        this.wasRenderingBeforeContextLoss = this.isRenderingEnabled
        this.ticker?.stop()
    }

    private handleContextRestored() {
        if (!this.contextLost) return
        this.contextLost = false

        try {
            this.recreateGpuResources()

            const parent = this.canvas.parentElement
            if (parent) {
                const rect = parent.getBoundingClientRect()
                const renderW = rect.width * this.profile.renderScale
                const renderH = rect.height * this.profile.renderScale
                this.uniforms.setSize(renderW, renderH, this.getEffectiveDpr())
                this.renderer.setSize(renderW, renderH)
            }

            if (this.wasRenderingBeforeContextLoss && !this.isPaused && !this.destroyed) {
                this.ticker.start()
            }
        } catch (err) {
            this.onError?.(err)
        }
    }

    private handleVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            this.handlePageHide()
        } else {
            this.handlePageShow()
        }
    }

    private handlePageHide() {
        if (this.isPaused) return
        this.isPaused = true
        this.wasRenderingBeforePause = this.ticker?.active ?? false
        this.ticker?.stop()
    }

    private handlePageShow() {
        if (!this.isPaused) return
        this.isPaused = false

        if (this.contextLost || this.destroyed) return

        if (this.wasRenderingBeforePause && this.isRenderingEnabled) {
            this.ticker.start()
        }
    }

    /** Enables/disables monochrome mode: rebuilds the shader and updates the background */
    setMonochrome(value: boolean) {
        if (this.destroyed) return
        if (this.monochrome === value) return
        this.monochrome = value
        this.uniforms.setMonochrome(value)
        if (!this.contextLost) {
            this.recreateGpuResources()
        }
    }

    enableLiteAnimation() {
        if (this.state === AnimationState.LITE) return
        this.state = AnimationState.LITE
        if (!this.contextLost && !this.destroyed) {
            this.recreateGpuResources()
        }
    }

    applySettings(settings: ApplySettingsArgs = {}) {
        if (this.destroyed) return
        const {hue, collectionHue, energy, backgroundColor, baseScale} = settings

        if (typeof hue === 'number' && typeof collectionHue === 'number') {
            this.uniforms.updateColor(clamp(hue, 0, 360), collectionHue)
        }
        if (typeof energy === 'number') {
            this.uniforms.updateEnergy(0.4 * (energy + 1))
        }
        if (typeof backgroundColor === 'number') {
            this.uniforms.updateBackgroundColor(backgroundColor)
        }
        if (typeof baseScale === 'number') {
            this.uniforms.updateBaseScale(clamp(baseScale))
        }
    }

    playAnimation(args: ApplySettingsArgs = {}) {
        if (this.destroyed) return
        this.uniforms.updatePlayingState(true)
        this.applySettings({energy: args.energy ?? 0.6, ...args})
    }

    idleAnimation() {
        if (this.destroyed) return
        this.uniforms.updateEnergy(0.2)
        this.uniforms.updatePlayingState(false)
    }

    likeAnimation() {
        if (this.destroyed) return
        const u = this.uniforms
        u.updateReactiveTop(0.7)
        setTimeout(() => {
            if (!this.destroyed) u.updateReactiveMiddle(0.7)
        }, 100)
        setTimeout(() => {
            if (!this.destroyed) u.updateReactiveBottom(0.7)
        }, 150)
        setTimeout(() => {
            if (!this.destroyed) u.updateReactiveTop(0)
        }, 850)
        setTimeout(() => {
            if (!this.destroyed) u.updateReactiveMiddle(0)
        }, 950)
        setTimeout(() => {
            if (!this.destroyed) u.updateReactiveBottom(0)
        }, 1050)
    }

    updateLayout(isMobile: boolean) {
        if (this.destroyed) return
        this.uniforms.updateLayout(isMobile)
    }

    updateAudioFrequencies(f: AudioFrequencies) {
        if (this.destroyed || this.contextLost) return
        this.uniforms.updateAudioFrequencies(f)
    }

    enableRender() {
        if (this.destroyed) return
        this.isRenderingEnabled = true
        if (!this.contextLost && !this.isPaused) {
            this.ticker.start()
        }
    }

    disableRender() {
        this.isRenderingEnabled = false
        this.ticker?.stop()
    }

    resume() {
        if (this.destroyed) return
        this.isRenderingEnabled = true
        this.isPaused = false

        if (!this.contextLost && !this.destroyed) {
            this.ticker?.start()
        }
    }

    pause() {
        this.isRenderingEnabled = false
        this.isPaused = true
        this.ticker?.stop()
    }

    private render(dt = 1) {
        if (this.destroyed) return
        if (!this.isRenderingEnabled) return
        if (this.contextLost) return
        if (this.isPaused) return

        const gl = this.renderer.gl
        if (gl.isContextLost && gl.isContextLost()) {
            this.contextLost = true
            this.ticker.stop()
            return
        }

        try {
            this.uniforms.update(dt)
            const next = this.uniforms.toUniforms()
            Object.entries(next).forEach(([key, {value}]) => {
                const u = this.program.uniforms[key]
                if (!u) return
                u.value = value
            })
            this.renderer.render({scene: this.scene, camera: this.camera})
        } catch (e) {
            this.contextLost = true
            this.ticker.stop()
            this.onError?.(e)
        }
    }

    destroy() {
        if (this.destroyed) return
        this.destroyed = true

        this.ticker?.stop()

        if (this.resizeRafId) {
            cancelAnimationFrame(this.resizeRafId)
            this.resizeRafId = 0
        }

        this.resizeObserver?.disconnect()
        this.resizeObserver = null

        this.detachContextListeners()
        this.detachLifecycleListeners()

        this.disposeGpuResources()

        try {
            const gl = this.renderer?.gl
            if (gl) {
                const ext = gl.getExtension('WEBGL_lose_context')
                try {
                    ext?.loseContext()
                } catch {
                }
            }
        } catch {
        }

        this.program = null as any
        this.mesh = null as any
        this.scene = null as any
        this.camera = null as any
        this.renderer = null as any
        this.uniforms = null as any
    }
}