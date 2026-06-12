"""
==========================================================
  SELECTOR DE CURRÍCULOS - Machine Learning
  Sistema Municipal - Municipalidad Provincial de Yau

  Algoritmo : Extracción de características (NLP + Regex)
              + Scoring ponderado por categorías
              + Normalización y Ranking automático
==========================================================
"""

import re
import os
import numpy as np
import joblib
from sklearn.preprocessing import MinMaxScaler


# ==========================================================
# CONFIGURACIÓN DE PESOS POR CATEGORÍA
# Ajustar según los requisitos del puesto convocado
# ==========================================================
PESOS_SCORING = {
    'nivel_educacion':      0.30,   # 30% - Formación académica
    'anios_experiencia':    0.25,   # 25% - Experiencia laboral
    'habilidades_tecnicas': 0.20,   # 20% - Competencias técnicas
    'certificaciones':      0.15,   # 15% - Cursos y certificaciones
    'idiomas':              0.10,   # 10% - Manejo de idiomas
}

# ==========================================================
# TABLAS DE REFERENCIA
# ==========================================================

# Nivel educativo → puntuación base (0-100)
NIVELES_EDUCACION = {
    'doctorado': 100, 'doctor': 100, 'ph.d': 100,
    'maestría': 92, 'maestria': 92, 'magíster': 92, 'magister': 92, 'mba': 90,
    'licenciado': 80, 'licenciatura': 80, 'bachiller': 78,
    'título profesional': 80, 'titulo profesional': 80,
    'ingeniería': 78, 'ingenieria': 78,
    'técnico superior': 65, 'tecnico superior': 65,
    'técnico': 60, 'tecnico': 60, 'instituto': 55,
    'secundaria': 35, 'secundario': 35,
}

# Habilidades buscadas en la municipalidad
HABILIDADES_TECNICAS = [
    # Sistemas e informática
    'python', 'java', 'sql', 'excel avanzado', 'power bi', 'tableau',
    'access', 'word avanzado', 'sistemas de información', 'erp',
    # Gestión pública
    'gestión pública', 'administración pública', 'siaf', 'siga', 'seace',
    'contrataciones del estado', 'ley servir', 'ley bases',
    # Técnico
    'autocad', 'arcgis', 'topografía', 'metrados', 'presupuesto de obra',
    # Transversal
    'liderazgo', 'trabajo en equipo', 'comunicación efectiva',
    'resolución de conflictos', 'gestión de proyectos', 'planificación',
    'atención al ciudadano', 'servicio al cliente',
]

# Certificaciones y estudios complementarios
CERTIFICACIONES = [
    'pmp', 'iso', 'itil', 'scrum', 'prince2', 'cobit',
    'cpa', 'cfa', 'cpc',                         # contables
    'diplomado', 'especialización', 'especialidad',
    'certificado', 'certificación', 'constancia',
    'curso', 'taller', 'seminario',
]

# Idiomas valorados
IDIOMAS_VALORADOS = [
    ('inglés', 20), ('ingles', 20),
    ('francés', 15), ('frances', 15),
    ('portugués', 15), ('portugues', 15),
    ('alemán', 10), ('chino', 10), ('japonés', 10),
    ('quechua', 12), ('aymara', 10),              # Idiomas nativos (valor en Perú)
]

# Categorías de aptitud
CATEGORIAS_APTITUD = [
    (80, "EXCELENTE",  "✅ Altamente recomendado. Convocar a entrevista."),
    (65, "MUY BUENO",  "✅ Recomendado. Verificar referencias laborales."),
    (50, "BUENO",      "⚠️ Cumple requisitos básicos. Evaluar entrevista."),
    (35, "REGULAR",    "⚠️ Perfil débil. Solo considerar si escasean candidatos."),
    (0,  "NO APTO",    "❌ No cumple los requisitos mínimos del puesto."),
]


# ==========================================================
# CLASE PRINCIPAL
# ==========================================================
class SelectorCV:
    """
    Selector y rankeador de currículos vitae usando Machine Learning.

    Flujo completo:
        Imagen CV → OCR → Extracción de features → Scoring → Ranking

    Proceso de scoring:
        1. Detectar nivel educativo (regex + diccionario)
        2. Extraer años de experiencia (regex)
        3. Contar habilidades técnicas relevantes
        4. Detectar certificaciones y estudios complementarios
        5. Identificar idiomas
        6. Calcular puntaje ponderado (suma de categoría × peso)
        7. Generar recomendación automática
    """

    def __init__(self):
        self.historial = []       # Registro de CVs evaluados
        self.scaler = MinMaxScaler(feature_range=(0, 100))

    # ── Evaluación principal ────────────────────────────────
    def evaluar(self, texto_cv: str, nombre_puesto: str = "Puesto Municipal") -> dict:
        """
        Evalúa un CV y genera un perfil completo del candidato.

        Args:
            texto_cv     : Texto extraído por OCR del CV
            nombre_puesto: Nombre del puesto convocado (referencial)

        Returns:
            dict con: datos personales, scores por categoría,
                      puntaje_total, categoría, recomendación
        """
        texto = texto_cv.lower()
        texto_orig = texto_cv

        # 1. EXTRACCIÓN DE CARACTERÍSTICAS
        datos_personales = self._extraer_datos_personales(texto, texto_orig)
        habilidades      = self._extraer_habilidades(texto)
        certificaciones  = self._extraer_certificaciones(texto)
        idiomas          = self._extraer_idiomas(texto)
        educacion        = self._extraer_nivel_educacion(texto)
        experiencia      = self._extraer_experiencia(texto)

        # 2. SCORING POR CATEGORÍA (cada categoría 0-100)
        scores = {
            'nivel_educacion':      self._score_educacion(texto),
            'anios_experiencia':    self._score_experiencia(texto),
            'habilidades_tecnicas': self._score_habilidades(texto),
            'certificaciones':      self._score_certificaciones(texto),
            'idiomas':              self._score_idiomas(texto),
        }

        # 3. PUNTAJE FINAL PONDERADO
        puntaje_total = sum(scores[k] * PESOS_SCORING[k] for k in PESOS_SCORING)
        puntaje_total = round(puntaje_total, 2)

        # 4. CATEGORÍA Y RECOMENDACIÓN
        categoria, recomendacion = self._categorizar(puntaje_total)

        # 5. ANÁLISIS CUALITATIVO
        fortalezas   = [k.replace('_', ' ').title() for k, v in scores.items() if v >= 70]
        areas_mejora = [k.replace('_', ' ').title() for k, v in scores.items() if v < 40]

        resultado = {
            # Datos personales
            'nombre_candidato':       datos_personales.get('nombre', 'No identificado'),
            'email':                  datos_personales.get('email', 'N/A'),
            'telefono':               datos_personales.get('telefono', 'N/A'),
            'dni':                    datos_personales.get('dni', 'N/A'),
            # Perfil profesional
            'nivel_educacion':        educacion,
            'anios_experiencia':      experiencia,
            'habilidades_encontradas': habilidades,
            'certificaciones':        certificaciones,
            'idiomas':                idiomas,
            # Scoring ML
            'scores_por_categoria':   scores,
            'pesos_aplicados':        PESOS_SCORING,
            'puntaje_total':          puntaje_total,
            # Evaluación
            'categoria':              categoria,
            'recomendacion':          recomendacion,
            'fortalezas':             fortalezas,
            'areas_mejora':           areas_mejora,
            'puesto_evaluado':        nombre_puesto,
        }

        # Guardar en historial para ranking
        self.historial.append(resultado)

        return resultado

    # ── Extracción de datos personales ─────────────────────
    def _extraer_datos_personales(self, texto_lower: str, texto_orig: str) -> dict:
        datos = {}

        # Nombre: buscar en primeras 5 líneas (generalmente es la primera)
        lineas = texto_orig.strip().split('\n')
        for linea in lineas[:6]:
            linea = linea.strip()
            # Una línea con 2-4 palabras, sin dígitos, es candidato a nombre
            palabras = linea.split()
            if 2 <= len(palabras) <= 4 and not any(c.isdigit() for c in linea):
                datos['nombre'] = linea.title()
                break

        # Email
        email_re = re.search(r'[\w\.\-]+@[\w\.\-]+\.\w{2,4}', texto_orig)
        datos['email'] = email_re.group().lower() if email_re else 'N/A'

        # Teléfono peruano (celular 9xxxxxxxx o fijo 01-xxxxxxx)
        tel_re = re.search(r'(?:\+51\s?)?9\d{8}|\(\d{2,3}\)\s?\d{5,7}|\d{3}[\s\-]\d{5,6}', texto_orig)
        datos['telefono'] = tel_re.group().strip() if tel_re else 'N/A'

        # DNI peruano (8 dígitos)
        dni_re = re.search(r'\b\d{8}\b', texto_orig)
        datos['dni'] = dni_re.group() if dni_re else 'N/A'

        return datos

    def _extraer_nivel_educacion(self, texto: str) -> str:
        for nivel in sorted(NIVELES_EDUCACION, key=lambda k: NIVELES_EDUCACION[k], reverse=True):
            if nivel in texto:
                return nivel.title()
        return 'No especificado'

    def _extraer_experiencia(self, texto: str) -> int:
        matches = re.findall(r'(\d+)\s*(?:años?|anios?)\s*(?:de\s*)?(?:experiencia|trabajo|laboral)', texto)
        if not matches:
            return 0
        anios = max(int(m) for m in matches)
        return min(50, anios)

    def _extraer_habilidades(self, texto: str) -> list:
        return [h.title() for h in HABILIDADES_TECNICAS if h in texto]

    def _extraer_certificaciones(self, texto: str) -> list:
        return [c.title() for c in CERTIFICACIONES if c in texto]

    def _extraer_idiomas(self, texto: str) -> list:
        return [idioma.title() for idioma, _ in IDIOMAS_VALORADOS if idioma in texto]

    # ── Funciones de scoring ────────────────────────────────
    def _score_educacion(self, texto: str) -> float:
        """Mayor nivel académico encontrado → puntuación 0-100."""
        for nivel, score in sorted(NIVELES_EDUCACION.items(), key=lambda x: x[1], reverse=True):
            if nivel in texto:
                return float(score)
        return 20.0  # Sin educación detectada → puntaje mínimo

    def _score_experiencia(self, texto: str) -> float:
        """Años de experiencia → puntuación 0-100 (escala no lineal)."""
        matches = re.findall(r'(\d+)\s*(?:años?|anios?)\s*(?:de\s*)?(?:experiencia|trabajo|laboral)', texto)
        if not matches:
            return 15.0
        anios = max(int(m) for m in matches)
        # Escala: 0→15, 1→30, 2→45, 4→60, 6→75, 8→88, 10+→100
        tabla = [(0,15), (1,30), (2,45), (4,60), (6,75), (8,88), (10,100)]
        for umbral, puntaje in reversed(tabla):
            if anios >= umbral:
                return float(puntaje)
        return 15.0

    def _score_habilidades(self, texto: str) -> float:
        """Número de habilidades encontradas → puntuación 0-100."""
        n = sum(1 for h in HABILIDADES_TECNICAS if h in texto)
        return min(100.0, float(n * 12))

    def _score_certificaciones(self, texto: str) -> float:
        """Certificaciones y cursos → puntuación 0-100."""
        n = sum(1 for c in CERTIFICACIONES if c in texto)
        return min(100.0, float(n * 20))

    def _score_idiomas(self, texto: str) -> float:
        """Idiomas adicionales → puntuación 0-100."""
        total = sum(pts for idioma, pts in IDIOMAS_VALORADOS if idioma in texto)
        return min(100.0, float(total))

    # ── Categorización ──────────────────────────────────────
    def _categorizar(self, puntaje: float) -> tuple:
        for umbral, categoria, recomendacion in CATEGORIAS_APTITUD:
            if puntaje >= umbral:
                return categoria, recomendacion
        return "NO APTO", "❌ No cumple requisitos."

    # ── Ranking de candidatos ───────────────────────────────
    def ranking(self) -> list:
        """
        Retorna el historial de CVs ordenado de mayor a menor puntaje.
        """
        return sorted(self.historial, key=lambda x: x['puntaje_total'], reverse=True)

    def limpiar_historial(self):
        """Reinicia el historial de candidatos."""
        self.historial = []
