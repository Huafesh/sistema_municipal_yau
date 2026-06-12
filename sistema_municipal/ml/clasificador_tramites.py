"""
==========================================================
  CLASIFICADOR DE TRÁMITES - Machine Learning
  Sistema Municipal - Municipalidad Provincial de Yau

  Algoritmo : TF-IDF Vectorizer + Random Forest Classifier
  Tarea     : Clasificar tipo y PRIORIDAD de trámites
              a partir del texto extraído por OCR
==========================================================
"""

import os
import re
import numpy as np
import joblib
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score


# ==========================================================
# DATOS DE ENTRENAMIENTO
# Formato: (texto_descripcion, prioridad, tipo_tramite, departamento)
# ==========================================================
DATOS_ENTRENAMIENTO = [

    # ── PRIORIDAD: CRÍTICO ─────────────────────────────────
    ("permiso demolicion zona histórica patrimonio cultural edificio antiguo",
     "CRÍTICO", "Permiso de Demolición", "Gestión Urbana y Rural"),
    ("emergencia sanitaria contaminación agua potable salud pública brote enfermedad",
     "CRÍTICO", "Emergencia Sanitaria", "Salud Pública"),
    ("riesgo derrumbe estructura edificio peligro inminente colapso",
     "CRÍTICO", "Alerta Estructural", "Defensa Civil"),
    ("paralización obra construcción ilegal sin permiso zona residencial",
     "CRÍTICO", "Paralización de Obra", "Fiscalización"),
    ("contaminación ambiental residuos tóxicos río vertido peligroso",
     "CRÍTICO", "Emergencia Ambiental", "Medio Ambiente"),
    ("incendio siniestro daños propiedades extinguir fuego bomberos",
     "CRÍTICO", "Emergencia Incendio", "Defensa Civil"),
    ("violencia doméstica denuncia protección víctima mujer menor",
     "CRÍTICO", "Protección Social", "Bienestar Social"),
    ("accidente tránsito víctimas heridos atención urgente ambulancia",
     "CRÍTICO", "Emergencia Vial", "Seguridad Ciudadana"),
    ("robo asalto hurto denuncia policía seguridad",
     "CRÍTICO", "Denuncia Policial", "Seguridad Ciudadana"),

    # ── PRIORIDAD: ALTO ────────────────────────────────────
    ("licencia funcionamiento restaurante local comercial negocio apertura",
     "ALTO", "Licencia de Funcionamiento", "Licencias y Autorizaciones"),
    ("permiso construcción edificio planos ingeniería obra nueva",
     "ALTO", "Permiso de Construcción", "Gestión Urbana y Rural"),
    ("licencia funcionamiento farmacia botica medicamentos salud droguería",
     "ALTO", "Licencia de Farmacia", "Licencias y Autorizaciones"),
    ("renovación licencia comercial anual vencimiento caducidad",
     "ALTO", "Renovación de Licencia", "Licencias y Autorizaciones"),
    ("autorización funcionamiento hotel hospedaje turismo alojamiento",
     "ALTO", "Licencia Turismo", "Licencias y Autorizaciones"),
    ("permiso evento público plaza concentración masiva espectáculo",
     "ALTO", "Permiso de Evento", "Seguridad Ciudadana"),
    ("apelación resolución multa infracción administrativa plazo legal recurso",
     "ALTO", "Recurso de Apelación", "Asesoría Legal"),
    ("solicitud exoneración impuesto predio pensión jubilación anciano",
     "ALTO", "Exoneración Tributaria", "Rentas y Tributación"),
    ("defensa posesión predio invasión terreno propiedad municipal",
     "ALTO", "Defensa de Propiedad", "Asesoría Legal"),
    ("habilitación urbana lotización subdivisión predio terreno",
     "ALTO", "Habilitación Urbana", "Gestión Urbana y Rural"),
    ("licencia funcionamiento bodega abarrotes tienda comercio",
     "ALTO", "Licencia de Funcionamiento", "Licencias y Autorizaciones"),

    # ── PRIORIDAD: MEDIO ───────────────────────────────────
    ("certificado residencia constancia domicilio habitual vivir",
     "MEDIO", "Certificado de Residencia", "Registro Civil"),
    ("declaración jurada posesión bien inmueble predio propiedad",
     "MEDIO", "Declaración Jurada", "Registro Civil"),
    ("constancia no adeudos tributos municipales impuestos deudas",
     "MEDIO", "Constancia No Adeudos", "Rentas y Tributación"),
    ("partida nacimiento registro civil estado civil acta matrimonio",
     "MEDIO", "Acta Registro Civil", "Registro Civil"),
    ("solicitud autovalúo predio terreno valorización catastro",
     "MEDIO", "Autovalúo Predial", "Catastro"),
    ("permiso anuncio publicidad exterior letrero aviso comercial",
     "MEDIO", "Permiso de Publicidad", "Licencias y Autorizaciones"),
    ("certificado numeración predial dirección catastro ubicación",
     "MEDIO", "Numeración Predial", "Catastro"),
    ("conformidad obra finalización construcción habilitación inspección",
     "MEDIO", "Conformidad de Obra", "Gestión Urbana y Rural"),
    ("pago impuesto predial arbitrios contribución municipal cuota",
     "MEDIO", "Pago Tributos", "Rentas y Tributación"),
    ("fraccionamiento deuda pago cuotas facilidades tributos",
     "MEDIO", "Fraccionamiento Deuda", "Rentas y Tributación"),

    # ── PRIORIDAD: BAJO ────────────────────────────────────
    ("solicitud información pública transparencia acceso datos ley",
     "BAJO", "Acceso a Información", "Secretaría General"),
    ("consulta estado trámite seguimiento expediente número número",
     "BAJO", "Consulta de Trámite", "Mesa de Partes"),
    ("sugerencia queja servicio atención ciudadano libro reclamaciones",
     "BAJO", "Queja o Sugerencia", "Atención al Ciudadano"),
    ("solicitud copia documento expediente archivo histórico copia simple",
     "BAJO", "Copia de Documento", "Archivo General"),
    ("consulta horario atención servicio municipal información general",
     "BAJO", "Consulta General", "Informes"),
    ("certificado buena conducta comportamiento vecinal positivo",
     "BAJO", "Certificado de Conducta", "Registro Civil"),
    ("solicitud mapa plano zona área referencia cartografía",
     "BAJO", "Plano de Referencia", "Catastro"),
]

# ==========================================================
# TABLAS DE CONFIGURACIÓN
# ==========================================================
SCORE_PRIORIDAD = {
    "CRÍTICO": 100,
    "ALTO":     75,
    "MEDIO":    50,
    "BAJO":     25,
}

TIEMPO_ESTIMADO_DIAS = {
    "CRÍTICO": 1,
    "ALTO":    5,
    "MEDIO":   10,
    "BAJO":    15,
}

# Palabras clave de seguridad: si aparecen elevan la prioridad
PALABRAS_CLAVE = {
    "CRÍTICO": ["emergencia", "urgente", "peligro", "riesgo", "derrumbe",
                "incendio", "contaminación", "colapso", "víctima", "herido"],
    "ALTO":    ["licencia", "permiso", "construcción", "apelación", "plazo"],
    "MEDIO":   ["certificado", "constancia", "declaración", "partida", "autovalúo"],
    "BAJO":    ["consulta", "información", "seguimiento", "copia", "sugerencia"],
}

MAPA_DEPARTAMENTOS = {
    "Licencia de Funcionamiento":   "Licencias y Autorizaciones",
    "Permiso de Construcción":      "Gestión Urbana y Rural",
    "Certificado de Residencia":    "Registro Civil",
    "Emergencia Sanitaria":         "Salud Pública",
    "Permiso de Demolición":        "Gestión Urbana y Rural",
    "Declaración Jurada":           "Registro Civil",
    "Constancia No Adeudos":        "Rentas y Tributación",
    "Recurso de Apelación":         "Asesoría Legal",
    "Alerta Estructural":           "Defensa Civil",
    "Autovalúo Predial":            "Catastro",
    "Pago Tributos":                "Rentas y Tributación",
}

RUTA_MODELO = os.path.join(os.path.dirname(__file__), "modelos", "clasificador_tramites.pkl")


# ==========================================================
# CLASE PRINCIPAL
# ==========================================================
class ClasificadorTramites:
    """
    Clasificador de trámites municipales basado en Machine Learning.

    Pipeline:
        Texto OCR → TF-IDF Vectorizer → Random Forest → Prioridad + Tipo

    Atributos:
        modelo_prioridad : Pipeline TF-IDF + RF para predecir CRÍTICO/ALTO/MEDIO/BAJO
        modelo_tipo      : Pipeline TF-IDF + RF para predecir tipo de trámite
    """

    def __init__(self):
        self.modelo_prioridad = None
        self.modelo_tipo = None
        self._inicializar()

    # ── Inicialización ──────────────────────────────────────
    def _inicializar(self):
        """Carga modelo guardado; si no existe, lo entrena."""
        if os.path.exists(RUTA_MODELO):
            try:
                self._cargar_modelo()
                print("[ClasificadorTramites] Modelo cargado desde disco.")
            except Exception as e:
                print(f"[ClasificadorTramites] Error al cargar modelo guardado: {e}. Reentrenando...")
                self._entrenar()
        else:
            print("[ClasificadorTramites] Entrenando nuevo modelo...")
            self._entrenar()

    # ── Entrenamiento ───────────────────────────────────────
    def _entrenar(self):
        """
        Entrena dos pipelines Random Forest:
          1) Clasificador de PRIORIDAD (CRÍTICO/ALTO/MEDIO/BAJO)
          2) Clasificador de TIPO de trámite
        """
        textos      = [d[0] for d in DATOS_ENTRENAMIENTO]
        prioridades = [d[1] for d in DATOS_ENTRENAMIENTO]
        tipos       = [d[2] for d in DATOS_ENTRENAMIENTO]

        # ── Pipeline 1: Prioridad ──────────────────────────
        self.modelo_prioridad = Pipeline([
            ('tfidf', TfidfVectorizer(
                ngram_range=(1, 2),       # unigramas + bigramas
                max_features=2000,
                min_df=1,
                stop_words=['de', 'la', 'el', 'en', 'y', 'a', 'los',
                            'del', 'se', 'las', 'un', 'una', 'con', 'por'],
            )),
            ('clf', RandomForestClassifier(
                n_estimators=200,
                max_depth=None,
                class_weight='balanced',  # Maneja desbalance de clases
                random_state=42,
            )),
        ])
        self.modelo_prioridad.fit(textos, prioridades)

        # ── Pipeline 2: Tipo de trámite ────────────────────
        self.modelo_tipo = Pipeline([
            ('tfidf', TfidfVectorizer(
                ngram_range=(1, 2),
                max_features=2000,
                min_df=1,
            )),
            ('clf', RandomForestClassifier(
                n_estimators=200,
                random_state=42,
            )),
        ])
        self.modelo_tipo.fit(textos, tipos)

        self._guardar_modelo()
        self._evaluar(textos, prioridades)
        print("[ClasificadorTramites] Modelo entrenado y guardado.")

    def _evaluar(self, textos, prioridades):
        """Muestra métricas de desempeño del modelo."""
        y_pred = self.modelo_prioridad.predict(textos)
        acc = accuracy_score(prioridades, y_pred)
        print(f"\n-- Metricas del Modelo de Prioridad --")
        print(f"Accuracy (train): {acc:.2%}")
        print(classification_report(prioridades, y_pred))

    def _guardar_modelo(self):
        os.makedirs(os.path.dirname(RUTA_MODELO), exist_ok=True)
        joblib.dump({
            'modelo_prioridad': self.modelo_prioridad,
            'modelo_tipo':      self.modelo_tipo,
        }, RUTA_MODELO)

    def _cargar_modelo(self):
        datos = joblib.load(RUTA_MODELO)
        self.modelo_prioridad = datos['modelo_prioridad']
        self.modelo_tipo      = datos['modelo_tipo']

    # ── Predicción principal ────────────────────────────────
    def clasificar(self, texto: str) -> dict:
        """
        Clasifica un trámite a partir de texto extraído por OCR.

        Args:
            texto: Texto del documento (resultado del OCR)

        Returns:
            dict con: prioridad, tipo, score, confianza, departamento,
                      tiempo_estimado_dias, probabilidades por clase
        """
        if not texto or len(texto.strip()) < 5:
            return self._resultado_defecto()

        texto_lower = texto.lower()

        # ── Predicción de prioridad ────────────────────────
        prioridad = self.modelo_prioridad.predict([texto_lower])[0]
        probas    = self.modelo_prioridad.predict_proba([texto_lower])[0]
        clases    = self.modelo_prioridad.classes_
        confianza = float(max(probas))

        # ── Predicción de tipo ─────────────────────────────
        tipo = self.modelo_tipo.predict([texto_lower])[0]

        # ── Ajuste por palabras clave (safety boost) ───────
        prioridad = self._ajustar_prioridad(texto_lower, prioridad)

        # ── Departamento responsable ───────────────────────
        departamento = MAPA_DEPARTAMENTOS.get(tipo, "Atención al Ciudadano")

        return {
            'prioridad':            prioridad,
            'tipo':                 tipo,
            'score':                SCORE_PRIORIDAD[prioridad],
            'confianza_pct':        round(confianza * 100, 1),
            'departamento':         departamento,
            'tiempo_estimado_dias': TIEMPO_ESTIMADO_DIAS[prioridad],
            'probabilidades': {
                c: round(float(p) * 100, 1)
                for c, p in zip(clases, probas)
            },
        }

    def _ajustar_prioridad(self, texto: str, prioridad_pred: str) -> str:
        """
        Si el texto contiene palabras de alta criticidad,
        eleva la prioridad predicha para mayor seguridad.
        """
        ORDEN = ["BAJO", "MEDIO", "ALTO", "CRÍTICO"]
        for nivel, palabras in PALABRAS_CLAVE.items():
            if any(p in texto for p in palabras):
                if ORDEN.index(nivel) > ORDEN.index(prioridad_pred):
                    return nivel
        return prioridad_pred

    def _resultado_defecto(self) -> dict:
        return {
            'prioridad':            'MEDIO',
            'tipo':                 'Solicitud General',
            'score':                50,
            'confianza_pct':        0.0,
            'departamento':         'Mesa de Partes',
            'tiempo_estimado_dias': 10,
            'probabilidades':       {},
        }

    # ── Reentrenamiento ─────────────────────────────────────
    def reentrenar_con_nuevos_datos(self, nuevos_datos: list):
        """
        Agrega nuevos datos al conjunto de entrenamiento y reentrena.
        Permite mejora continua del modelo.

        Args:
            nuevos_datos: Lista de tuplas (texto, prioridad, tipo, departamento)
        """
        global DATOS_ENTRENAMIENTO
        DATOS_ENTRENAMIENTO.extend(nuevos_datos)
        print(f"[ClasificadorTramites] Reentrenando con {len(DATOS_ENTRENAMIENTO)} ejemplos...")
        self._entrenar()
