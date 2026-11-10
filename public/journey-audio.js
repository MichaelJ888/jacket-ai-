(function () {
  const musicButton = document.getElementById('journey-music-toggle');
  const voiceoverButton = document.getElementById('journey-voiceover-toggle');
  const status = document.getElementById('journey-audio-status');
  if (!musicButton || !voiceoverButton || !status) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const speech = window.speechSynthesis;
  let audioContext = null;
  let musicTimer = null;
  let musicPlaying = false;
  let voiceoverPlaying = false;

  function report(message) {
    status.textContent = message;
  }

  function playTone(frequency, start, duration, volume, type) {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playMusicPhrase() {
    if (!audioContext) return;
    const start = audioContext.currentTime + 0.05;
    const melody = [392, 494, 587, 784, 659, 587, 494, 587];
    melody.forEach((frequency, index) => {
      playTone(frequency, start + index * 0.24, 0.19, 0.035, 'triangle');
    });
    [196, 146.83, 164.81, 130.81].forEach((frequency, index) => {
      playTone(frequency, start + index * 0.48, 0.43, 0.012, 'sine');
    });
  }

  async function startMusic() {
    if (!AudioContextClass) throw new Error('Soundtrack playback is not supported in this browser.');
    audioContext = new AudioContextClass();
    await audioContext.resume();
    playMusicPhrase();
    musicTimer = window.setInterval(playMusicPhrase, 2000);
    musicPlaying = true;
    musicButton.textContent = 'Stop upbeat soundtrack';
    musicButton.setAttribute('aria-pressed', 'true');
    report('Original MJIC theme soundtrack is playing.');
  }

  async function stopMusic() {
    if (musicTimer !== null) window.clearInterval(musicTimer);
    musicTimer = null;
    const context = audioContext;
    audioContext = null;
    if (context && context.state !== 'closed') await context.close();
    musicPlaying = false;
    musicButton.textContent = 'Play upbeat soundtrack';
    musicButton.setAttribute('aria-pressed', 'false');
    report('Soundtrack stopped.');
  }

  musicButton.addEventListener('click', async function () {
    musicButton.disabled = true;
    try {
      if (musicPlaying) await stopMusic();
      else await startMusic();
    } catch (error) {
      musicPlaying = false;
      musicButton.textContent = 'Play upbeat soundtrack';
      musicButton.setAttribute('aria-pressed', 'false');
      report(error instanceof Error ? error.message : 'Could not play the soundtrack.');
    } finally {
      musicButton.disabled = false;
    }
  });

  voiceoverButton.addEventListener('click', function () {
    if (!speech || typeof window.SpeechSynthesisUtterance !== 'function') {
      report('Voiceover playback is not supported in this browser.');
      return;
    }
    if (voiceoverPlaying) {
      speech.cancel();
      voiceoverPlaying = false;
      voiceoverButton.textContent = 'Play voiceover';
      voiceoverButton.setAttribute('aria-pressed', 'false');
      report('Voiceover stopped.');
      return;
    }

    const narration = new window.SpeechSynthesisUtterance(
      'The MJIC client journey. First, share your idea and the team shapes it into a production-ready design. ' +
      'Next, choose your fabric and colors. Then, your order is cut, sewn, embroidered, and checked in Antipolo. ' +
      'Finally, finished garments are inspected, packed, and delivered to your team.'
    );
    narration.lang = 'en-PH';
    narration.rate = 1;
    narration.pitch = 1.05;
    narration.onend = function () {
      voiceoverPlaying = false;
      voiceoverButton.textContent = 'Play voiceover';
      voiceoverButton.setAttribute('aria-pressed', 'false');
    };
    narration.onerror = function () {
      voiceoverPlaying = false;
      voiceoverButton.textContent = 'Play voiceover';
      voiceoverButton.setAttribute('aria-pressed', 'false');
      report('Voiceover could not be played by this browser.');
    };
    speech.cancel();
    speech.speak(narration);
    voiceoverPlaying = true;
    voiceoverButton.textContent = 'Stop voiceover';
    voiceoverButton.setAttribute('aria-pressed', 'true');
    report('Voiceover is playing.');
  });
})();
