/** HSL → RGB (0..1) */
export const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => {
        const k = (n + h / 30) % 12
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    return [f(0), f(8), f(4)]
}

export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v))

export const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (Math.floor(max) - min + 1)) + min

/** Shift hue, wrapping back into the 0..360 range, except for the 280..360 corridor */
export const shiftHue = (hue: number, base: number): number =>
    base >= 280 && base < 360 ? hue % 360 : hue

export const oppositeHue = (hue: number): number => (hue + 280) % 360
