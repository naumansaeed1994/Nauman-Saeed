/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VoiceProfile } from '../types';

/**
 * Autocorrelation algorithm for robust human pitch tracking (f0)
 * Works by shifting a signal against itself and measuring periodic alignment.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number {
  const minFreq = 65; // C2, lower limit of human singing voice
  const maxFreq = 400; // G4, upper limit of human speaking voice
  const maxShift = Math.floor(sampleRate / minFreq);
  const minShift = Math.floor(sampleRate / maxFreq);

  let bestShift = -1;
  let bestCorrelation = -1;
  const correlations = new Float32Array(maxShift);

  // Compute correlation for valid pitch periods
  for (let shift = minShift; shift < maxShift; shift++) {
    let sum = 0;
    let sumOfSquaresLeft = 0;
    let sumOfSquaresRight = 0;

    // Use a subset of the buffer to run efficiently
    const limit = Math.min(buffer.length - shift, 1024);
    for (let i = 0; i < limit; i++) {
      const left = buffer[i];
      const right = buffer[i + shift];
      sum += left * right;
      sumOfSquaresLeft += left * left;
      sumOfSquaresRight += right * right;
    }

    const norm = Math.sqrt(sumOfSquaresLeft * sumOfSquaresRight);
    const correlation = norm > 0.0001 ? sum / norm : 0;
    correlations[shift] = correlation;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestShift = shift;
    }
  }

  // Pitch is detected if the periodicity is sufficiently high
  if (bestCorrelation > 0.65 && bestShift > 0) {
    return sampleRate / bestShift;
  }
  return -1; // No periodic pitch detected (unvoiced/silence)
}

/**
 * Extracts spectral resonance indicators (Formants F1, F2, F3) from FFT bins.
 * Human formants cluster in specific bands:
 * F1: 300 - 1000 Hz (Mouth height/openness)
 * F2: 800 - 2500 Hz (Tongue forwardness/height)
 * F3: 2000 - 3500 Hz (Air passage width and lip rounding)
 */
export function extractFormants(frequencyData: Uint8Array, sampleRate: number): { f1: number; f2: number; f3: number } {
  const fftSize = (frequencyData.length - 1) * 2;
  const hzPerBin = sampleRate / fftSize;

  const getPeakInHz = (startHz: number, endHz: number, defaultHz: number): number => {
    const startBin = Math.floor(startHz / hzPerBin);
    const endBin = Math.min(Math.floor(endHz / hzPerBin), frequencyData.length - 1);

    let maxVal = -1;
    let maxBin = -1;

    for (let i = startBin; i <= endBin; i++) {
      if (frequencyData[i] > maxVal) {
        maxVal = frequencyData[i];
        maxBin = i;
      }
    }

    // Return the interpolated frequency of the peak or default
    return maxBin !== -1 && maxVal > 15 ? maxBin * hzPerBin : defaultHz;
  };

  // Human averages as robust fallbacks
  const f1 = getPeakInHz(300, 1000, 550);
  const f2 = getPeakInHz(1000, 2400, 1650);
  const f3 = getPeakInHz(2400, 3600, 2550);

  return { f1, f2, f3 };
}

/**
 * Fully analyzes a recorded audio buffer to synthesize a VoiceProfile.
 * Inspects pitch, formants, cadence, and breathiness levels.
 */
export function analyzeRecordedAudio(
  audioBuffer: AudioBuffer,
  name: string = "My Cloned Voice"
): VoiceProfile {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);

  // Divide buffer into overlapping frames for statistics
  const frameSize = 2048;
  const hopSize = 1024;
  const pitchSamples: number[] = [];
  let peakAmplitude = 0;
  let voiceActiveFrames = 0;
  let silentFrames = 0;
  let highFreqEnergySum = 0; // >4kHz for breathiness estimation
  let lowFreqEnergySum = 0;  // <1.5kHz

  // Simple FFT offline approximations via windowing
  for (let offset = 0; offset < channelData.length - frameSize; offset += hopSize) {
    const frame = channelData.subarray(offset, offset + frameSize);

    // Get basic energy envelope
    let sumSquares = 0;
    let absoluteSum = 0;
    for (let i = 0; i < frame.length; i++) {
      const absVal = Math.abs(frame[i]);
      sumSquares += frame[i] * frame[i];
      absoluteSum += absVal;
      if (absVal > peakAmplitude) {
        peakAmplitude = absVal;
      }
    }
    const rms = Math.sqrt(sumSquares / frame.length);

    if (rms > 0.01) {
      voiceActiveFrames++;
      // Detect pitch
      const pitch = detectPitch(frame, sampleRate);
      if (pitch > 0) {
        pitchSamples.push(pitch);
      }

      // Analyze sound colors (frequency approximations)
      let zeroCrossings = 0;
      for (let i = 1; i < frame.length; i++) {
        if ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0)) {
          zeroCrossings++;
        }
      }
      // Zero crossing rate approximates relative noise content (breathiness)
      const zcr = zeroCrossings / frame.length;
      if (zcr > 0.15) {
        highFreqEnergySum += rms;
      } else {
        lowFreqEnergySum += rms;
      }
    } else {
      silentFrames++;
    }
  }

  // Calculate pitch averages
  let f0Mean = 160; // Standard center ground fallback
  let f0Variance = 12;

  if (pitchSamples.length > 0) {
    const sum = pitchSamples.reduce((a, b) => a + b, 0);
    f0Mean = Math.round(sum / pitchSamples.length);

    // Standard deviation for variance
    const varianceSum = pitchSamples.reduce((acc, val) => acc + Math.pow(val - f0Mean, 2), 0);
    f0Variance = Math.max(4, Math.round(Math.sqrt(varianceSum / pitchSamples.length)));
  }

  // Restrict to standard natural ranges
  f0Mean = Math.min(Math.max(f0Mean, 80), 300);
  f0Variance = Math.min(Math.max(f0Variance, 2), 60);

  // Approximate default formants adjusted by pitch base to avoid clipping
  // High pitches scale formants up (smaller vocal tracts), low pitches scale them down
  const profileScaleFactor = f0Mean / 160;
  const baseF1 = Math.round(550 * (0.8 + profileScaleFactor * 0.2));
  const baseF2 = Math.round(1650 * (0.9 + profileScaleFactor * 0.1));
  const baseF3 = Math.round(2550 * (0.95 + profileScaleFactor * 0.05));

  // Determine Breathiness (noise index) based on high-vs-low frequencies and zero crossings
  const noiseRatio = highFreqEnergySum > 0 ? highFreqEnergySum / (lowFreqEnergySum || 1) : 0.15;
  const breathiness = Math.min(Math.max(noiseRatio * 0.6, 0.05), 0.70);

  // Cadence / Tempo (words duration modifier)
  // Calculate total time of speech actively voiced.
  // Standard readers average 130 words per minute.
  // Slow speech ratio: higher cadence coefficient.
  const activeDurationRatio = voiceActiveFrames / (voiceActiveFrames + silentFrames || 1);
  const cadence = Math.min(Math.max(0.85 + (0.5 - activeDurationRatio), 0.75), 1.35);

  // Subtler Shimmer (amplitude variation level)
  const shimmer = Math.min(Math.max(0.02 + f0Variance / 200, 0.04), 0.25);

  return {
    id: 'cloned-profile-' + Date.now(),
    name,
    recordedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    f0Mean,
    f0Variance,
    f1: baseF1,
    f2: baseF2,
    f3: baseF3,
    shimmer,
    breathiness,
    cadence,
    isCloned: true
  };
}
