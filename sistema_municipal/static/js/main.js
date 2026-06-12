/* ══════════════════════════════════════════════════════════
   main.js — Lógica del Sistema Municipal de Yau
   Municipalidad Provincial de Yau · Machine Learning + OCR
══════════════════════════════════════════════════════════ */

// ── Configuración ─────────────────────────────────────────
const API = '';   // mismo origen Flask
const PRIORIDADES = {
  'CRÍTICO': { icon:'⚡', cls:'CRITICO', color:'#e11d48', bg:'var(--crit-bg)', br:'var(--crit-br)', ring:'var(--crit-ring)' },
  'ALTO':    { icon:'🔺', cls:'ALTO',    color:'#ea580c', bg:'var(--alto-bg)', br:'var(--alto-br)', ring:'var(--alto-ring)' },
  'MEDIO':   { icon:'📋', cls:'MEDIO',   color:'#d97706', bg:'var(--medio-bg)', br:'var(--medio-br)', ring:'var(--medio-ring)' },
  'BAJO':    { icon:'✅', cls:'BAJO',    color:'#10b981', bg:'var(--bajo-bg)', br:'var(--bajo-br)', ring:'var(--bajo-ring)' },
};
const CATEGORIAS = {
  'EXCELENTE': '#10b981', 'MUY BUENO': '#2563eb', 'BUENO': '#d97706',
  'REGULAR': '#ea580c', 'NO APTO': '#e11d48',
};

// ── Analizador de Audio para Gradientes Reactivos ──
let audioCtx = null;
let analyser = null;

function connectAudioAnalyser(audioElement) {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    if (!audioElement.srcNode) {
      audioElement.srcNode = audioCtx.createMediaElementSource(audioElement);
      audioElement.srcNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
  } catch (err) {
    console.warn("[TTS] Error al conectar el analizador de audio:", err);
  }
}

// ── TTS: Edge Premium vía API Flask ──────
const TTS = {
  voz: 'femenina', // 'femenina' o 'masculina'
  activo: false,
  pausado: false,  // Bandera: ¿está pausado?
  audioPlayer: null,
  boundaries: [],
  animationId: null,
  originalHTML: null, // Guardar HTML original para des-envolver spans al detener
  chunks: [],
  currentChunkIndex: 0,
  modoLectura: 'todo', // 'todo', 'omitir-paginas', 'omitir-numeros'
  readingModal: false, // Bandera: ¿estamos leyendo el texto completo del modal?
  isSelectionReading: false, // Bandera: ¿estamos leyendo una selección?

  inicializar() {
    console.log("[TTS] Inicializado con Edge TTS vía Flask");
  },

  splitIntoChunks(text) {
    if (!text) return [];
    
    const lines = text.split(/\r?\n/);
    const chunks = [];
    let cumulativeOffset = 0;
    
    let currentChunkText = "";
    let currentChunkStart = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const lineOffset = text.indexOf(line, cumulativeOffset);
      const currentLineOffset = lineOffset !== -1 ? lineOffset : cumulativeOffset;
      
      // Actualizar offset acumulado
      cumulativeOffset = currentLineOffset + line.length;
      
      // 1. Manejo de líneas vacías (salto de párrafo)
      if (trimmedLine.length === 0) {
        if (currentChunkText.trim().length > 0) {
          chunks.push({
            text: currentChunkText.trim(),
            startOffset: currentChunkStart
          });
          currentChunkText = "";
          currentChunkStart = -1;
        }
        continue;
      }
      
      // 2. Pre-filtrado del Modo: Omitir páginas (para evitar pausas en cortes de página)
      if (this.modoLectura === 'omitir-paginas') {
        const isPageDivider = /^p[áa]gina\s+\d+$/i.test(trimmedLine) || 
                              /^---\s*p[áa]gina\s+\d+\s*---$/i.test(trimmedLine) ||
                              (trimmedLine.toLowerCase().includes('página') && trimmedLine.length < 15);
        if (isPageDivider) {
          // Omitir por completo la línea de página, no corta el flujo de lectura
          continue;
        }
      }
      
      let processedLine = trimmedLine;
      // 3. Pre-filtrado del Modo: Omitir números y viñetas
      if (this.modoLectura === 'omitir-numeros') {
        processedLine = processedLine
          // Numeración decimal simple o compuesta: "1.", "12.", "1.2.", "1.2.3." (con o sin espacio)
          .replace(/^\s*\d+(\.\d+)*\.?\s*[-).:]?\s+/, '')
          // Numeración con paréntesis: "1)", "12)", "(1)", "(12)" 
          .replace(/^\s*\(?\d+\)?\s+/, '')
          // Incisos con letra: "a.", "a)", "a-", "A.", "A)", con o sin espacio
          .replace(/^\s*[a-zA-Z][.):\-]\s*/, '')
          // Números romanos: "I.", "II.", "III.", "IV.", "IX.", "XI.", etc.
          .replace(/^\s*(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})[.):\-]\s+/i, '')
          // Viñetas y guiones de todo tipo: - * • · – — ▸ ▪ ◆ ➤ ✓ ✗
          .replace(/^\s*[-*•·–—▸▪◆➤✓✗]\s+/, '')
          // "Art. 5", "Artículo 3", "Inciso 2", "Numeral 4" al inicio
          .replace(/^\s*(art\.?|artículo|inciso|numeral|sección|capítulo)\s+\d+[\s.:)]/i, '');
      }
      
      if (processedLine.trim().length === 0) {
        continue;
      }
      
      if (currentChunkStart === -1) {
        currentChunkStart = currentLineOffset + (line.length - line.trimStart().length);
      }
      
      // Acumular el texto de la línea
      if (currentChunkText.length > 0) {
        currentChunkText += " " + processedLine;
      } else {
        currentChunkText = processedLine;
      }
      
      // Detección inteligente para dividir en fragmentos lógicos:
      // Queremos leer de corrido sin pausas molestas en cada línea del OCR.
      // Solo dividiremos si:
      // a) La línea termina en puntuación fuerte (. ! ?) y ya acumulamos un tamaño razonable (> 120 caracteres) para un fragmento.
      // b) O es el fin del texto.
      // c) O detectamos que la línea actual parece ser un título/encabezado corto independiente (y la siguiente línea empieza con mayúscula).
      const endsWithPunct = /[.!?]$/.test(processedLine);
      const nextLine = (i < lines.length - 1) ? lines[i + 1].trim() : "";
      
      let shouldSplit = false;
      if (endsWithPunct && currentChunkText.length > 120) {
        shouldSplit = true;
      } else if (i === lines.length - 1) {
        shouldSplit = true;
      } else {
        // Títulos o secciones independientes
        const isTitleLike = processedLine.length < 50 && 
                            (processedLine === processedLine.toUpperCase() || /^[A-Z0-9]/.test(processedLine)) &&
                            nextLine && /^[A-Z0-9]/.test(nextLine);
        if (isTitleLike && currentChunkText.length > 40) {
          shouldSplit = true;
        }
      }
      
      if (shouldSplit) {
        chunks.push({
          text: currentChunkText.trim(),
          startOffset: currentChunkStart
        });
        currentChunkText = "";
        currentChunkStart = -1;
      }
    }
    
    // Guardar remanente si lo hay
    if (currentChunkText.trim().length > 0) {
      chunks.push({
        text: currentChunkText.trim(),
        startOffset: currentChunkStart !== -1 ? currentChunkStart : cumulativeOffset
      });
    }
    
    return chunks;
  },

  preloadNextChunk(nextIndex) {
    // Limpiar pre-carga anterior
    this.preloadedChunk = null;
    
    if (!this.chunks || nextIndex >= this.chunks.length) return;
    
    const nextText = this.chunks[nextIndex].text;
    const currentVoice = this.voz;
    
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: nextText, voice: currentVoice })
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.error) throw new Error(data.error);
        
        // Crear objeto Audio y precargar los bytes
        const audio = new Audio(data.url);
        audio.load(); // Forzar al navegador a iniciar la descarga en segundo plano
        
        this.preloadedChunk = {
          index: nextIndex,
          text: nextText,
          voice: currentVoice,
          data: data,
          audio: audio
        };
        console.log(`[TTS] Chunk ${nextIndex} pre-cargado con éxito.`);
      })
      .catch(err => {
        console.warn(`[TTS] Error en pre-carga de chunk ${nextIndex}:`, err);
      });
  },

  hablar(texto) {
    if (!texto?.trim()) return;
    this.detener(true); // Detener el audio previo pero mantener los spans y los chunks

    // Usar la bandera readingModal para saber si estamos en modo "Escuchar Todo"
    // Esto evita comparar el texto del chunk con el DOM (que puede diferir si el modo
    // de lectura modificó el texto, ej: omitir-numeros quita "1. " al inicio)
    const modalText = document.getElementById('ocr-modal-text');
    const isModalText = this.readingModal && modalText;
    
    if (isModalText) {
      if (!this.originalHTML) {
        this.originalHTML = modalText.innerHTML;
      }
      wrapWordsInDOM(modalText);
      // Limpiar cualquier resaltado previo
      modalText.querySelectorAll('.tts-word.reading-active').forEach(s => {
        s.classList.remove('reading-active');
      });
    }

    const labelPlayAll = document.getElementById('label-play-all');
    const btnPlayAll = document.getElementById('btn-play-all');

    // 1. Verificar si el fragmento ya está pre-cargado
    const isPreloaded = this.preloadedChunk && 
                        this.preloadedChunk.index === this.currentChunkIndex &&
                        this.preloadedChunk.text === texto &&
                        this.preloadedChunk.voice === this.voz;

    if (isPreloaded) {
      console.log(`[TTS] Reproduciendo chunk pre-cargado ${this.currentChunkIndex}`);
      const preloaded = this.preloadedChunk;
      this.preloadedChunk = null; // consumido
      
      this.boundaries = preloaded.data.boundaries;
      this.activo = true;
      this.audioPlayer = preloaded.audio;
      
      this.playAudioAndRegisterEvents(isModalText, modalText, texto);
      return;
    }

    // 2. Fallback: No estaba pre-cargado, hacer fetch normal
    if (labelPlayAll) labelPlayAll.textContent = 'Cargando...';
    if (btnPlayAll) btnPlayAll.disabled = true;

    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto, voice: this.voz })
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.error) throw new Error(data.error);

        this.boundaries = data.boundaries;
        this.activo = true;

        if (btnPlayAll) btnPlayAll.disabled = false;

        this.audioPlayer = new Audio(data.url);
        this.playAudioAndRegisterEvents(isModalText, modalText, texto);
      })
      .catch(err => {
        console.error("[TTS] Error en Edge TTS:", err);
        this.detener();
        if (btnPlayAll) btnPlayAll.disabled = false;
        mostrarAlertaPersonalizada("Ocurrió un error al cargar la voz del servidor.", "Error de Lector");
      });
  },

  playAudioAndRegisterEvents(isModalText, modalText, texto) {
    const btnPlayAll = document.getElementById('btn-play-all');
    if (btnPlayAll) btnPlayAll.disabled = false;

    // Alinear límites con los spans del DOM
    if (isModalText) {
      const spans = modalText.querySelectorAll('.tts-word');
      
      let startOffset = 0;
      if (this.chunks && this.chunks[this.currentChunkIndex]) {
        startOffset = this.chunks[this.currentChunkIndex].startOffset;
      } else {
        const selectionOffset = modalText.textContent.indexOf(texto);
        startOffset = selectionOffset !== -1 ? selectionOffset : 0;
      }
      
      let currentSpanIndex = 0;
      while (currentSpanIndex < spans.length) {
        const start = parseInt(spans[currentSpanIndex].dataset.start);
        if (start >= startOffset) {
          break;
        }
        currentSpanIndex++;
      }

      // Si es lectura de selección, resaltar el bloque e identificar extremos
      if (this.isSelectionReading) {
        const endOffset = startOffset + texto.length;
        let firstSelSpan = null;
        let lastSelSpan = null;
        
        spans.forEach(span => {
          const spanStart = parseInt(span.dataset.start);
          const spanEnd = parseInt(span.dataset.end);
          if (spanStart >= startOffset && spanEnd <= endOffset) {
            span.classList.add('selection-highlight');
            if (!firstSelSpan) firstSelSpan = span;
            lastSelSpan = span;
          }
        });
        
        if (firstSelSpan) firstSelSpan.classList.add('selection-start');
        if (lastSelSpan) lastSelSpan.classList.add('selection-end');
      }

      for (let boundary of this.boundaries) {
        while (currentSpanIndex < spans.length) {
          const spanText = spans[currentSpanIndex].textContent.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, '');
          const boundaryText = boundary.word.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, '');
          if (spanText === boundaryText || spanText.includes(boundaryText) || boundaryText.includes(spanText)) {
            boundary.span = spans[currentSpanIndex];
            currentSpanIndex++;
            break;
          }
          currentSpanIndex++;
        }
      }
    }

    // Activar clase de animación de bordes en el visualizador
    if (modalText) {
      modalText.classList.add('tts-active');
    }

    // Conectar analizador de audio
    connectAudioAnalyser(this.audioPlayer);

    // Reproducir
    this.audioPlayer.play().catch(err => {
      console.error("[TTS] Error al iniciar reproducción:", err);
    });

    const syncHighlight = () => {
      if (!this.activo || !this.audioPlayer) return;
      const currentTime = this.audioPlayer.currentTime;

      // Calcular volumen en tiempo real y actualizar CSS custom property
      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = dataArray.length > 0 ? (sum / dataArray.length) : 0;
        // Normalizar volumen para una reacción óptima
        const normalizedVolume = Math.min(avg / 90, 1.0);
        if (modalText) {
          modalText.style.setProperty('--voice-vol', normalizedVolume.toFixed(3));
        }
      }

      const activeBoundary = this.boundaries.find(b => currentTime >= b.start && currentTime <= b.end);
      if (activeBoundary && activeBoundary.span) {
        if (!activeBoundary.span.classList.contains('reading-active')) {
          modalText.querySelectorAll('.tts-word.reading-active').forEach(s => {
            s.classList.remove('reading-active');
          });
          activeBoundary.span.classList.add('reading-active');
          activeBoundary.span.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
      this.animationId = requestAnimationFrame(syncHighlight);
    };

    if (isModalText) {
      this.animationId = requestAnimationFrame(syncHighlight);
    }

    this.audioPlayer.onended = () => {
      if (this.chunks && this.chunks.length > 0 && this.currentChunkIndex < this.chunks.length - 1) {
        this.currentChunkIndex++;
        this.hablar(this.chunks[this.currentChunkIndex].text);
      } else {
        this.detener();
      }
    };

    if (typeof actualizarInterfazTTS === 'function') {
      actualizarInterfazTTS(true);
    }

    // Pre-cargar proactivamente el siguiente fragmento
    if (this.chunks && this.chunks.length > 0 && this.currentChunkIndex < this.chunks.length - 1) {
      this.preloadNextChunk(this.currentChunkIndex + 1);
    }
  },

  detener(keepSpans = false) {
    this.activo = false;
    this.pausado = false; // ← Siempre limpiar la pausa al detener
    if (this.audioPlayer) {
      try {
        if (!this.audioPlayer.ended) {
          this.audioPlayer.pause();
        }
      } catch (_) {}
      this.audioPlayer = null;
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.boundaries = [];
    
    const modalText = document.getElementById('ocr-modal-text');
    if (modalText) {
      modalText.style.setProperty('--voice-vol', '0');
      if (!keepSpans) {
        modalText.classList.remove('tts-active');
      }
    }
    
    if (!keepSpans) {
      if (modalText && this.originalHTML) {
        modalText.innerHTML = this.originalHTML;
        this.originalHTML = null;
      } else {
        // Limpieza de respaldo
        document.querySelectorAll('.tts-word.reading-active, .tts-word.selection-highlight, .tts-word.selection-start, .tts-word.selection-end').forEach(s => {
          s.classList.remove('reading-active', 'selection-highlight', 'selection-start', 'selection-end');
        });
      }
      this.chunks = [];
      this.currentChunkIndex = 0;
      this.preloadedChunk = null;
      this.readingModal = false; // ← Limpiar la bandera al detener completamente
      this.isSelectionReading = false; // ← Resetear la bandera de selección

      const btnPlayAll = document.getElementById('btn-play-all');
      if (btnPlayAll) btnPlayAll.disabled = false;

      if (typeof actualizarInterfazTTS === 'function') {
        actualizarInterfazTTS(false);
      }
    }
  },

  pausarReanudar() {
    if (!this.activo || !this.audioPlayer) return;

    if (this.pausado) {
      // Reanudar
      this.audioPlayer.play().catch(err => {
        console.error('[TTS] Error al reanudar:', err);
      });
      // Asegurar reanudación de AudioContext
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      // Reiniciar la animación de resaltado
      const modalText = document.getElementById('ocr-modal-text');
      if (modalText) {
        modalText.classList.add('tts-active');
      }
      if (this.readingModal && modalText) {
        const syncHighlight = () => {
          if (!this.activo || !this.audioPlayer || this.pausado) return;
          const currentTime = this.audioPlayer.currentTime;

          // Calcular volumen en tiempo real y actualizar CSS custom property
          if (analyser) {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = dataArray.length > 0 ? (sum / dataArray.length) : 0;
            const normalizedVolume = Math.min(avg / 90, 1.0);
            modalText.style.setProperty('--voice-vol', normalizedVolume.toFixed(3));
          }

          const activeBoundary = this.boundaries.find(b => currentTime >= b.start && currentTime <= b.end);
          if (activeBoundary && activeBoundary.span) {
            if (!activeBoundary.span.classList.contains('reading-active')) {
              modalText.querySelectorAll('.tts-word.reading-active').forEach(s => {
                s.classList.remove('reading-active');
              });
              activeBoundary.span.classList.add('reading-active');
              activeBoundary.span.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }
          this.animationId = requestAnimationFrame(syncHighlight);
        };
        this.animationId = requestAnimationFrame(syncHighlight);
      }
      this.pausado = false;
    } else {
      // Pausar
      this.audioPlayer.pause();
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      const modalText = document.getElementById('ocr-modal-text');
      if (modalText) {
        modalText.style.setProperty('--voice-vol', '0');
      }
      this.pausado = true;
    }

    if (typeof actualizarInterfazTTS === 'function') {
      actualizarInterfazTTS(true);
    }
  }
};

// Inicializar al cargar la página
TTS.inicializar();

// Estado local
let colaTramites = [];
let rankingCVs   = [];
let colaVisibleLimit = 15;
let rankingVisibleLimit = 15;

// Configuración de observador para Infinite Scroll
function setupIntersectionObserver(elementId, callback) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        observer.unobserve(element);
        callback();
      }
    });
  }, {
    root: null,
    rootMargin: '0px 0px 150px 0px', // Activar carga antes de llegar al borde
    threshold: 0.1
  });
  
  observer.observe(element);
}

// Fecha y hora actual en tiempo real
function actualizarReloj() {
  const ahora = new Date();
  const fechaStr = ahora.toLocaleDateString('es-PE', {day:'2-digit',month:'2-digit',year:'numeric'});
  const horaStr = ahora.toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  document.getElementById('fecha-hoy').textContent = `${fechaStr} · ${horaStr}`;
}
actualizarReloj();
setInterval(actualizarReloj, 1000);

// Cargar datos iniciales desde el servidor al iniciar la página
cargarDatosIniciales();

async function cargarDatosIniciales() {
  try {
    const resTramites = await fetch('/api/tramite/cola');
    const dataTramites = await resTramites.json();
    colaTramites = dataTramites.tramites || [];
    const tabCola = document.getElementById('tab-cola');
    if (tabCola) {
      tabCola.querySelector('span').textContent = `Cola de Atención (${colaTramites.length})`;
    }
    
    const resCVs = await fetch('/api/cv/ranking');
    const dataCVs = await resCVs.json();
    rankingCVs = dataCVs.candidatos || [];
    const tabRanking = document.getElementById('tab-ranking');
    if (tabRanking) {
      tabRanking.querySelector('span').textContent = `Ranking CVs (${rankingCVs.length})`;
    }
  } catch (err) {
    console.error('Error cargando datos iniciales:', err);
  }
}

// ── Actualizar Logos según el Tema ─────────────────────────
function actualizarLogos() {
  const isDark = document.documentElement.classList.contains('dark-mode');
  const headerLogo = document.getElementById('header-logo');
  
  const logoUrl = isDark ? '/static/favicon-2.png' : '/static/favicon-3.png';
  
  if (headerLogo) {
    headerLogo.src = logoUrl;
  }
}

// Inicializar al cargar el script
actualizarLogos();

// ── Toggle Theme ──────────────────────────────────────────
function toggleTheme(event) {
  const toggleBtn = document.getElementById('theme-toggle');
  const rect = toggleBtn.getBoundingClientRect();
  const x = event ? event.clientX : rect.left + rect.width / 2;
  const y = event ? event.clientY : rect.top + rect.height / 2;

  if (!document.startViewTransition) {
    const isDark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    actualizarLogos();
    return;
  }

  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  const transition = document.startViewTransition(() => {
    const isDark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    actualizarLogos();
  });

  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`
    ];
    document.documentElement.animate(
      { clipPath: clipPath },
      {
        duration: 350,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        pseudoElement: '::view-transition-new(root)'
      }
    );
  });
}

// ── Tabs ───────────────────────────────────────────────────
function updateTabPill() {
  const pill = document.getElementById('tab-pill');
  const activeTab = document.querySelector('.tab.active');
  if (pill && activeTab) {
    pill.style.width = `${activeTab.offsetWidth}px`;
    pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
  }
}

function showTab(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');

  // Find correct tab button (supporting nested clicks via pointer-events:none in css)
  const tabButton = [...document.querySelectorAll('.tab')].find(btn => btn.getAttribute('onclick').includes(id));
  if (tabButton) {
    tabButton.classList.add('active');
    updateTabPill();
  }

  if (id === 'cola')    renderCola();
  if (id === 'ranking') renderRanking();
}

window.addEventListener('resize', updateTabPill);
document.addEventListener('DOMContentLoaded', updateTabPill);
// Handle case where DOMContentLoaded already fired
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(updateTabPill, 100);
}

// ── Drag & Drop Global ──────────────────────────────────────
let dragCounter = 0;
const dropOverlay = document.getElementById('global-drop-overlay');

window.addEventListener('dragenter', e => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1 && dropOverlay) {
    dropOverlay.classList.add('active');
  }
});

window.addEventListener('dragleave', e => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0 && dropOverlay) {
    dropOverlay.classList.remove('active');
  }
});

window.addEventListener('dragover', e => {
  e.preventDefault(); // Necessary to allow dropping
});

window.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  if (dropOverlay) dropOverlay.classList.remove('active');
  document.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('over'));

  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;

  // Determinar en qué pestaña estamos para procesar el archivo correspondiente
  let tipo = 'tramite'; // por defecto
  const panelCvs = document.getElementById('panel-cvs');
  if (panelCvs && panelCvs.classList.contains('active')) {
    tipo = 'cv';
  }

  procesarArchivoDirecto(file, tipo);
});

// Función de retrocompatibilidad por si se lanza desde el HTML inline
function handleDrop(e, tipo) {
  e.preventDefault();
  e.stopPropagation(); // Evitar que el global lo procese dos veces
  document.getElementById('dropzone-' + tipo).classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) procesarArchivoDirecto(file, tipo);
}

// ─── FILE PROCESSING ──────────────────────────────────────
function procesarArchivo(tipo) {
  const input = document.getElementById('file-' + tipo);
  if (input.files[0]) procesarArchivoDirecto(input.files[0], tipo);
}

async function procesarArchivoDirecto(file, tipo) {
  const spinner  = document.getElementById('spinner-' + tipo);
  const uploadUI = document.getElementById('upload-ui-' + tipo);
  const stepEl   = document.getElementById('step-' + tipo);
  const pctEl    = document.getElementById('loading-pct-' + tipo);
  const fillEl   = spinner.querySelector('.progress-fill');

  // Guardar el nombre del archivo en el contenedor OCR correspondiente para el modal
  const ocrBox = document.getElementById(`ocr-${tipo}-box`);
  if (ocrBox) {
    ocrBox.dataset.filename = file.name;
  }

  // Mostrar spinner y restablecer barras de progreso
  spinner.classList.add('visible');
  uploadUI.style.display = 'none';
  if (pctEl) pctEl.textContent = '0%';
  if (fillEl) fillEl.style.width = '0%';

  const formData = new FormData();
  formData.append('archivo', file);

  if (tipo !== 'tramite') {
    const puesto = document.getElementById('nombre-puesto').value || 'Puesto Municipal';
    formData.append('puesto', puesto);
  }

  try {
    const url = tipo === 'tramite' ? '/api/tramite/procesar' : '/api/cv/evaluar';
    const response = await fetch(url, { method: 'POST', body: formData });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataFinal = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE separa eventos por doble salto de línea
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // Mantener el último fragmento incompleto

      for (const part of parts) {
        const line = part.trim();
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.substring(5).trim());
            
            // Actualizar porcentaje e interfaz
            if (data.progress !== undefined) {
              if (pctEl) pctEl.textContent = `${data.progress}%`;
              if (fillEl) fillEl.style.width = `${data.progress}%`;
            }
            if (data.message) {
              stepEl.textContent = data.message;
            }
            if (data.result) {
              dataFinal = data.result;
            }
          } catch (e) {
            console.error('Error al procesar evento SSE:', e, line);
          }
        }
      }
    }

    if (dataFinal) {
      if (tipo === 'tramite') {
        mostrarResultadoTramite(dataFinal);
      } else {
        mostrarResultadoCV(dataFinal);
      }
    } else {
      throw new Error("No se recibieron resultados válidos del servidor.");
    }
  } catch (err) {
    mostrarAlertaPersonalizada('Error al procesar: ' + err.message, 'Error de Procesamiento');
  } finally {
    spinner.classList.remove('visible');
    uploadUI.style.display = 'flex';
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Render resultado TRÁMITE ───────────────────────────────
function mostrarResultadoTramite(data) {
  const t   = data.tramite;
  const p   = PRIORIDADES[t.prioridad] || PRIORIDADES['BAJO'];
  const num = data.posicion_cola;

  // OCR
  document.getElementById('ocr-tramite-text').innerHTML = formatearTextoOCR(t.texto_ocr);
  document.getElementById('ocr-tramite-box').classList.add('visible');

  // Clasificación
  document.getElementById('howto-tramite').style.display = 'none';
  document.getElementById('clf-tramite-box').innerHTML = `
    <div class="clf-card" style="border-top: 5px solid ${p.color};">
      <div class="clf-header">
        <div>
          <div class="clf-label">EXPEDIENTE REGISTRADO</div>
          <div class="clf-num">${t.numero}</div>
        </div>
        <span class="badge lg ${p.cls}">
          <span class="badge-dot"></span>
          ${t.prioridad}
        </span>
      </div>
      <div class="clf-body">
        <div>
          <div class="clf-label">Tipo de Solicitud</div>
          <div style="font-weight:700;font-size:16px;color:var(--text-main)">${t.tipo}</div>
        </div>
        <div class="clf-grid">
          <div class="clf-field">
            <div class="clf-label">Departamento</div>
            <div class="clf-value">${t.departamento}</div>
          </div>
          <div class="clf-field">
            <div class="clf-label">Plazo Máximo</div>
            <div class="clf-value big" style="color:${p.color}">${t.tiempo_estimado_dias} día${t.tiempo_estimado_dias!==1?'s':''}</div>
          </div>
          <div class="clf-field">
            <div class="clf-label">Confianza Clasificador</div>
            <div class="clf-value">${t.confianza_ml_pct}%</div>
          </div>
          <div class="clf-field">
            <div class="clf-label">Turno Prioridad</div>
            <div class="clf-value big" style="color:${p.color}">#${num}</div>
          </div>
        </div>
        <div class="alert-box" style="background:${p.bg};border:1px solid ${p.br}">
          <div class="alert-label" style="color:${p.color}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Alerta Ciudadana vía ${t.alerta.canal}
          </div>
          <div style="font-size:13px;color:${p.color};line-height:1.6;font-weight: 500;">${t.alerta.mensaje}</div>
        </div>
      </div>
    </div>`;

  document.getElementById('clf-tramite-box').classList.add('visible');
  document.getElementById('btn-nuevo-tramite').classList.add('visible');

  // Actualizar cola
  colaTramites.push(t);
  colaTramites.sort((a,b) => b.score - a.score);
  document.getElementById('tab-cola').querySelector('span').textContent = `Cola de Atención (${colaTramites.length})`;
}

// ── Render resultado CV ────────────────────────────────────
function mostrarResultadoCV(data) {
  const ev  = data.evaluacion;
  const cat = ev.categoria;
  const col = CATEGORIAS[cat] || '#374151';
  const pct = ev.puntaje_total;

  // OCR
  document.getElementById('ocr-cv-text').innerHTML = formatearTextoOCR(ev.texto_ocr || 'N/A');
  document.getElementById('ocr-cv-box').classList.add('visible');

  // SVG circular progress maths
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  // Scores
  const LABELS = {
    nivel_educacion:'Educación', anios_experiencia:'Experiencia',
    habilidades_tecnicas:'Habilidades', certificaciones:'Certificaciones', idiomas:'Idiomas'
  };
  const barsHTML = Object.entries(ev.scores_por_categoria).map(([k,v]) => `
    <div class="score-bar-row">
      <div class="score-bar-lbl">${LABELS[k]||k}</div>
      <div class="score-bar-bg"><div class="score-bar-fill" style="width:${v}%"></div></div>
      <div class="score-bar-val">${Math.round(v)}%</div>
    </div>`).join('');

  const habs  = (ev.habilidades_encontradas||[]).slice(0,5).map(h=>`<span style="background:var(--primary-light);color:var(--primary);padding:4px 12px;border-radius:99px;font-size:11.5px;font-weight:700">${h}</span>`).join(' ');
  const certs = (ev.certificaciones||[]).slice(0,4).map(c=>`<span style="background:rgba(22, 163, 74, 0.08);color:#16a34a;padding:4px 12px;border-radius:99px;font-size:11.5px;font-weight:700">${c}</span>`).join(' ');

  document.getElementById('clf-cv-box').innerHTML = `
    <div class="card" style="border-top: 5px solid ${col};">
      <div style="background: var(--input-bg); padding: 22px 24px; display:flex; align-items:center; gap:20px; border-bottom: 1px solid var(--border);">
        <div class="score-container">
          <svg class="score-svg" viewBox="0 0 90 90">
            <circle class="score-bg" cx="45" cy="45" r="${radius}" />
            <circle class="score-fill" cx="45" cy="45" r="${radius}"
              stroke="${col}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${strokeDashoffset}" />
          </svg>
          <div class="score-text-center">
            <div class="score-n" style="color:${col}">${Math.round(pct)}</div>
            <div class="score-lbl">score</div>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">CANDIDATO ANALIZADO</div>
          <div style="font-weight:800;font-size:18px;color:var(--text-main)">${ev.nombre_candidato}</div>
          <div style="font-size:12.5px;color:var(--text-body);opacity:0.85;margin-top:2px">${ev.email} · ${ev.telefono}</div>
        </div>
        <div style="margin-left:auto">
          <span style="background:${col}0d;color:${col};border:1px solid ${col}33;padding:6px 14px;border-radius:99px;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;">${cat}</span>
        </div>
      </div>
      <div class="clf-body">
        <div class="clf-grid">
          <div class="clf-field"><div class="clf-label">Educación Máxima</div><div class="clf-value">${ev.nivel_educacion}</div></div>
          <div class="clf-field"><div class="clf-label">Experiencia</div><div class="clf-value">${ev.anios_experiencia} años</div></div>
          <div class="clf-field"><div class="clf-label">Turno en Ranking</div><div style="font-weight:800;font-size:22px;color:${col}">#${data.posicion_ranking}</div></div>
          <div class="clf-field"><div class="clf-label">Puesto Objetivo</div><div class="clf-value">${ev.puesto_evaluado}</div></div>
        </div>
        <div>
          <div class="clf-label" style="margin-bottom:12px">Distribución del Score</div>
          <div class="score-bars">${barsHTML}</div>
        </div>
        ${habs ? `<div><div class="clf-label">Habilidades Clave</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${habs}</div></div>` : ''}
        ${certs ? `<div><div class="clf-label">Certificados Encontrados</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${certs}</div></div>` : ''}
        <div style="background:${col}0d;border:1px solid ${col}25;border-radius:14px;padding:16px 18px">
          <div style="font-size:12.5px;font-weight:800;color:${col};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.02em;">📌 Resumen de idoneidad</div>
          <div style="font-size:13.5px;color:${col};line-height:1.6;font-weight: 500;">${ev.recomendacion}</div>
        </div>
      </div>
    </div>`;

  document.getElementById('clf-cv-box').classList.add('visible');
  document.getElementById('btn-nuevo-cv').classList.add('visible');
  document.getElementById('howto-cv').style.display = 'none';

  rankingCVs.push(ev);
  rankingCVs.sort((a,b) => b.puntaje_total - a.puntaje_total);
  document.getElementById('tab-ranking').querySelector('span').textContent = `Ranking CVs (${rankingCVs.length})`;
}

// ── Render COLA ────────────────────────────────────────────
function renderCola(resetLimit = true) {
  if (resetLimit) {
    colaVisibleLimit = 15;
  }
  const cont = document.getElementById('cola-list');
  document.getElementById('cnt-critico').textContent = colaTramites.filter(t=>t.prioridad==='CRÍTICO').length;
  document.getElementById('cnt-alto').textContent    = colaTramites.filter(t=>t.prioridad==='ALTO').length;
  document.getElementById('cnt-medio').textContent   = colaTramites.filter(t=>t.prioridad==='MEDIO').length;
  document.getElementById('cnt-bajo').textContent    = colaTramites.filter(t=>t.prioridad==='BAJO').length;

  if (!colaTramites.length) {
    cont.innerHTML = `
      <div class="card empty">
        <div class="empty-icon-box">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
          </svg>
        </div>
        <div class="empty-title">Cola de trámites vacía</div>
        <div class="empty-sub">Carga y clasifica un documento desde la sección de Nuevo Trámite para empezar.</div>
      </div>`;
    return;
  }

  let html = '';
  let itemsRendered = 0;
  const totalItems = colaTramites.length;
  const niveles = ['CRÍTICO', 'ALTO', 'MEDIO', 'BAJO'];

  for (const nivel of niveles) {
    const grupo = colaTramites.filter(t => t.prioridad === nivel);
    if (!grupo.length) continue;
    if (itemsRendered >= colaVisibleLimit) break;

    const p = PRIORIDADES[nivel];
    const remainingLimit = colaVisibleLimit - itemsRendered;
    const itemsToRender = grupo.slice(0, remainingLimit);

    html += `<div class="queue-group"><div class="group-header">
      <span class="badge ${p.cls}">
        <span class="badge-dot"></span>
        ${nivel}
      </span>
      <span class="group-count">— ${grupo.length} trámite${grupo.length!==1?'s':''}</span>
      <div class="group-line"></div></div>`;
      
    itemsToRender.forEach(t => {
      const pos = colaTramites.indexOf(t) + 1;
      html += `<div class="q-row" style="border-left-color:${p.color}">
        <div class="q-pos" style="background:${p.bg};color:${p.color};border:1px solid ${p.br}">${pos}</div>
        <div class="q-info">
          <div class="q-num">${t.numero}</div>
          <div class="q-tipo">${t.tipo}</div>
          <div class="q-sub">${t.departamento}</div>
        </div>
        <div class="q-right">
          <div class="q-days" style="color:${p.color}">${t.tiempo_estimado_dias}d</div>
          <span class="q-status">${t.estado}</span>
        </div>
      </div>`;
    });
    
    html += '</div>';
    itemsRendered += itemsToRender.length;
  }

  cont.innerHTML = html;

  if (itemsRendered < totalItems) {
    const sentinelHtml = `
      <div class="sentinel-spinner" id="cola-sentinel" style="display: flex; justify-content: center; align-items: center; padding: 24px; gap: 10px; color: var(--primary); font-family: inherit;">
        <svg class="spin-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
          <line x1="12" y1="2" x2="12" y2="6"/>
          <line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="6" y2="12"/>
          <line x1="18" y1="12" x2="22" y2="12"/>
          <line x1="6.34" y1="17.66" x2="9.17" y2="14.83"/>
          <line x1="14.83" y1="9.17" x2="17.66" y2="6.34"/>
        </svg>
        <span style="font-size: 13px; font-weight: 600;">Cargando más trámites...</span>
      </div>
    `;
    cont.insertAdjacentHTML('beforeend', sentinelHtml);
    setupIntersectionObserver('cola-sentinel', () => {
      setTimeout(() => {
        colaVisibleLimit += 15;
        renderCola(false);
      }, 300);
    });
  }
}

// ── Render RANKING ─────────────────────────────────────────
function renderRanking(resetLimit = true) {
  if (resetLimit) {
    rankingVisibleLimit = 15;
  }
  const cont = document.getElementById('ranking-list');
  if (!rankingCVs.length) {
    cont.innerHTML = `
      <div class="card empty">
        <div class="empty-icon-box">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </div>
        <div class="empty-title">Ranking de candidatos vacío</div>
        <div class="empty-sub">Sube y evalúa un CV de candidato para inicializar la lista de postulantes.</div>
      </div>`;
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:12px">';
  const totalItems = rankingCVs.length;
  const itemsToRender = rankingCVs.slice(0, rankingVisibleLimit);

  itemsToRender.forEach((cv, i) => {
    const col = CATEGORIAS[cv.categoria] || '#374151';
    html += `<div class="card" style="border-left: 4px solid ${col}">
      <div style="padding: 16px 24px; display:flex; align-items:center; gap:20px">
        <div style="min-width:36px; height:36px; border-radius:50%; background:${col}0d; color:${col}; display:flex; align-items:center; justify-content:center; font-family:'Outfit', sans-serif; font-weight:800; font-size:15px; border:2px solid ${col}33">${i+1}</div>
        <div style="flex:1; min-width:0">
          <div style="font-weight:700; font-size:15.5px; color:var(--text-main)">${cv.nombre_candidato}</div>
          <div style="font-size:12.5px; color:var(--text-body); opacity:0.85; margin-top:2px">${cv.nivel_educacion} · ${cv.anios_experiencia} años exp. · <span style="color:var(--text-main); font-weight:600">${cv.puesto_evaluado}</span></div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Outfit', sans-serif; font-size:24px; font-weight:800; color:${col}">${Math.round(cv.puntaje_total)}<span style="font-size:12.5px; font-weight:600; color:var(--text-muted)"> pts</span></div>
          <span style="background:${col}0d; color:${col}; padding:3px 12px; border-radius:99px; font-size:10.5px; font-weight:700; border:1px solid ${col}25; text-transform:uppercase; letter-spacing:0.02em">${cv.categoria}</span>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';
  cont.innerHTML = html;

  if (itemsToRender.length < totalItems) {
    const sentinelHtml = `
      <div class="sentinel-spinner" id="ranking-sentinel" style="display: flex; justify-content: center; align-items: center; padding: 24px; gap: 10px; color: var(--primary); font-family: inherit;">
        <svg class="spin-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
          <line x1="12" y1="2" x2="12" y2="6"/>
          <line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="6" y2="12"/>
          <line x1="18" y1="12" x2="22" y2="12"/>
          <line x1="6.34" y1="17.66" x2="9.17" y2="14.83"/>
          <line x1="14.83" y1="9.17" x2="17.66" y2="6.34"/>
        </svg>
        <span style="font-size: 13px; font-weight: 600;">Cargando más candidatos...</span>
      </div>
    `;
    cont.insertAdjacentHTML('beforeend', sentinelHtml);
    setupIntersectionObserver('ranking-sentinel', () => {
      setTimeout(() => {
        rankingVisibleLimit += 15;
        renderRanking(false);
      }, 300);
    });
  }
}

// ── Limpiar formularios ────────────────────────────────────
function limpiarTramite() {
  document.getElementById('ocr-tramite-box').classList.remove('visible');
  document.getElementById('clf-tramite-box').classList.remove('visible');
  document.getElementById('clf-tramite-box').innerHTML = '';
  document.getElementById('btn-nuevo-tramite').classList.remove('visible');
  document.getElementById('howto-tramite').style.display = '';
  document.getElementById('file-tramite').value = '';
}
function limpiarCV() {
  document.getElementById('ocr-cv-box').classList.remove('visible');
  document.getElementById('clf-cv-box').classList.remove('visible');
  document.getElementById('clf-cv-box').innerHTML = '';
  document.getElementById('btn-nuevo-cv').classList.remove('visible');
  document.getElementById('howto-cv').style.display = '';
  document.getElementById('file-cv').value = '';
}

// ── Formateo de Texto OCR con Cabeceras de Página ───────────
function formatearTextoOCR(texto) {
  if (!texto) return '';
  // Escapar HTML para evitar XSS
  let html = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  
  // Buscar cabeceras de página tipo "--- Página X ---", "--- Pgina X ---", "--- Pagina X ---"
  html = html.replace(/---\s*P[áa\uFFFD]?gina\s+(\d+)\s*---/gi, (match, p1) => {
    return `<div class="ocr-page-divider"><span class="page-num">Página ${p1}</span></div>`;
  });
  
  return html;
}

// ── Modal Visualizador OCR ────────────────────────────────
function abrirModalOCR(tipo) {
  const sourceText = document.getElementById(`ocr-${tipo}-text`);
  const modalText = document.getElementById('ocr-modal-text');
  const modal = document.getElementById('ocr-modal');
  const ocrBox = document.getElementById(`ocr-${tipo}-box`);
  
  if (sourceText && modalText && modal) {
    modalText.innerHTML = sourceText.innerHTML;
    
    // Obtener el nombre del archivo guardado
    const filename = ocrBox ? ocrBox.dataset.filename : '';
    const titleSpan = document.querySelector('.ocr-modal-title span');
    if (titleSpan) {
      titleSpan.textContent = filename ? `Visualizador OCR · ${filename}` : 'Visualizador de Documento OCR';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function cerrarModalOCR() {
  const modal = document.getElementById('ocr-modal');
  const modalText = document.getElementById('ocr-modal-text');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    // Detener la reproducción de voz al cerrar
    TTS.detener();
    
    // Restablecer el título del modal
    const titleSpan = document.querySelector('.ocr-modal-title span');
    if (titleSpan) {
      titleSpan.textContent = 'Visualizador de Documento OCR';
    }

    // Esperar a que termine la animación para vaciar el texto
    setTimeout(() => {
      if (modalText) modalText.innerHTML = '';
    }, 300);
  }
}

function ajustarTamanoLetra(tamano) {
  const modalText = document.getElementById('ocr-modal-text');
  if (!modalText) return;
  
  // Limpiar clases de tamaño anteriores
  modalText.classList.remove('size-chico', 'size-normal', 'size-grande', 'size-muy-grande');
  
  // Añadir nueva clase de tamaño
  modalText.classList.add(`size-${tamano}`);
  
  // Actualizar botones en la interfaz
  const buttons = document.querySelectorAll('.fontsize-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    // Coincidencia exacta para evitar que 'grande' active también 'muy-grande'
    if (btn.getAttribute('onclick') === `ajustarTamanoLetra('${tamano}')`) {
      btn.classList.add('active');
    }
  });
}

// ── CONTROLES DE ACCESIBILIDAD Y DROPDOWNS PERSONALIZADOS ─

// Helper: limpiar estilos de posicionamiento fijo de un menú dropdown
function _resetDropdownMenuStyle(menu) {
  if (!menu) return;
  menu.style.position = '';
  menu.style.top      = '';
  menu.style.left     = '';
  menu.style.right    = '';
  menu.style.width    = '';
  menu.style.zIndex   = '';
  menu.style.maxHeight = '';
  menu.style.overflowY = '';
}

// Helper: aplicar posicionamiento fijo en móvil para escapar del overflow:hidden del modal
function _positionDropdownFixed(dropdown) {
  if (window.innerWidth > 768) return; // Solo en móvil/tablet
  const trigger = dropdown.querySelector('.dropdown-trigger');
  const menu    = dropdown.querySelector('.dropdown-menu');
  if (!trigger || !menu) return;

  const rect       = trigger.getBoundingClientRect();
  const menuWidth  = Math.max(rect.width, 190);
  const spaceBelow = window.innerHeight - rect.bottom - 10;
  const spaceAbove = rect.top - 10;

  // Altura máxima compacta: 180px para no tapar el contenido debajo
  const MAX_HEIGHT = 180;
  menu.style.position       = 'fixed';
  menu.style.zIndex         = '99999';
  menu.style.width          = menuWidth + 'px';
  menu.style.overflowY      = 'auto';
  menu.style.overscrollBehavior = 'contain';

  // Preferir abrir hacia ABAJO; solo abrir hacia arriba si hay menos de 90px abajo
  if (spaceBelow >= 90) {
    menu.style.top    = (rect.bottom + 4) + 'px';
    menu.style.bottom = 'auto';
    menu.style.maxHeight = Math.min(MAX_HEIGHT, spaceBelow - 4) + 'px';
  } else {
    menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    menu.style.top    = 'auto';
    menu.style.maxHeight = Math.min(MAX_HEIGHT, spaceAbove - 4) + 'px';
  }

  // Alinear horizontalmente: evitar salir por la derecha
  let leftPos = rect.left;
  if (leftPos + menuWidth > window.innerWidth - 8) {
    leftPos = window.innerWidth - menuWidth - 8;
  }
  menu.style.left  = Math.max(8, leftPos) + 'px';
  menu.style.right = 'auto';
}

function toggleCustomDropdown(dropdownId) {
  const dropdown  = document.getElementById(dropdownId);
  const wasActive = dropdown?.classList.contains('active');

  // Cerrar todos los dropdowns y limpiar sus estilos
  document.querySelectorAll('.custom-dropdown').forEach(d => {
    d.classList.remove('active');
    _resetDropdownMenuStyle(d.querySelector('.dropdown-menu'));
  });

  // Si no estaba activo, abrirlo
  if (dropdown && !wasActive) {
    dropdown.classList.add('active');
    _positionDropdownFixed(dropdown);
  }
}

function selectDropdownOption(dropdownId, value, labelText, callback) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;

  // Actualizar el texto del trigger seleccionado
  const selectedText = dropdown.querySelector('.dropdown-selected-text');
  if (selectedText) {
    selectedText.textContent = labelText;
  }

  // Marcar elemento activo en el menú
  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('onclick').includes(`'${value}'`)) {
      item.classList.add('active');
    }
  });

  // Cerrar el dropdown y limpiar estilos de posicionamiento
  dropdown.classList.remove('active');
  _resetDropdownMenuStyle(dropdown.querySelector('.dropdown-menu'));

  // Disparar el callback de cambio
  if (callback && typeof callback === 'function') {
    callback(value);
  }
}

function ajustarFuente(fuente) {
  const modalText = document.getElementById('ocr-modal-text');
  if (!modalText) return;
  modalText.classList.remove('font-monospace', 'font-sans-serif', 'font-serif', 'font-dyslexic', 'font-atkinson', 'font-lexend', 'font-roboto-slab');
  modalText.classList.add(`font-${fuente}`);
}

function ajustarContraste(tema) {
  const modalText = document.getElementById('ocr-modal-text');
  if (!modalText) return;
  modalText.classList.remove('theme-default', 'theme-high-contrast-dark', 'theme-high-contrast-light', 'theme-cream', 'theme-soft-dark', 'theme-municipal-green', 'theme-sunny-yellow');
  modalText.classList.add(`theme-${tema}`);
}

// ══════════════════════════════════════════════════════════════
// LOCAL EDGE TTS INTEGRATION HELPERS
// ══════════════════════════════════════════════════════════════

function cambiarVozTTS(tipo) {
  TTS.voz = tipo; // 'femenina' o 'masculina'
  console.log(`[TTS] Cambiado a voz: ${TTS.voz}`);
  if (TTS.activo && TTS.chunks && TTS.chunks[TTS.currentChunkIndex]) {
    // Continuar leyendo desde el mismo fragmento actual pero con la nueva voz
    TTS.hablar(TTS.chunks[TTS.currentChunkIndex].text);
  }
}

function cambiarModoLecturaTTS(modo) {
  TTS.modoLectura = modo;
  console.log(`[TTS] Modo de lectura cambiado a: ${TTS.modoLectura}`);
  if (TTS.activo) {
    TTS.detener();
    setTimeout(() => toggleLeerTodo(), 150);
  }
}

// Envuelve todas las palabras del contenedor en spans con sus índices de inicio y fin correspondientes
function wrapWordsInDOM(container) {
  if (container.querySelector('.tts-word')) {
    return; // Ya está envuelto
  }
  
  let charIdx = 0;
  
  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      // Expresión regular que separa palabras (con caracteres latinos y números) del resto
      const regex = /([a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ]+)/g;
      const parts = text.split(regex);
      
      const fragment = document.createDocumentFragment();
      for (let part of parts) {
        if (part.match(/^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ]+$/)) {
          const span = document.createElement('span');
          span.className = 'tts-word';
          span.dataset.start = charIdx;
          span.dataset.end = charIdx + part.length;
          span.textContent = part;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
        charIdx += part.length;
      }
      node.parentNode.replaceChild(fragment, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && !node.classList.contains('tts-word')) {
        const children = Array.from(node.childNodes);
        for (let child of children) {
          traverse(child);
        }
      }
    }
  }
  
  traverse(container);
}

// ── Leer todo el texto del modal OCR ──────────────────────────
function toggleLeerTodo() {
  if (TTS.activo) { 
    TTS.detener(); 
    return; 
  }

  const modalText = document.getElementById('ocr-modal-text');
  if (!modalText) return;

  const texto = modalText.textContent;
  if (!texto.trim()) return;

  TTS.chunks = TTS.splitIntoChunks(texto);
  TTS.currentChunkIndex = 0;
  TTS.readingModal = true; // ← Activar bandera: estamos leyendo el modal completo
  TTS.isSelectionReading = false; // ← No es lectura por selección

  if (TTS.chunks.length > 0) {
    TTS.hablar(TTS.chunks[0].text);
  }
}

// ── Leer selección de texto ────────────────────────────────────
function leerTextoTTS(modo) {
  if (modo !== 'seleccion') return;
  const seleccion  = window.getSelection();
  const textoALeer = seleccion ? seleccion.toString().trim() : '';
  if (!textoALeer) {
    mostrarAlertaPersonalizada(
      'Por favor, selecciona primero con el mouse el fragmento de texto que deseas escuchar.',
      'Instrucciones del Lector'
    );
    return;
  }
  TTS.detener();
  TTS.readingModal = true; // Activar modo modal para habilitar el resaltado de palabras en tiempo real
  TTS.isSelectionReading = true; // Activar bandera de lectura por selección
  const modalText = document.getElementById('ocr-modal-text');
  if (modalText) {
    TTS.chunks = [{ text: textoALeer, startOffset: modalText.textContent.indexOf(textoALeer) }];
    TTS.currentChunkIndex = 0;
  }
  TTS.hablar(textoALeer);
}

// ── Detener síntesis ───────────────────────────────────────────
function pausarReanudarTTS() {
  TTS.pausarReanudar();
}

function detenerTTS() {
  TTS.detener();
}
function detenerLectura() { 
  TTS.detener(); 
}

function adelantarTTS() {
  if (TTS.chunks && TTS.chunks.length > 0) {
    if (TTS.currentChunkIndex < TTS.chunks.length - 1) {
      TTS.currentChunkIndex++;
      TTS.hablar(TTS.chunks[TTS.currentChunkIndex].text);
    } else {
      TTS.detener();
    }
  }
}

function retrocederTTS() {
  if (TTS.chunks && TTS.chunks.length > 0) {
    if (TTS.currentChunkIndex > 0) {
      TTS.currentChunkIndex--;
      TTS.hablar(TTS.chunks[TTS.currentChunkIndex].text);
    } else {
      TTS.hablar(TTS.chunks[0].text);
    }
  }
}

// ── Actualizar UI del lector ───────────────────────────────────
function actualizarInterfazTTS(hablando) {
  const labelPlayAll = document.getElementById('label-play-all');
  const svgPlay      = document.getElementById('svg-play');
  const svgStop      = document.getElementById('svg-stop');
  const btnPrev      = document.getElementById('btn-prev-tts');
  const btnNext      = document.getElementById('btn-next-tts');
  
  const btnPause     = document.getElementById('btn-pause-tts');
  const svgPause     = document.getElementById('svg-pause');
  const svgResume    = document.getElementById('svg-resume');
  const labelPause   = document.getElementById('label-pause-tts');
  
  const hasMultipleChunks = TTS.chunks && TTS.chunks.length > 1;

  if (hablando) {
    if (labelPlayAll) labelPlayAll.textContent = 'Detener';
    if (svgPlay)      svgPlay.style.display    = 'none';
    if (svgStop)      svgStop.style.display    = 'inline-block';
    if (btnPrev)      btnPrev.style.display    = hasMultipleChunks ? 'inline-flex' : 'none';
    if (btnNext)      btnNext.style.display    = hasMultipleChunks ? 'inline-flex' : 'none';
    
    // Controles de Pausa
    if (btnPause)     btnPause.style.display   = 'inline-flex';
    if (TTS.pausado) {
      if (svgPause)   svgPause.style.display   = 'none';
      if (svgResume)  svgResume.style.display  = 'inline-block';
      if (labelPause) labelPause.textContent   = 'Reanudar';
    } else {
      if (svgPause)   svgPause.style.display   = 'inline-block';
      if (svgResume)  svgResume.style.display  = 'none';
      if (labelPause) labelPause.textContent   = 'Pausar';
    }
  } else {
    if (labelPlayAll) labelPlayAll.textContent = 'Escuchar Todo';
    if (svgPlay)      svgPlay.style.display    = 'inline-block';
    if (svgStop)      svgStop.style.display    = 'none';
    if (btnPrev)      btnPrev.style.display    = 'none';
    if (btnNext)      btnNext.style.display    = 'none';
    
    // Ocultar botón de Pausa al detener
    if (btnPause)     btnPause.style.display   = 'none';
  }
}

// ══════════════════════════════════════════════════════════════
// SISTEMA DE ALERTA PERSONALIZADO
// ══════════════════════════════════════════════════════════════
function mostrarAlertaPersonalizada(mensaje, titulo = 'Notificación') {
  const overlay = document.getElementById('custom-alert-modal');
  const msgEl   = document.getElementById('custom-alert-message');
  const titleEl = overlay ? overlay.querySelector('.custom-alert-title') : null;
  if (overlay && msgEl) {
    msgEl.textContent = mensaje;
    if (titleEl) titleEl.textContent = titulo;
    overlay.classList.add('active');
  } else {
    alert(mensaje);
  }
}

function cerrarAlertaPersonalizada() {
  const overlay = document.getElementById('custom-alert-modal');
  if (overlay) overlay.classList.remove('active');
}

// ══════════════════════════════════════════════════════════════
// EVENTO CLICK GLOBAL  (dropdowns + alertas + tarjetas TTS)
// ══════════════════════════════════════════════════════════════
document.addEventListener('click', e => {
  // Click en tarjeta de la cola de trámites → leer con Web Speech API
  const qRow = e.target.closest('.q-row');
  if (qRow) {
    const num  = qRow.querySelector('.q-num')?.textContent    || '';
    const tipo = qRow.querySelector('.q-tipo')?.textContent   || '';
    const dep  = qRow.querySelector('.q-sub')?.textContent    || '';
    const days = qRow.querySelector('.q-days')?.textContent   || '';
    const est  = qRow.querySelector('.q-status')?.textContent || '';
    TTS.hablar(`Trámite ${num}. Tipo: ${tipo}. Departamento: ${dep}. Tiempo estimado: ${days} días. Estado: ${est}.`);
    return;
  }

  // Click en tarjeta del ranking de CVs → leer con Web Speech API
  const cvCard = e.target.closest('#ranking-list .card');
  if (cvCard) {
    const nombre  = cvCard.querySelector('[style*="font-weight:700"]')?.textContent      || '';
    const detalle = cvCard.querySelector('[style*="opacity:0.85"]')?.textContent         || '';
    const score   = cvCard.querySelector('[style*="font-size:24px"]')?.textContent       || '';
    const cat     = cvCard.querySelector('[style*="text-transform:uppercase"]')?.textContent || '';
    TTS.hablar(`Candidato: ${nombre}. ${detalle}. Puntaje: ${score}. Categoría: ${cat}.`);
    return;
  }

  // Cerrar dropdowns si se hace clic fuera de ellos
  if (!e.target.closest('.custom-dropdown')) {
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      d.classList.remove('active');
      _resetDropdownMenuStyle(d.querySelector('.dropdown-menu'));
    });
  }

  // Cerrar alerta personalizada al hacer clic en el overlay
  const alertModal = document.getElementById('custom-alert-modal');
  if (e.target === alertModal) cerrarAlertaPersonalizada();
});

// Cerrar dropdowns fijos al rotar o hacer scroll (en móvil)
function _closeAllDropdowns() {
  document.querySelectorAll('.custom-dropdown.active').forEach(d => {
    d.classList.remove('active');
    _resetDropdownMenuStyle(d.querySelector('.dropdown-menu'));
  });
}
window.addEventListener('resize', _closeAllDropdowns, { passive: true });
// Cerrar al hacer scroll dentro del modal (el menú fijo no se mueve)
document.addEventListener('scroll', _closeAllDropdowns, { capture: true, passive: true });
