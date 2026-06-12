"""
==========================================================
  app.py  — Aplicación Web Principal (Flask)
  Sistema Automatizado de Gestión Documental y
  Selección de Currículos mediante Machine Learning

  Municipalidad Provincial de Yau
  Curso: Taller de Desarrollo de Aplicaciones con ML
==========================================================

  Rutas disponibles:
    GET  /                        → Página principal
    POST /api/tramite/procesar    → OCR + clasificar trámite
    GET  /api/tramite/cola        → Cola ordenada por prioridad
    POST /api/cv/evaluar          → OCR + evaluar CV
    GET  /api/cv/ranking          → Ranking de candidatos
    POST /api/tramite/actualizar  → Cambiar estado de un trámite
    GET  /api/stats               → Estadísticas del sistema

  Para ejecutar:
    pip install -r requirements.txt
    python app.py
==========================================================
"""

import os
import json
import datetime
from flask import Flask, request, jsonify, render_template, Response
from werkzeug.utils import secure_filename

# Módulos del sistema ML
from ml.ocr_processor import procesar_imagen, procesar_pdf, obtener_datos_ocr, procesar_pdf_generator, obtener_datos_ocr_generator, procesar_imagen_generator
from ml.clasificador_tramites import ClasificadorTramites
from ml.selector_cvs import SelectorCV


# ==========================================================
# CONFIGURACIÓN DE FLASK
# ==========================================================
app = Flask(__name__)

app.config['UPLOAD_FOLDER']      = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024   # Máximo 20 MB por archivo
app.config['EXTENSIONES_OK']     = {'png', 'jpg', 'jpeg', 'pdf', 'tiff', 'bmp'}


# ==========================================================
# INICIALIZACIÓN DE MODELOS ML
# ==========================================================
print("Inicializando modelos de Machine Learning...")
clasificador_tramites = ClasificadorTramites()    # TF-IDF + Random Forest
selector_cv           = SelectorCV()              # Scoring ponderado
print("Modelos listos.\n")


# ==========================================================
# ALMACENAMIENTO EN MEMORIA
# (En producción: reemplazar con PostgreSQL o SQLite)
# ==========================================================
cola_tramites   = []   # Lista de trámites clasificados y priorizados
lista_cvs       = []   # Lista de CVs evaluados


# ==========================================================
# FUNCIONES AUXILIARES
# ==========================================================
def extension_permitida(nombre_archivo: str) -> bool:
    return (
        '.' in nombre_archivo and
        nombre_archivo.rsplit('.', 1)[1].lower() in app.config['EXTENSIONES_OK']
    )


def generar_numero_expediente() -> str:
    anio = datetime.datetime.now().year
    n    = len(cola_tramites) + 1
    return f"YAU-{anio}-{n:04d}"


def generar_alerta(tramite: dict) -> dict:
    """
    Genera el mensaje de notificación para el ciudadano
    según la prioridad del trámite.
    """
    mensajes = {
        "CRÍTICO": {
            "canal":   "SMS + Email + Llamada telefónica",
            "tiempo":  "Inmediato (< 1 hora)",
            "mensaje": (f"🚨 URGENTE: Su trámite '{tramite['tipo']}' ha sido recibido con "
                        f"PRIORIDAD CRÍTICA. Será atendido en {tramite['tiempo_estimado_dias']} "
                        f"día(s) hábil(es). Expediente: {tramite['numero']}."),
        },
        "ALTO": {
            "canal":   "Email + SMS",
            "tiempo":  "Dentro de 2 horas",
            "mensaje": (f"⚠️ Su trámite '{tramite['tipo']}' ha sido registrado con prioridad ALTA. "
                        f"Tiempo estimado: {tramite['tiempo_estimado_dias']} días hábiles. "
                        f"Expediente: {tramite['numero']}."),
        },
        "MEDIO": {
            "canal":   "Email",
            "tiempo":  "Dentro del día",
            "mensaje": (f"✅ Su trámite '{tramite['tipo']}' ha sido registrado correctamente. "
                        f"Tiempo estimado: {tramite['tiempo_estimado_dias']} días hábiles. "
                        f"Expediente: {tramite['numero']}."),
        },
        "BAJO": {
            "canal":   "Email",
            "tiempo":  "Al día siguiente",
            "mensaje": (f"📋 Su solicitud '{tramite['tipo']}' ha sido recibida. "
                        f"Será atendida en {tramite['tiempo_estimado_dias']} días hábiles. "
                        f"Expediente: {tramite['numero']}."),
        },
    }
    return mensajes.get(tramite['prioridad'], mensajes["BAJO"])


# ==========================================================
# RUTAS — INTERFAZ WEB
# ==========================================================
@app.route('/')
def index():
    """Página principal del sistema."""
    return render_template('index.html')


# ==========================================================
# RUTAS — API TRÁMITES
# ==========================================================
@app.route('/api/tramite/procesar', methods=['POST'])
def procesar_tramite():
    """
    Endpoint: Procesar documento de trámite
    1. Recibe imagen/PDF
    2. Aplica OCR (pytesseract + OpenCV) en paralelo
    3. Clasifica con ML (TF-IDF + Random Forest)
    4. Genera alerta para ciudadano
    5. Añade a cola y reordena por prioridad

    Request: multipart/form-data con campo 'archivo'
    Response: Event stream de progreso + JSON final clasificado
    """
    # ── Validar archivo ──────────────────────────────────
    if 'archivo' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo.'}), 400

    archivo = request.files['archivo']
    if archivo.filename == '':
        return jsonify({'error': 'El archivo está vacío.'}), 400

    if not extension_permitida(archivo.filename):
        return jsonify({'error': f'Formato no permitido. Use: {", ".join(app.config["EXTENSIONES_OK"])}'}), 400

    # ── Guardar archivo ──────────────────────────────────
    nombre_seguro = secure_filename(archivo.filename)
    timestamp     = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    nombre_final  = f"{timestamp}_{nombre_seguro}"
    ruta_archivo  = os.path.join(app.config['UPLOAD_FOLDER'], nombre_final)
    archivo.save(ruta_archivo)

    def generar_progreso():
        yield f"data: {json.dumps({'progress': 5, 'message': 'Archivo recibido en el servidor. Iniciando...'})}\n\n"
        
        es_pdf = nombre_final.lower().endswith('.pdf')
        texto_ocr = ""
        confianza_ocr = 0
        
        if es_pdf:
            for pct, val in procesar_pdf_generator(ruta_archivo):
                if pct == 100:
                    texto_ocr = val
                else:
                    yield f"data: {json.dumps({'progress': pct, 'message': val})}\n\n"
        else:
            for pct, val in obtener_datos_ocr_generator(ruta_archivo):
                if pct == 100:
                    texto_ocr = val['texto']
                    confianza_ocr = val['confianza_promedio']
                else:
                    yield f"data: {json.dumps({'progress': pct, 'message': val})}\n\n"

        yield f"data: {json.dumps({'progress': 92, 'message': 'Clasificando trámite y prioridad con Machine Learning...'})}\n\n"
        resultado_ml = clasificador_tramites.clasificar(texto_ocr)
        
        yield f"data: {json.dumps({'progress': 96, 'message': 'Generando notificaciones de Yau y guardando expediente...'})}\n\n"
        
        # ── PASO 3: CONSTRUIR TRAMITE ─────────────────────────
        numero = generar_numero_expediente()
        tramite = {
            'id':                   len(cola_tramites) + 1,
            'numero':               numero,
            'fecha_registro':       datetime.datetime.now().strftime('%d/%m/%Y %H:%M'),
            # OCR
            'texto_ocr':            texto_ocr,
            'confianza_ocr_pct':    confianza_ocr,
            # ML
            'tipo':                 resultado_ml['tipo'],
            'prioridad':            resultado_ml['prioridad'],
            'score':                resultado_ml['score'],
            'confianza_ml_pct':     resultado_ml['confianza_pct'],
            'departamento':         resultado_ml['departamento'],
            'tiempo_estimado_dias': resultado_ml['tiempo_estimado_dias'],
            'probabilidades_ml':    resultado_ml['probabilidades'],
            # Estado
            'estado':               'PENDIENTE',
            'archivo':              nombre_final,
        }

        # ── PASO 4: ALERTA CIUDADANO ──────────────────────────
        tramite['alerta'] = generar_alerta(tramite)

        # ── PASO 5: COLA ORDENADA POR PRIORIDAD ──────────────
        cola_tramites.append(tramite)
        cola_tramites.sort(key=lambda x: x['score'], reverse=True)

        yield f"data: {json.dumps({'progress': 100, 'message': '¡Trámite procesado con éxito!', 'result': {'tramite': tramite, 'posicion_cola': cola_tramites.index(tramite) + 1, 'total_cola': len(cola_tramites)}})}\n\n"

    return Response(generar_progreso(), mimetype='text/event-stream')


@app.route('/api/tramite/cola', methods=['GET'])
def obtener_cola():
    """
    Retorna la cola completa de trámites ordenada por prioridad (mayor → menor).
    """
    return jsonify({
        'tramites': cola_tramites,
        'total':    len(cola_tramites),
        'por_prioridad': {
            'CRÍTICO': sum(1 for t in cola_tramites if t['prioridad'] == 'CRÍTICO'),
            'ALTO':    sum(1 for t in cola_tramites if t['prioridad'] == 'ALTO'),
            'MEDIO':   sum(1 for t in cola_tramites if t['prioridad'] == 'MEDIO'),
            'BAJO':    sum(1 for t in cola_tramites if t['prioridad'] == 'BAJO'),
        }
    })


@app.route('/api/tramite/actualizar', methods=['POST'])
def actualizar_tramite():
    """
    Actualiza el estado de un trámite.
    Body JSON: { "id": 1, "estado": "EN_PROCESO" }
    Estados válidos: PENDIENTE, EN_PROCESO, OBSERVADO, RESUELTO
    """
    data    = request.get_json()
    id_t    = data.get('id')
    estado  = data.get('estado')
    estados = ['PENDIENTE', 'EN_PROCESO', 'OBSERVADO', 'RESUELTO']

    if estado not in estados:
        return jsonify({'error': f'Estado inválido. Use: {estados}'}), 400

    for tramite in cola_tramites:
        if tramite['id'] == id_t:
            tramite['estado'] = estado
            return jsonify({'ok': True, 'tramite': tramite})

    return jsonify({'error': 'Trámite no encontrado.'}), 404


# ==========================================================
# RUTAS — API CURRÍCULOS
# ==========================================================
@app.route('/api/cv/evaluar', methods=['POST'])
def evaluar_cv():
    """
    Endpoint: Evaluar un Currículo Vitae
    1. Recibe imagen/PDF del CV
    2. Aplica OCR para extraer texto
    3. Extrae características (educación, experiencia, habilidades)
    4. Calcula puntaje ponderado con ML
    5. Genera recomendación y ranking

    Request: multipart/form-data con campos 'archivo' y (opcional) 'puesto'
    Response: Event stream de progreso + JSON final de evaluación
    """
    if 'archivo' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo.'}), 400

    archivo       = request.files['archivo']
    nombre_puesto = request.form.get('puesto', 'Puesto Municipal')

    if archivo.filename == '' or not extension_permitida(archivo.filename):
        return jsonify({'error': 'Archivo inválido o formato no permitido.'}), 400

    # Guardar
    nombre_seguro = secure_filename(archivo.filename)
    timestamp     = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    nombre_final  = f"cv_{timestamp}_{nombre_seguro}"
    ruta_archivo  = os.path.join(app.config['UPLOAD_FOLDER'], nombre_final)
    archivo.save(ruta_archivo)

    def generar_progreso():
        yield f"data: {json.dumps({'progress': 5, 'message': 'Archivo de CV recibido. Iniciando análisis...'})}\n\n"
        
        es_pdf = nombre_final.lower().endswith('.pdf')
        texto_cv = ""
        
        if es_pdf:
            for pct, val in procesar_pdf_generator(ruta_archivo):
                if pct == 100:
                    texto_cv = val
                else:
                    yield f"data: {json.dumps({'progress': pct, 'message': val})}\n\n"
        else:
            for pct, val in procesar_imagen_generator(ruta_archivo):
                if pct == 100:
                    texto_cv = val
                else:
                    yield f"data: {json.dumps({'progress': pct, 'message': val})}\n\n"

        yield f"data: {json.dumps({'progress': 92, 'message': 'Evaluando aptitudes y perfil profesional del candidato...'})}\n\n"
        evaluacion = selector_cv.evaluar(texto_cv, nombre_puesto)

        # Agregar metadatos
        evaluacion['id']              = len(lista_cvs) + 1
        evaluacion['fecha_registro']  = datetime.datetime.now().strftime('%d/%m/%Y %H:%M')
        evaluacion['archivo']         = nombre_final
        evaluacion['texto_ocr']       = texto_cv

        lista_cvs.append(evaluacion)

        # Ranking actualizado
        ranking = sorted(lista_cvs, key=lambda x: x['puntaje_total'], reverse=True)
        posicion = next(i+1 for i, c in enumerate(ranking) if c['id'] == evaluacion['id'])

        yield f"data: {json.dumps({'progress': 100, 'message': '¡CV evaluado con éxito!', 'result': {'evaluacion': evaluacion, 'posicion_ranking': posicion, 'total_cvs': len(lista_cvs)}})}\n\n"

    return Response(generar_progreso(), mimetype='text/event-stream')


@app.route('/api/cv/ranking', methods=['GET'])
def ranking_cvs():
    """
    Retorna el ranking completo de candidatos ordenado por puntaje ML.
    """
    ranking = sorted(lista_cvs, key=lambda x: x['puntaje_total'], reverse=True)
    return jsonify({
        'candidatos': ranking,
        'total':      len(ranking),
        'por_categoria': {
            'EXCELENTE': sum(1 for c in lista_cvs if c['categoria'] == 'EXCELENTE'),
            'MUY BUENO': sum(1 for c in lista_cvs if c['categoria'] == 'MUY BUENO'),
            'BUENO':     sum(1 for c in lista_cvs if c['categoria'] == 'BUENO'),
            'REGULAR':   sum(1 for c in lista_cvs if c['categoria'] == 'REGULAR'),
            'NO APTO':   sum(1 for c in lista_cvs if c['categoria'] == 'NO APTO'),
        }
    })


# ==========================================================
# RUTAS — ESTADÍSTICAS
# ==========================================================
@app.route('/api/stats', methods=['GET'])
def estadisticas():
    """Estadísticas generales del sistema."""
    return jsonify({
        'tramites': {
            'total':     len(cola_tramites),
            'criticos':  sum(1 for t in cola_tramites if t['prioridad'] == 'CRÍTICO'),
            'pendientes':sum(1 for t in cola_tramites if t['estado'] == 'PENDIENTE'),
            'resueltos': sum(1 for t in cola_tramites if t['estado'] == 'RESUELTO'),
        },
        'cvs': {
            'total':          len(lista_cvs),
            'recomendados':   sum(1 for c in lista_cvs if c['puntaje_total'] >= 65),
            'puntaje_promedio': round(
                sum(c['puntaje_total'] for c in lista_cvs) / len(lista_cvs), 1
            ) if lista_cvs else 0,
        }
    })


# ==========================================================
# RUTAS — API TEXT-TO-SPEECH (Edge TTS)
# ==========================================================
VOICES_MAP = {
    'femenina':      'es-MX-DaliaNeural',      # Sofía (México)
    'masculina':     'es-MX-JorgeNeural',     # Mateo (México)
    'es-es-elvira':  'es-ES-ElviraNeural',     # Elvira (España)
    'es-es-alvaro':  'es-ES-AlvaroNeural',     # Álvaro (España)
    'es-co-salome':  'es-CO-SalomeNeural',     # Salomé (Colombia)
    'es-co-gonzalo': 'es-CO-GonzaloNeural',    # Gonzalo (Colombia)
    'es-ar-elena':   'es-AR-ElenaNeural',      # Elena (Argentina)
    'es-ar-tomas':   'es-AR-TomasNeural'       # Tomás (Argentina)
}


def generar_audio_tts(text, voice):
    """
    Genera el archivo de audio MP3 y el archivo de boundaries JSON
    usando edge_tts y los guarda en caché.
    """
    import hashlib
    import asyncio
    import edge_tts
    
    audio_dir = os.path.join(app.root_path, 'static', 'audio')
    os.makedirs(audio_dir, exist_ok=True)
    
    text_hash = hashlib.md5((text + voice).encode('utf-8')).hexdigest()
    filename = f"tts_{text_hash}.mp3"
    json_filename = f"tts_{text_hash}.json"
    filepath = os.path.join(audio_dir, filename)
    json_filepath = os.path.join(audio_dir, json_filename)
    
    if os.path.exists(filepath) and os.path.exists(json_filepath):
        try:
            with open(json_filepath, 'r', encoding='utf-8') as f:
                boundaries = json.load(f)
            return filename, boundaries
        except Exception as e:
            print("Error cargando boundaries de caché:", e)
            
    boundaries = []
    try:
        async def run_tts():
            communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
            with open(filepath, "wb") as f:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        boundaries.append({
                            "word": chunk["text"],
                            "start": chunk["offset"] / 10000000.0,
                            "end": (chunk["offset"] + chunk["duration"]) / 10000000.0
                        })
        
        asyncio.run(run_tts())
        
        with open(json_filepath, 'w', encoding='utf-8') as f:
            json.dump(boundaries, f)
            
    except Exception as e:
        print("Error generando Edge TTS:", e)
        if os.path.exists(filepath):
            try: os.remove(filepath)
            except: pass
        if os.path.exists(json_filepath):
            try: os.remove(json_filepath)
            except: pass
        raise e
        
    return filename, boundaries


def preload_tts_cache():
    print("Pre-cargando audios TTS en caché...")
    textos = [
        "Bienvenido al Sistema de Gestión de Trámites de la Municipalidad Provincial de Yau",
        "Trámite registrado correctamente",
        "Procesando documento"
    ]
    voces = list(VOICES_MAP.values())
    for t in textos:
        for v in voces:
            try:
                generar_audio_tts(t, v)
            except Exception as e:
                print(f"No se pudo pregenerar '{t}' para voz '{v}': {e}")
    print("Pre-carga de audios TTS completada.")


@app.route('/api/tts', methods=['GET', 'POST'])
def text_to_speech():
    if request.method == 'POST':
        data = request.get_json(force=True) or {}
        text = data.get('text', '')
        voice_type = data.get('voice', 'femenina')
    else:
        text = request.args.get('text', '')
        voice_type = request.args.get('voice', 'femenina')
        
    if not text:
        return jsonify({'error': 'No se proporcionó texto.'}), 400
        
    voice = VOICES_MAP.get(voice_type, 'es-MX-DaliaNeural')
        
    try:
        filename, boundaries = generar_audio_tts(text, voice)
        return jsonify({
            'url': f'/static/audio/{filename}',
            'boundaries': boundaries
        })
    except Exception as e:
        return jsonify({'error': f'Failed to generate TTS: {str(e)}'}), 500


# ==========================================================
# INICIO DEL SERVIDOR
# ==========================================================
if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs('ml/modelos', exist_ok=True)
    
    try:
        preload_tts_cache()
    except Exception as e:
        print("Error pre-cargando caché de TTS:", e)

    print("=" * 55)
    print("  Sistema Municipal de Gestión Documental con ML")
    print("  Municipalidad Provincial de Yau")
    print("  Servidor: http://localhost:5000")
    print("=" * 55)
    app.run(debug=True, host='0.0.0.0', port=5000)
