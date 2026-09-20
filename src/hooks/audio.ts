'use client';

let audioContext: AudioContext | null = null;

export async function unlockAudio(): Promise<void> {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
  } catch {
    // The UI still announces Hết giờ when the browser blocks audio.
  }
}

export async function playAlarm(): Promise<void> {
  await unlockAudio();
  if (!audioContext || audioContext.state !== 'running') return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
  gain.gain.setValueAtTime(0.15, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.7);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.7);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}
