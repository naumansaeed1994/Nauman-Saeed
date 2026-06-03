/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VoiceProfile, SynthesizedWord } from '../types';

export interface PhoneticFrame {
  type: 'voiced' | 'unvoiced' | 'silence' | 'fricative' | 'plosive' | 'nasal';
  duration: number; // in seconds
  pitchMultiplier: number; // multiplier for center f0 (to create natural contour)
  gain: number; // amplitude (0.0 to 1.0)
  formantScaleF1: number; // multiplier for base F1
  formantScaleF2: number; // multiplier for base F2
  formantScaleF3: number; // multiplier for base F3
  noiseMix: number; // degree of whisper/breath blend
  bandpassFreq?: number; // frequency of the filter for unvoiced sounds
}

export interface WordAcousticPlan {
  word: string;
  frames: PhoneticFrame[];
  timing: SynthesizedWord;
}

/**
 * Phonetic vowel ratios mapping to human formant positions.
 * Each vowel scales the base F1 and F2 formants to create distinct speech sounds.
 */
const VOWEL_RULES: Record<string, { f1: number; f2: number; f3: number; noise: number }> = {
  a: { f1: 1.35, f2: 0.85, f3: 0.95, noise: 0.05 }, // "AH" sound: high f1, mid f2
  e: { f1: 0.90, f2: 1.25, f3: 1.05, noise: 0.05 }, // "EH" sound: mid f1, high f2
  i: { f1: 0.60, f2: 1.55, f3: 1.15, noise: 0.02 }, // "EE" sound: very low f1, extreme high f2
  o: { f1: 0.85, f2: 0.65, f3: 0.85, noise: 0.10 }, // "OH" sound: low/mid f1, low f2
  u: { f1: 0.65, f2: 0.55, f3: 0.82, noise: 0.12 }, // "OO" sound: low f1, very low f2
};

/**
 * Basic Grapheme-to-Phoneme mapper.
 * Breaks down letters to acoustic plans containing harmonic, noise, and structural glides.
 */
function analyzeLettersForWord(word: string, profile: VoiceProfile): PhoneticFrame[] {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) {
    return [{ type: 'silence', duration: 0.12, pitchMultiplier: 1, gain: 0, formantScaleF1: 1, formantScaleF2: 1, formantScaleF3: 1, noiseMix: 0 }];
  }

  const frames: PhoneticFrame[] = [];
  const baseDuration = 0.08 * profile.cadence; // Scale duration by user's cadence

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    // 1. Unvoiced Fricatives (S, F, H, X)
    if (['s', 'f', 'h', 'x', 'c'].includes(char)) {
      frames.push({
        type: 'fricative',
        duration: baseDuration * 1.3,
        pitchMultiplier: 0.0,
        gain: 0.28 * (1 - profile.shimmer),
        formantScaleF1: 1.0,
        formantScaleF2: 1.0,
        formantScaleF3: 1.0,
        noiseMix: 1.0, // pure noise
        bandpassFreq: char === 's' ? 6200 : char === 'f' ? 3800 : 2800 // High pass noise shape
      });
    }
    // 2. Plosives (P, T, K, B, D, G)
    else if (['p', 't', 'k', 'b', 'd', 'g', 'q'].includes(char)) {
      // Plosive has two distinct phases: closure (silence) + explosion burst
      frames.push({
        type: 'silence',
        duration: baseDuration * 0.4,
        pitchMultiplier: 0.0,
        gain: 0.0,
        formantScaleF1: 1.0,
        formantScaleF2: 1.0,
        formantScaleF3: 1.0,
        noiseMix: 0.0
      });
      frames.push({
        type: 'plosive',
        duration: baseDuration * 0.4,
        pitchMultiplier: ['b', 'd', 'g'].includes(char) ? 0.75 : 0.0, // semi-voiced for voiced plosives
        gain: 0.38,
        formantScaleF1: 0.5,
        formantScaleF2: 1.1,
        formantScaleF3: 1.0,
        noiseMix: 0.85,
        bandpassFreq: ['t', 'k'].includes(char) ? 5500 : 1800
      });
    }
    // 3. Nasals (M, N, J)
    else if (['m', 'n', 'j', 'w', 'y'].includes(char)) {
      frames.push({
        type: 'nasal',
        duration: baseDuration * 1.1,
        pitchMultiplier: 0.95, // slight nasal pitch depression
        gain: 0.35,
        formantScaleF1: 0.5,  // very muted F1
        formantScaleF2: 0.65, // Nasal coupling cluster
        formantScaleF3: 0.75,
        noiseMix: profile.breathiness * 0.9
      });
    }
    // 4. Vowels (A, E, I, O, U)
    else if (VOWEL_RULES[char]) {
      const v = VOWEL_RULES[char];
      
      // Multi-sample vowels to form speech glide contour (prosody)
      // High pitch near the middle of words, fades near boundaries
      const midStep = i / clean.length;
      const pitchSlope = 1.0 + Math.sin(midStep * Math.PI) * 0.12 - (profile.shimmer * 0.03);

      frames.push({
        type: 'voiced',
        duration: baseDuration * 2.1,
        pitchMultiplier: pitchSlope,
        gain: 0.85 * (1.0 - Math.random() * profile.shimmer * 0.1), // rich core gain
        formantScaleF1: v.f1,
        formantScaleF2: v.f2,
        formantScaleF3: v.f3,
        noiseMix: Math.max(v.noise, profile.breathiness)
      });
    }
    // 5. Liquids & Others (L, R, Z, V)
    else {
      // Blend of voice and soft hum
      frames.push({
        type: 'voiced',
        duration: baseDuration * 1.2,
        pitchMultiplier: 0.98,
        gain: 0.52,
        formantScaleF1: 0.78,
        formantScaleF2: 0.90,
        formantScaleF3: 1.05,
        noiseMix: 0.15 + profile.breathiness * 0.4
      });
    }
  }

  // Smooth frame energies at word boundaries for anti-aliasing click prevention
  if (frames.length > 0) {
    frames[0].gain *= 0.5;
    frames[0].duration += 0.02; // soft start pad
    frames[frames.length - 1].gain *= 0.3;
    frames[frames.length - 1].duration += 0.02; // soft end pad
  }

  return frames;
}

/**
 * Creates a comprehensive playback itinerary from a raw text string.
 * Orchestrates precise word boundaries, timing targets, and acoustic shapes.
 */
export function generateSynthesisPlan(text: string, profile: VoiceProfile): WordAcousticPlan[] {
  const rawWords = text.trim().split(/\s+/);
  const plan: WordAcousticPlan[] = [];

  let accumulatedTimeMs = 30; // 30ms warm up safety pad

  rawWords.forEach((word, index) => {
    const frames = analyzeLettersForWord(word, profile);

    // Calculate sum duration of frames for this word
    let wordDurationSeconds = frames.reduce((sum, f) => sum + f.duration, 0);

    // Append word timing targets
    const timing: SynthesizedWord = {
      word,
      startTime: accumulatedTimeMs,
      duration: wordDurationSeconds * 1000,
      index
    };

    plan.push({
      word,
      frames,
      timing
    });

    // Space/pause between words is standard silence
    accumulatedTimeMs += (wordDurationSeconds * 1000) + 120; // 120ms standard word-boundary gap
  });

  return plan;
}
