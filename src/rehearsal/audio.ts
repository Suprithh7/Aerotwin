// Short Web Audio chimes and spoken callouts for the failure presentation.
// Audio is unlocked by the first user gesture (browser autoplay policy); a
// preference off in the director panel stops both. Nothing loops.

let ctx: AudioContext | null = null;
let unlocked = false;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  const Ctor =
    window.AudioContext ?? (window as AudioWindow).webkitAudioContext ?? null;
  if (!Ctor) return;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  unlocked = true;
}

export type ChimeKind = 'caution' | 'warning';

/** Two distinct one-shot chimes: caution is a pair, warning is a triple. */
export function playChime(kind: ChimeKind): void {
  if (!unlocked || !ctx) return;
  const now = ctx.currentTime;
  const notes = kind === 'warning' ? [880, 660, 880] : [660, 520];
  const spacing = kind === 'warning' ? 0.19 : 0.24;
  notes.forEach((frequency, i) => {
    const at = now + i * spacing;
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = kind === 'warning' ? 'square' : 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    const peak = kind === 'warning' ? 0.045 : 0.06;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + spacing * 0.82);
    osc.connect(gain);
    gain.connect(ctx!.destination);
    osc.start(at);
    osc.stop(at + spacing);
  });
}

export function speak(text: string): void {
  if (!unlocked || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 0.92;
    utterance.volume = 0.85;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* speech synthesis unavailable */
  }
}

export function cancelSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
