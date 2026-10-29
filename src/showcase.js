'use strict';
// Showcase is deliberately presentation-only: no metrics, cookies, ads,
// background game execution or remote API calls.
(() => {
  const doc = document.documentElement;
  const switchButton = document.getElementById('langSwitch');
  const stage = document.getElementById('previewStage');
  const loadButton = document.getElementById('loadPreviewBtn');
  const stopButton = document.getElementById('stopPreviewBtn');
  const status = document.getElementById('previewStatus');
  const placeholder = document.getElementById('previewPlaceholder');
  let currentState = 'idle';
  let gameFrame = null;

  const strings = {
    en: {
      title: 'Neon Çekirdek interactive gameplay preview',
      idle: 'On demand: no game loop is running on this page.',
      loading: 'Loading the actual local game build…',
      ready: 'Real game loaded. Click inside the preview to use its controls.'
    },
    tr: {
      title: 'Neon Çekirdek etkileşimli oynanış önizlemesi',
      idle: 'İsteğe bağlı: bu sayfada oyun döngüsü çalışmıyor.',
      loading: 'Gerçek yerel oyun sürümü yükleniyor…',
      ready: 'Gerçek oyun yüklendi. Kontroller için önizlemenin içine tıkla.'
    }
  };
  function currentLang() { return doc.lang === 'tr' ? 'tr' : 'en'; }
  function updateStatus() {
    status.textContent = strings[currentLang()][currentState];
    if (gameFrame) gameFrame.title = strings[currentLang()].title;
  }
  function changeLanguage(lang) {
    doc.lang = lang === 'tr' ? 'tr' : 'en';
    switchButton.textContent = currentLang() === 'tr' ? 'EN' : 'TR';
    switchButton.setAttribute('aria-pressed', String(currentLang() === 'tr'));
    switchButton.setAttribute('aria-label',
      currentLang() === 'tr' ? 'Switch language to English' : 'Türkçe diline geç');
    updateStatus();
  }
  function stopPreview() {
    if (gameFrame) {
      gameFrame.removeAttribute('src');
      gameFrame.remove();
      gameFrame = null;
    }
    placeholder.hidden = false;
    stopButton.hidden = true;
    loadButton.disabled = false;
    currentState = 'idle';
    updateStatus();
  }
  function startPreview() {
    if (gameFrame) return;
    gameFrame = document.createElement('iframe');
    gameFrame.id = 'gamePreviewFrame';
    gameFrame.title = strings[currentLang()].title;
    gameFrame.allowFullscreen = true;
    gameFrame.setAttribute('allow', 'fullscreen');
    currentState = 'loading';
    placeholder.hidden = true;
    stopButton.hidden = false;
    updateStatus();
    gameFrame.addEventListener('load', () => {
      if (!gameFrame || !gameFrame.isConnected) return;
      currentState = 'ready';
      updateStatus();
    }, { once: true });
    stage.appendChild(gameFrame);
    gameFrame.src = './index.html';
  }
  switchButton.addEventListener('click', () => {
    changeLanguage(currentLang() === 'en' ? 'tr' : 'en');
  });
  loadButton.addEventListener('click', startPreview);
  stopButton.addEventListener('click', stopPreview);
  const queryLang = new URLSearchParams(window.location.search).get('lang');
  changeLanguage(queryLang === 'tr' ? 'tr' : 'en');
})();