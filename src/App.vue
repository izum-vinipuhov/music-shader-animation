<script setup lang="ts">
import {onBeforeUnmount, reactive, ref, computed} from 'vue'
import MusicAnimation from '@/components/MusicAnimation.vue'
import type {AudioFrequencies} from '@/lib/uniforms'

const animationRef = ref<InstanceType<typeof MusicAnimation> | null>(null)

const settings = reactive({
  hue: 43,
  collectionHue: 10,
  energy: 1,
  backgroundColor: 0,
  monochrome: false,
})

const isPlaying = ref(false)
const panelVisible = ref(true)
const trackName = ref<string>('')
const currentTime = ref(0)
const duration = ref(0)

let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null
let freqData: Uint8Array | null = null
let rafId: number | null = null
let objectUrl: string | null = null

const audioEl = ref<HTMLAudioElement | null>(null)

function ensureAudioGraph() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.8
  freqData = new Uint8Array(analyser.frequencyBinCount)
  if (audioEl.value) {
    sourceNode = audioCtx.createMediaElementSource(audioEl.value)
    sourceNode.connect(analyser)
    analyser.connect(audioCtx.destination)
  }
}

function averageBand(data: Uint8Array, from: number, to: number): number {
  let sum = 0
  const start = Math.max(0, from)
  const end = Math.min(data.length, to)
  for (let i = start; i < end; i++) sum += data[i]
  const count = end - start
  return count > 0 ? sum / count / 255 : 0
}

function analyseLoop() {
  if (!analyser || !freqData) return
  analyser.getByteFrequencyData(freqData)

  const bins = freqData.length
  const low = averageBand(freqData, 0, Math.floor(bins * 0.1))
  const middle = averageBand(freqData, Math.floor(bins * 0.1), Math.floor(bins * 0.4))
  const high = averageBand(freqData, Math.floor(bins * 0.4), bins)

  const f: AudioFrequencies = {low, middle, high}
  animationRef.value?.updateAudioFrequencies(f)

  if (audioEl.value) currentTime.value = audioEl.value.currentTime

  rafId = requestAnimationFrame(analyseLoop)
}

function startLoop() {
  if (rafId == null) rafId = requestAnimationFrame(analyseLoop)
}

function stopLoop() {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  trackName.value = file.name

  if (audioEl.value) {
    audioEl.value.src = objectUrl
    audioEl.value.load()
  }
}

async function togglePlay() {
  if (!audioEl.value || !audioEl.value.src) return
  ensureAudioGraph()
  if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume()

  if (audioEl.value.paused) {
    await audioEl.value.play()
  } else {
    audioEl.value.pause()
  }
}

function onPlay() {
  isPlaying.value = true
  startLoop()
}

function onPause() {
  isPlaying.value = false
  stopLoop()
}

function onEnded() {
  isPlaying.value = false
  stopLoop()
}

function onLoadedMeta() {
  duration.value = audioEl.value?.duration ?? 0
}

function onSeek(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (audioEl.value) audioEl.value.currentTime = v
  currentTime.value = v
}

function randomizeColors() {
  settings.hue = Math.floor(Math.random() * 360)
  settings.collectionHue = Math.floor(Math.random() * 360)
}

function fmt(t: number): string {
  if (!isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const bgPercent = computed(() => Math.round(settings.backgroundColor * 100))
const seekProgress = computed(() =>
    duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0,
)

onBeforeUnmount(() => {
  stopLoop()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  sourceNode?.disconnect()
  analyser?.disconnect()
  audioCtx?.close()
})
</script>

<template>
  <div class="app-root">
    <div class="animation-stage">
      <MusicAnimation
          ref="animationRef"
          :size="2000"
          mode="fill"
          :hue="settings.hue"
          :collection-hue="settings.collectionHue"
          :energy="settings.energy"
          :background-color="settings.backgroundColor"
          :monochrome="settings.monochrome"
          :is-playing="isPlaying"
      />
    </div>

    <audio
        ref="audioEl"
        @play="onPlay"
        @pause="onPause"
        @ended="onEnded"
        @loadedmetadata="onLoadedMeta"
        @timeupdate="currentTime = audioEl?.currentTime ?? 0"
    />

    <button
        v-if="!panelVisible"
        class="fab"
        title="Show control panel"
        @click="panelVisible = true"
    >
      <span class="fab-icon">⚙</span>
    </button>

    <transition name="slide">
      <div v-if="panelVisible" class="control-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="dot" :class="{ active: isPlaying }"/>
            Controls
          </div>
          <button class="icon-btn" title="Hide panel" @click="panelVisible = false">✕</button>
        </div>

        <!-- Section: Track -->
        <section class="section">
          <label class="upload-btn" :class="{ 'has-track': trackName }">
            <input type="file" accept="audio/*" @change="onFileChange"/>
            <span class="upload-icon">{{ trackName ? '🎵' : '📁' }}</span>
            <span class="upload-text">
              <span class="upload-label">{{ trackName ? 'Current track' : 'Upload track' }}</span>
              <span v-if="trackName" class="track-name" :title="trackName">{{ trackName }}</span>
              <span v-else class="upload-hint">MP3, WAV, OGG…</span>
            </span>
          </label>

          <!-- Player -->
          <div class="player">
            <div class="player-controls">
              <button class="play-btn" :disabled="!trackName" @click="togglePlay">
                <span>{{ isPlaying ? '⏸' : '▶' }}</span>
              </button>
              <div class="player-progress">
                <input
                    class="seek"
                    type="range"
                    min="0"
                    :max="duration || 0"
                    step="0.1"
                    :value="currentTime"
                    :disabled="!trackName"
                    :style="{ '--progress': seekProgress + '%' }"
                    @input="onSeek"
                />
                <div class="time-row">
                  <span class="time">{{ fmt(currentTime) }}</span>
                  <span class="time">{{ fmt(duration) }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div class="divider"/>

        <!-- Section: Colors -->
        <section class="section">
          <div class="section-head">
            <span class="section-title">Colors</span>
            <button class="chip-btn" @click="randomizeColors">🎲 Random</button>
          </div>

          <div class="field">
            <label>
              <span class="field-name">
                <i class="swatch" :style="{ background: `hsl(${settings.hue},80%,55%)` }"/>
                Hue
              </span>
              <b>{{ settings.hue }}</b>
            </label>
            <input class="range hue-range" type="range" min="0" max="360" v-model.number="settings.hue"/>
          </div>

          <div class="field">
            <label>
              <span class="field-name">
                <i class="swatch" :style="{ background: `hsl(${settings.collectionHue},80%,55%)` }"/>
                Collection Hue
              </span>
              <b>{{ settings.collectionHue }}</b>
            </label>
            <input class="range hue-range" type="range" min="0" max="360" v-model.number="settings.collectionHue"/>
          </div>
        </section>

        <div class="divider"/>

        <!-- Section: Animation -->
        <section class="section">
          <span class="section-title">Animation</span>

          <div class="field">
            <label><span class="field-name">⚡ Energy</span><b>{{ settings.energy.toFixed(2) }}</b></label>
            <input class="range" type="range" min="0" max="3" step="0.01" v-model.number="settings.energy"/>
          </div>

          <div class="field">
            <label><span class="field-name">🌑 Background</span><b>{{ bgPercent }}%</b></label>
            <input class="range" type="range" min="0" max="1" step="0.01" v-model.number="settings.backgroundColor"
                   :disabled="settings.monochrome"/>
          </div>

          <label class="toggle-field">
            <span class="field-name">🎨 Monochrome</span>
            <input class="toggle" type="checkbox" v-model="settings.monochrome"/>
          </label>
        </section>
      </div>
    </transition>
  </div>
</template>

<style>
body {
  overflow: hidden;
}
</style>
<style scoped>
.app-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.animation-stage {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- Floating button ---- */
.fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, rgba(91, 108, 255, 0.9), rgba(140, 90, 255, 0.9));
  color: #fff;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 6px 24px rgba(91, 108, 255, 0.45);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  z-index: 20;
  display: grid;
  place-items: center;
}

.fab:hover {
  transform: scale(1.1) rotate(45deg);
  box-shadow: 0 8px 30px rgba(91, 108, 255, 0.6);
}

.fab-icon {
  transition: transform 0.2s ease;
}

/* ---- Panel ---- */
.control-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 300px;
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(160deg, rgba(28, 28, 40, 0.9), rgba(16, 16, 24, 0.92));
  backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: #e8e8ef;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- Header ---- */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.2px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  transition: all 0.3s ease;
}

.dot.active {
  background: #46e58a;
  box-shadow: 0 0 8px #46e58a;
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.icon-btn {
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: #b9b9c7;
  font-size: 13px;
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background: rgba(255, 80, 80, 0.2);
  color: #ff8a8a;
}

/* ---- Sections ---- */
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #7c7c92;
}

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
}

/* ---- Upload ---- */
.upload-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: all 0.18s ease;
}

.upload-btn:hover {
  background: rgba(91, 108, 255, 0.1);
  border-color: rgba(91, 108, 255, 0.5);
}

.upload-btn.has-track {
  border-style: solid;
  border-color: rgba(91, 108, 255, 0.35);
  background: rgba(91, 108, 255, 0.08);
}

.upload-btn input {
  display: none;
}

.upload-icon {
  font-size: 20px;
  flex: 0 0 auto;
}

.upload-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.upload-label {
  font-size: 11px;
  color: #8e8ea3;
}

.upload-hint {
  font-size: 11px;
  color: #6a6a80;
}

.track-name {
  font-size: 12.5px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- Player ---- */
.player-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.play-btn {
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #5b6cff, #8c5aff);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: 0 4px 14px rgba(91, 108, 255, 0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.play-btn:hover:not(:disabled) {
  transform: scale(1.08);
  box-shadow: 0 6px 18px rgba(91, 108, 255, 0.55);
}

.play-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.play-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: #444;
  box-shadow: none;
}

.player-progress {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.time-row {
  display: flex;
  justify-content: space-between;
}

.time {
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  color: #8e8ea3;
}

/* ---- Slider fields ---- */
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.field label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #b9b9c7;
}

.field-name {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.field label b {
  color: #fff;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
}

/* ---- Toggle ---- */
.toggle-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #b9b9c7;
  cursor: pointer;
}

.toggle {
  -webkit-appearance: none;
  appearance: none;
  position: relative;
  width: 38px;
  height: 20px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  cursor: pointer;
  outline: none;
  transition: background 0.18s ease;
  flex: 0 0 auto;
}

.toggle::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s ease;
}

.toggle:checked {
  background: linear-gradient(135deg, #5b6cff, #8c5aff);
}

.toggle:checked::before {
  transform: translateX(18px);
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* ---- Custom range ---- */
.range,
.seek {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  outline: none;
}

.range::-webkit-slider-thumb,
.seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #5b6cff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: transform 0.12s ease;
}

.range::-webkit-slider-thumb:hover,
.seek::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.range::-moz-range-thumb,
.seek::-moz-range-thumb {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #5b6cff;
  cursor: pointer;
}

.range:disabled,
.seek:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Progress fill for seek */
.seek {
  background: linear-gradient(
      to right,
      #5b6cff 0%,
      #8c5aff var(--progress, 0%),
      rgba(255, 255, 255, 0.1) var(--progress, 0%)
  );
}

/* Rainbow gradient for hue sliders */
.hue-range {
  background: linear-gradient(
      to right,
      hsl(0, 80%, 55%), hsl(60, 80%, 55%), hsl(120, 80%, 55%),
      hsl(180, 80%, 55%), hsl(240, 80%, 55%), hsl(300, 80%, 55%), hsl(360, 80%, 55%)
  );
}

/* ---- Chip button ---- */
.chip-btn {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #d0d0de;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.chip-btn:hover {
  background: rgba(91, 108, 255, 0.2);
  border-color: rgba(91, 108, 255, 0.4);
  color: #fff;
}

/* ---- Panel appearance animation ---- */
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(24px) scale(0.96);
}
</style>