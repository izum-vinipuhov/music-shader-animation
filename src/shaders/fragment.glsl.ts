export const PRECISION_HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define EPS 1e-4
`

export const createFragmentShader = (
    circleCount: number,
    transparent: boolean,
    monochrome: boolean = false,
) => {
    const colorType = transparent ? 'vec4' : 'vec3'
    const blendOp = transparent
        ? 'color.rgb = mix(color.rgb, blobColor.rgb, blobColor.a); color.a = max(blobColor.a, color.a);'
        : 'color = mix(color, blobColor.rgb, blobColor.a);'
    const finalOp = transparent
        ? 'gl_FragColor = color;'
        : 'gl_FragColor = vec4(color, 1.0);'

    // In monochrome mode ALL circles and both colors take the same vColor[0]
    const color1 = (i: number) => (monochrome ? `vColor[0]` : `vColor[${i}]`)
    const color2 = (i: number) => (monochrome ? `vColor[0]` : `vColor[${i + 3}]`)

    return `
${PRECISION_HEADER}

uniform vec2 vScreenSize;
uniform float vTime;
uniform float vScale;

uniform ${colorType} vColorBackground;

uniform vec3 vColor[6];
uniform vec3 vRotation[3];

uniform float vAudio[3];
uniform float vReactive[3];

uniform vec2 vInteractionPoint;
uniform float vInteraction;

#define CIRCLE_WIDTH_BASE 0.8
#define CIRCLE_WIDTH_STEP 0.2

#define SPARK_STRENGTH_BASE 1.0
#define SPARK_STRENGTH_STEP 0.3

#define CIRCLE_RADIUS_BASE 0.95
#define CIRCLE_RADIUS_STEP 0.15

#define CIRCLE_OFFSET_BASE 0.0
#define CIRCLE_OFFSET_STEP 1.57

vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise3(vec3 inputPosition) {
  const vec2 simplexConst = vec2(0.1666667, 0.3333333);
  const vec4 offsetVector = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 cellOrigin  = floor(inputPosition + dot(inputPosition, simplexConst.yyy));
  vec3 relativePos0 = inputPosition - cellOrigin + dot(cellOrigin, simplexConst.xxx);
  vec3 greaterMask = step(relativePos0.yzx, relativePos0.xyz);
  vec3 lessMask = 1.0 - greaterMask;
  vec3 cornerOffset1 = min(greaterMask.xyz, lessMask.zxy);
  vec3 cornerOffset2 = max(greaterMask.xyz, lessMask.zxy);
  vec3 relativePos1 = relativePos0 - cornerOffset1 + 1.0 * simplexConst.xxx;
  vec3 relativePos2 = relativePos0 - cornerOffset2 + 2.0 * simplexConst.xxx;
  vec3 relativePos3 = relativePos0 - 1. + 3.0 * simplexConst.xxx;
  cellOrigin = mod(cellOrigin, 289.0);
  vec4 hashedIndices = permute(permute(permute(
        cellOrigin.z + vec4(0.0, cornerOffset1.z, cornerOffset2.z, 1.0))
      + cellOrigin.y + vec4(0.0, cornerOffset1.y, cornerOffset2.y, 1.0))
      + cellOrigin.x + vec4(0.0, cornerOffset1.x, cornerOffset2.x, 1.0));
  float inverseGridSize = 0.142857142857;
  vec3 gradientScale = inverseGridSize * offsetVector.wyz - offsetVector.xzx;
  vec4 reducedHash = hashedIndices - 49.0 * floor(hashedIndices * gradientScale.z * gradientScale.z);
  vec4 gradientX_raw = floor(reducedHash * gradientScale.z);
  vec4 gradientY_raw = floor(reducedHash - 7.0 * gradientX_raw);
  vec4 gradientX = gradientX_raw * gradientScale.x + gradientScale.yyyy;
  vec4 gradientY = gradientY_raw * gradientScale.x + gradientScale.yyyy;
  vec4 gradientH = 1.0 - abs(gradientX) - abs(gradientY);
  vec4 gradientPack0 = vec4(gradientX.xy, gradientY.xy);
  vec4 gradientPack1 = vec4(gradientX.zw, gradientY.zw);
  vec4 signPack0 = floor(gradientPack0)*2.0 + 1.0;
  vec4 signPack1 = floor(gradientPack1)*2.0 + 1.0;
  vec4 heightSign = -step(gradientH, vec4(0.0));
  vec4 adjustedPack0 = gradientPack0.xzyw + signPack0.xzyw*heightSign.xxyy;
  vec4 adjustedPack1 = gradientPack1.xzyw + signPack1.xzyw*heightSign.zzww;
  vec3 gradient0 = vec3(adjustedPack0.xy, gradientH.x);
  vec3 gradient1 = vec3(adjustedPack0.zw, gradientH.y);
  vec3 gradient2 = vec3(adjustedPack1.xy, gradientH.z);
  vec3 gradient3 = vec3(adjustedPack1.zw, gradientH.w);
  vec4 normalizationFactor = taylorInvSqrt(vec4(dot(gradient0,gradient0), dot(gradient1,gradient1), dot(gradient2, gradient2), dot(gradient3,gradient3)));
  gradient0 *= normalizationFactor.x;
  gradient1 *= normalizationFactor.y;
  gradient2 *= normalizationFactor.z;
  gradient3 *= normalizationFactor.w;
  vec4 falloff = max(0.6 - vec4(dot(relativePos0,relativePos0), dot(relativePos1,relativePos1), dot(relativePos2,relativePos2), dot(relativePos3,relativePos3)), 0.0);
  falloff = falloff * falloff;
  return 42.0 * dot(falloff*falloff, vec4(dot(gradient0,relativePos0), dot(gradient1,relativePos1), dot(gradient2,relativePos2), dot(gradient3,relativePos3)));
}

float tri(in float value){return abs(fract(value)-.5);}
vec3 tri3(in vec3 point){return vec3(tri(point.z+tri(point.y*20.)), tri(point.z+tri(point.x*1.)), tri(point.y+tri(point.x*1.)));}

float triNoise3D(in vec3 point, in float speed) {
  float amplitude = 0.4;
  float accumulatedNoise = 0.1;
  vec3 basePoint = point;
  for (int octave = 0; octave < 5; octave++) {
    vec3 distortion = tri3(basePoint*0.01);
    point += (distortion + vTime * .1 * speed);
    basePoint *= 4.;
    amplitude *= 0.9;
    point *= 1.6;
    accumulatedNoise += (tri(point.z + tri(0.6*point.x + 0.1*tri(point.y))))/amplitude;
  }
  return smoothstep(0.0, 8., accumulatedNoise + sin(accumulatedNoise + sin(amplitude) * 2.8) * 2.2);
}

vec2 rotate(vec2 point, float angle) {
  float sinAngle = sin(angle);
  float cosAngle = cos(angle);
  return vec2(point.x * cosAngle - point.y * sinAngle, point.x * sinAngle + point.y * cosAngle);
}

float light(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist + dist * attenuation);
}

vec4 makeNoiseBlob2(vec2 uv, vec3 innerColor, vec3 outerColor, float strength, float offset) {
  float distFromCenter = max(length(uv), EPS);
  float noiseValue = snoise3(vec3(uv * 1.2 + offset, vTime * 0.5 + offset)) * 0.5 + 0.5;
  float noiseRadius = max(mix(0.0, 1.0, noiseValue), EPS);
  float distToBoundary = distance(uv, noiseRadius / distFromCenter * uv);
  float alpha = smoothstep(noiseRadius + 0.1 + (sin(vTime + offset) + 1.0), noiseRadius, distFromCenter);
  float glow = light(0.15 * (1.0 + 1.5 * (-sin(vTime * 2. + offset * 0.5) * 0.5)) + 0.3 * strength, 10.0, distToBoundary);
  // clamp by uv.y so that with equal colors mix does not extrapolate and overpaint
  vec3 finalColor = mix(innerColor, outerColor, clamp(uv.y * 2., 0.0, 1.0)) + glow;
  return vec4(clamp(finalColor, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}

vec4 makeBlob(vec2 uv, float radius, vec3 innerColor, vec3 outerColor, float width, float baseReaction, float likeReaction, float audioStrength, float offset, vec2 noiseOffset) {
  float distFromCenter = length(uv);
  float outerRadius = radius + width * 0.5 + baseReaction * (1.0 + max(likeReaction, audioStrength * 0.6) * 50. * baseReaction);
  float strength = max(likeReaction, audioStrength);
  vec4 noise = makeNoiseBlob2(uv * (1.0 - likeReaction * 0.5) + noiseOffset, innerColor, outerColor, strength, offset);
  noise.a = mix(0.0, noise.a, smoothstep(outerRadius, 0.5, distFromCenter));
  noise.rgb += 0.6 * likeReaction * (1.0 - smoothstep(0.2, outerRadius * 0.8, distFromCenter));
  return noise;
}

void main() {
  vec2 screenSize = max(vScreenSize, vec2(1.0));
  float minScreenDimension = max(min(screenSize.x, screenSize.y), 1.0);
  float safeScale = max(vScale, EPS);

  vec2 uv = gl_FragCoord.xy / screenSize;
  uv = uv * 2.0 - 1.0;
  uv.y *= screenSize.y / minScreenDimension / safeScale;
  uv.x *= screenSize.x / minScreenDimension / safeScale;

  vec2 scaledUv = uv * 2.0;
  float polarAngle = atan(scaledUv.y, scaledUv.x);
  float angularIndex = (polarAngle/3.1415) / 2.0;

  vec2 rotatedUv = rotate(uv * 2.0, 3.1415);
  float rotatedPolarAngle = atan(rotatedUv.y, rotatedUv.x);
  float rotatedAngularIndex = (rotatedPolarAngle/3.1415) / 2.0;
  float blendAngularIndex = (rotatedPolarAngle/3.1415 + 1.0) / 2.0 * 3.1415;

  float spark = triNoise3D(vec3(angularIndex, 0.0, 0.0), 0.1);
  spark = mix(spark, triNoise3D(vec3(rotatedAngularIndex, 0.0, rotatedAngularIndex), 0.1), smoothstep(0.9, 1.0, sin(blendAngularIndex)));
  spark = spark * 0.2 + pow(spark, 10.);
  spark = smoothstep(0.0, spark, 0.3) * spark;

  ${colorType} color = vColorBackground;
  vec4 blobColor;
  float floatIndex;
  float circleRadius;

  float baseNoise = snoise3(vec3(uv * 1.2, vTime * 0.5));
${Array.from({length: circleCount}, (_, i) => `
  floatIndex = ${i.toFixed(1)};
  circleRadius = CIRCLE_RADIUS_BASE - CIRCLE_RADIUS_STEP * floatIndex;
  blobColor = makeBlob(uv,
                       mix(circleRadius, circleRadius + 0.3, baseNoise),
                       ${color1(i)},
                       ${color2(i)},
                       CIRCLE_WIDTH_BASE - CIRCLE_WIDTH_STEP * floatIndex,
                       (SPARK_STRENGTH_BASE - SPARK_STRENGTH_STEP * floatIndex) * spark,
                       vReactive[${i}],
                       vAudio[${i}],
                       CIRCLE_OFFSET_BASE + CIRCLE_OFFSET_STEP * floatIndex,
                       rotate(vRotation[${i}].xy, vTime * vRotation[${i}].z));

  ${blendOp}
`).join('')}
  ${finalOp}
}
`
}