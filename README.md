# 🏛️ Sistema Municipal de Gestión Documental con IA — Municipalidad de Yau

Un sistema moderno, inteligente y accesible diseñado para optimizar el flujo de gestión documentaria y atención ciudadana de la **Municipalidad Provincial de Yau**. Integra tecnología avanzada de Reconocimiento Óptico de Caracteres (OCR), Clasificación por Machine Learning, Procesamiento de Currículum Vitae (CV) y Lectura por Voz (TTS) adaptativa.

---

## 🌟 Características Principales

### 🔍 1. Procesamiento OCR de Alta Calidad
* Transcripción instantánea de documentos digitalizados en formato **PDF** e **Imágenes** (PNG, JPEG).
* **Procesamiento 100% en memoria para PDFs:** Optimización paralela multihilo que preprocesa y digitaliza páginas en memoria RAM sin necesidad de escribir archivos temporales en el disco duro, eliminando latencia de I/O de disco y acelerando los tiempos de respuesta.
* Limpieza y preparación visual de texto automático.
* Visualizador integrado en ventana modal con opciones de accesibilidad.

### 🤖 2. Clasificación Inteligente de Trámites (Machine Learning)
* Clasificación automática de documentos de trámites usando modelos predictivos entrenados con **scikit-learn**.
* Asignación del área administrativa correspondiente y priorización automática del trámite.
* Retroalimentación inmediata en la interfaz.

### 🗣️ 3. Lector por Voz Neuronal (Text-to-Speech)
* Síntesis de voz realista utilizando **Microsoft Edge TTS** con soporte para múltiples perfiles de voces:
  * 🇲🇽 **Sofía y Mateo** (México)
  * 🇪🇸 **Elvira y Álvaro** (España)
  * 🇨🇴 **Salomé y Gonzalo** (Colombia)
  * 🇦🇷 **Elena y Tomás** (Argentina)
* Resaltado dinámico palabra por palabra en tiempo real mientras el texto es leído en pantalla.
* Ajuste de volumen y velocidad de lectura.
* **Pre-carga no bloqueante:** El precalentamiento de la caché de audios TTS se realiza en un hilo de fondo de manera asíncrona, garantizando un arranque instantáneo del servidor en menos de 1 segundo.

### 🌈 4. Interfaz Premium y Animaciones "Aurora" Reactivas
* **Borde Aurora Reactivo:** Un espectacular contorno con gradiente animado en el visualizador OCR que se mueve y pulsa en tiempo real según el volumen y la frecuencia del audio (utilizando la API de Web Audio de HTML5).
* **Cabecera Dinámica:** Animaciones de gradientes verdes que representan a la región y aportan una sensación de fluidez y modernidad.
* **Modo Oscuro / Alto Contraste:** Temas específicos pensados en la accesibilidad para usuarios con baja visión o fatiga visual.

### 📱 5. Diseño 100% Responsivo
* Adaptabilidad completa en teléfonos móviles, tablets y monitores ultraanchos.
* Menús contextuales de voz dinámicos (fixed positioning) adaptados para un uso cómodo en pantallas táctiles de dispositivos móviles.

### 🧹 6. Limpieza Automática de Almacenamiento
* Un recolector de basura automatizado en segundo plano que detecta y elimina archivos de subidas (`uploads/`) y caché de audios (`static/audio/`) con más de 24 horas de antigüedad.
* Previene de forma autónoma la saturación del espacio en disco por acumulación de documentos o audios antiguos, preservando la estructura del repositorio mediante archivos `.gitkeep`.


---

## 🛠️ Tecnologías Utilizadas

* **Backend:** Flask 3.0 (Python)
* **Procesamiento de Documentos y OCR:** Tesseract OCR, pdf2image (con dependencias de Poppler).
* **Machine Learning:** Scikit-Learn (clasificación de texto con Vectorización TF-IDF).
* **Text-To-Speech (TTS):** Edge-TTS (Servicios Cognitivos).
* **Frontend:** HTML5, CSS3 Nativo, JavaScript moderno con Web Audio API.

---

## 🚀 Requisitos e Instalación

### Prerrequisitos
1. **Python 3.8 o superior** instalado.
2. **Tesseract OCR** instalado en el sistema.
3. **Poppler** instalado en el sistema (utilizado para convertir páginas de PDFs a imágenes para el OCR).

### Pasos para Ejecutar Localmente

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/Huafesh/sistema_municipal_yau.git
   cd sistema_municipal_yau
   ```

2. **Instalar dependencias de Python:**
   Se recomienda usar un entorno virtual:
   ```bash
   python -m venv venv
   # En Windows:
   venv\Scripts\activate
   # En macOS/Linux:
   source venv/bin/activate

   pip install -r requirements.txt
   ```

3. **Configurar el servidor:**
   Inicia la aplicación ejecutando:
   ```bash
   cd sistema_municipal
   python app.py
   ```

4. **Acceder a la aplicación:**
   Abre tu navegador web e ingresa a:
   👉 **[http://localhost:5000](http://localhost:5000)**

---

## 📂 Estructura del Proyecto

* `sistema_municipal/app.py`: Servidor principal de Flask, rutas de API para OCR, TTS y ML.
* `sistema_municipal/ml/`: Módulos de Machine Learning (Clasificación de trámites, selector de currículums).
* `sistema_municipal/static/`: Recursos estáticos (hojas de estilo CSS, scripts JS, iconos y audios temporales).
* `sistema_municipal/templates/`: Vistas de la aplicación (HTML con motor Jinja2).
* `requirements.txt`: Lista de dependencias del proyecto.
* `.gitignore`: Filtros para evitar el rastreo de archivos temporales (como PDFs subidos o caché de audios MP3).
