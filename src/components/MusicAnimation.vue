<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {AnimationState, MusicAnimationCore} from '@/lib/animation'
import {ApplySettingsArgs, AudioFrequencies, ShaderOptions} from '@/lib/uniforms'

interface Props {
  hue?: number
  collectionHue?: number
  energy?: number
  isPlaying?: boolean
  isMobile?: boolean
  backgroundColor?: number
  monochrome?: boolean
  transparent?: boolean
  state?: AnimationState
  size?: number | string
  mode?: 'square' | 'fill'
  audioFrequencies?: AudioFrequencies | null
  shaderOptions?: Partial<ShaderOptions>
}

const props = withDefaults(defineProps<Props>(), {
  hue: 200,
  collectionHue: 10,
  energy: 1,
  isPlaying: true,
  isMobile: false,
  backgroundColor: 0.07,
  monochrome: false,
  transparent: false,
  state: AnimationState.DEFAULT,
  size: '100%',
  mode: 'square',
  audioFrequencies: null,
})

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animation: MusicAnimationCore | null = null

const handleLike = () => animation?.likeAnimation()

defineExpose({
  likeAnimation: handleLike,
  applySettings: (args: ApplySettingsArgs) => animation?.applySettings(args),
  updateAudioFrequencies: (f: AudioFrequencies) => animation?.updateAudioFrequencies(f),
  /** Stops the render without destroying the context — for KeepAlive deactivated */
  pause: () => animation?.pause(),
  /** Resumes the render — for KeepAlive activated */
  resume: () => animation?.resume(),
  /** Full destruction — for onBeforeUnmount */
  destroy: () => {
    animation?.destroy()
    animation = null
  },
})

onMounted(() => {
  if (!canvasRef.value) return
  animation = new MusicAnimationCore({
    canvas: canvasRef.value,
    state: props.state,
    collectionHue: props.collectionHue,
    monochrome: props.monochrome,
    shaderOptions: {
      transparent: props.transparent,
      ...(props.shaderOptions ?? {}),
    },
    onError: (e) => console.error('[MusicAnimation]', e),
    manageLifecycleExternally: true,
  })

  animation.applySettings({
    hue: props.hue,
    collectionHue: props.collectionHue,
    energy: props.energy,
    backgroundColor: props.backgroundColor,
  })

  animation.updateLayout(props.isMobile)

  if (props.isPlaying) {
    animation.playAnimation({
      hue: props.hue,
      energy: props.energy,
      collectionHue: props.collectionHue,
    })
  } else {
    animation.idleAnimation()
  }

  if (props.audioFrequencies) {
    animation.updateAudioFrequencies(props.audioFrequencies)
  }
})

onBeforeUnmount(() => {
  animation?.destroy()
  animation = null
})

watch(
    () => props.isPlaying,
    (playing) => {
      if (!animation) return
      if (playing) {
        animation.playAnimation({
          hue: props.hue,
          energy: props.energy,
          collectionHue: props.collectionHue,
        })
      } else {
        animation.idleAnimation()
      }
    }
)

watch(
    () => [props.hue, props.collectionHue, props.energy, props.backgroundColor],
    () => {
      animation?.applySettings({
        hue: props.hue,
        collectionHue: props.collectionHue,
        energy: props.energy,
        backgroundColor: props.backgroundColor,
      })
    }
)

watch(
    () => props.isMobile,
    (m) => animation?.updateLayout(m)
)

watch(
    () => props.state,
    (s) => {
      if (s === AnimationState.LITE) animation?.enableLiteAnimation()
    }
)

watch(
    () => props.monochrome,
    (m) => animation?.setMonochrome(!!m)
)

watch(
    () => props.audioFrequencies,
    (f) => {
      if (animation && f) animation.updateAudioFrequencies(f)
    },
    {deep: true}
)
</script>

<template>
  <div
      ref="containerRef"
      class="animation-wrapper"
      :class="mode === 'fill' ? 'animation-wrapper--fill' : 'animation-wrapper--square'"
      :style="
      {
        width: typeof size === 'number' ? `${size}px` : size,
        aspectRatio: '1 / 1'
      }
    "
  >
    <canvas ref="canvasRef" class="animation-canvas" :class="{ 'animation-canvas--fill': mode === 'fill' }"/>
  </div>
</template>

<style scoped>
.animation-wrapper {
  position: relative;
  display: block;
}

.animation-wrapper--fill {
  width: 100%;
  height: 100%;
}

.animation-canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.animation-canvas--fill {
  border-radius: 0;
  width: 100%;
  height: 100%;
}
</style>