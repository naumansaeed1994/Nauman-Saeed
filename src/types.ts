/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VoiceProfile {
  id: string;
  name: string;
  recordedAt: string | null;
  f0Mean: number;        // Center Fundamental Frequency (Hz), e.g., 130Hz for baritone, 220Hz for soprano
  f0Variance: number;    // Micro-pitch fluctuations (Jitter / Vibrato)
  f1: number;            // Mouth resonant cavity band (Hz)
  f2: number;            // Tongue/palate cavity resonance (Hz)
  f3: number;            // Nasality / nasal tract resonance (Hz)
  shimmer: number;       // Micro-gain fluctuations (0 = flat, 1 = deep shimmer)
  breathiness: number;   // Noise-source mixture level (0 = pure tone, 1 = whispered/aspirated)
  cadence: number;       // Speed coefficient (1.0 = normal, 0.7 = fast, 1.4 = slower, drawn out)
  isCloned: boolean;     // False if default template, True if recorded and extracted
}

export type VocoderType = 'neural-melgan' | 'neural-wavenet' | 'analog-formant';

export interface VocoderSettings {
  type: VocoderType;
  isGpuEnabled: boolean;
  sampleRate: number;      // e.g. 44100
  harmonicWarmth: number; // Tanh wave-folding / soft tube saturation distortion amount (0-100)
  airflowRatio: number;   // Turbulence / noise coefficient (0-100)
  jitterRate: number;     // Micro-frequency modulation speed and power (0-100)
  oversampling: boolean;  // Upsamples synthesized buffer for smoother vocoding
}

export interface CalibrationPhrase {
  id: string;
  text: string;
  phonemicGoal: string;   // e.g. "Capturing Low Vowel Formants (AH, OH)"
  completed: boolean;
  audioUrl?: string;
}

export interface SynthesizedWord {
  word: string;
  startTime: number;      // milliseconds relative to playback start
  duration: number;       // milliseconds
  index: number;
}
