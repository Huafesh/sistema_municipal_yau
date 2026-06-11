"""
==========================================================
  MÓDULO OCR - Extracción de texto de imágenes y PDFs
  Sistema Municipal - Municipalidad Provincial de Yau
  Herramienta: pytesseract (Tesseract OCR) + OpenCV
==========================================================
"""

import os
import re
import tempfile
import sys
import pytesseract
import cv2
import numpy as np
from PIL import Image

# Configurar ruta de Tesseract en Windows
if sys.platform == 'win32':
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    local_tessdata = r'c:\Users\Huafesh\OneDrive\Desktop\sistema_municipal_yau\sistema_municipal\tessdata'
    if os.path.exists(local_tessdata):
        os.environ['TESSDATA_PREFIX'] = local_tessdata


def preprocesar_imagen(ruta_imagen: str) -> np.ndarray:
    """
    Preprocesa la imagen para mejorar la precisión del OCR.
    Aplica: escala de grises → reducción de ruido → binarización adaptativa
            → operaciones morfológicas

    Args:
        ruta_imagen: Ruta del archivo de imagen

    Returns:
        Imagen procesada como array NumPy
    """
    img = cv2.imread(ruta_imagen)

    if img is None:
        # Intentar cargar con PIL si OpenCV falla
        img_pil = Image.open(ruta_imagen).convert("RGB")
        img = np.array(img_pil)
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

    # 1. Escala de grises
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 2. Redimensionar si la imagen es muy pequeña (mejora OCR)
    alto, ancho = gris.shape
    if ancho < 1000:
        factor = 1000 / ancho
        gris = cv2.resize(gris, None, fx=factor, fy=factor,
                          interpolation=cv2.INTER_CUBIC)

    # 3. Reducción de ruido con filtro gaussiano
    sin_ruido = cv2.GaussianBlur(gris, (3, 3), 0)

    # 4. Binarización adaptativa (superior al threshold fijo para documentos)
    binaria = cv2.adaptiveThreshold(
        sin_ruido, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=11,
        C=2
    )

    # 5. Operaciones morfológicas para limpiar manchas
    kernel = np.ones((2, 2), np.uint8)
    limpia = cv2.morphologyEx(binaria, cv2.MORPH_CLOSE, kernel)

    return limpia


def procesar_imagen(ruta_imagen: str) -> str:
    """
    Extrae el texto completo de una imagen mediante OCR.

    Flujo:
        Imagen → Preprocesamiento → Tesseract OCR → Limpieza → Texto

    Args:
        ruta_imagen: Ruta del archivo de imagen (JPG, PNG, PDF convertido)

    Returns:
        Texto extraído como string limpio
    """
    try:
        # Verificar que el archivo existe
        if not os.path.exists(ruta_imagen):
            return "Error: Archivo no encontrado."

        # Preprocesar imagen
        img_procesada = preprocesar_imagen(ruta_imagen)

        # Configuración Tesseract:
        #   --oem 3  → Modo LSTM (mejor precisión)
        #   --psm 6  → Detectar bloque de texto uniforme
        #   -l spa   → Idioma español
        config_tesseract = "--oem 3 --psm 6 -l spa"

        # Extraer texto
        texto_raw = pytesseract.image_to_string(img_procesada, config=config_tesseract)

        # Limpiar y normalizar texto
        texto_limpio = limpiar_texto(texto_raw)

        if not texto_limpio.strip():
            return "No se pudo extraer texto legible del documento."

        return texto_limpio

    except pytesseract.TesseractNotFoundError:
        return "Error: Tesseract no instalado. Ejecute: sudo apt install tesseract-ocr tesseract-ocr-spa"
    except Exception as e:
        return f"Error en OCR: {str(e)}"


def procesar_pdf(ruta_pdf: str) -> str:
    """
    Convierte PDF a imágenes y extrae texto con OCR.

    Args:
        ruta_pdf: Ruta del archivo PDF

    Returns:
        Texto completo del PDF
    """
    try:
        from pdf2image import convert_from_path
        
        # Intentar usar la ruta local de Poppler si existe
        poppler_path = r"c:\Users\Huafesh\OneDrive\Desktop\sistema_municipal_yau\poppler-26.02.0\Library\bin"
        if os.path.exists(poppler_path):
            paginas = convert_from_path(ruta_pdf, dpi=300, poppler_path=poppler_path)
        else:
            paginas = convert_from_path(ruta_pdf, dpi=300)

        textos = []
        for i, pagina in enumerate(paginas):
            # Guardar página en archivo temporal compatible con cualquier SO
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
                ruta_temp = tmp.name

            try:
                pagina.save(ruta_temp, "JPEG")
                texto_pagina = procesar_imagen(ruta_temp)
                textos.append(f"--- Página {i+1} ---\n{texto_pagina}")
            finally:
                # Limpiar temporal siempre, incluso si hay error
                if os.path.exists(ruta_temp):
                    os.remove(ruta_temp)

        return "\n\n".join(textos)

    except ImportError:
        return "Error: Instale pdf2image con: pip install pdf2image"
    except Exception as e:
        return f"Error al procesar PDF: {str(e)}"


def limpiar_texto(texto: str) -> str:
    """
    Limpia y normaliza el texto extraído por OCR.
    Elimina caracteres inválidos, normaliza espacios y saltos de línea.
    """
    # Eliminar caracteres no deseados (mantener tildes, ñ, etc.)
    texto = re.sub(r'[^\w\s.,;:áéíóúÁÉÍÓÚñÑüÜ\-\/\(\)@#°%]', ' ', texto)

    # Normalizar múltiples espacios en uno
    texto = re.sub(r'[ \t]+', ' ', texto)

    # Normalizar múltiples saltos de línea
    texto = re.sub(r'\n{3,}', '\n\n', texto)

    # Eliminar líneas con solo espacios
    lineas = [l.strip() for l in texto.split('\n') if l.strip()]
    texto = '\n'.join(lineas)

    return texto.strip()


def obtener_datos_ocr(ruta_imagen: str) -> dict:
    """
    Versión extendida: retorna texto + metadatos del OCR.

    Returns:
        Dict con: texto, confianza promedio, num_palabras
    """
    try:
        img_procesada = preprocesar_imagen(ruta_imagen)
        config = "--oem 3 --psm 6 -l spa"

        # Obtener datos detallados (incluye confianza por palabra)
        datos = pytesseract.image_to_data(
            img_procesada,
            config=config,
            output_type=pytesseract.Output.DICT
        )

        # Calcular confianza promedio (ignorar -1)
        confianzas = [int(c) for c in datos['conf'] if str(c) != '-1' and int(c) > 0]
        confianza_prom = sum(confianzas) / len(confianzas) if confianzas else 0

        # Texto completo
        texto = ' '.join([t for t in datos['text'] if t.strip()])
        texto = limpiar_texto(texto)

        return {
            'texto': texto,
            'confianza_promedio': round(confianza_prom, 1),
            'num_palabras': len([t for t in datos['text'] if t.strip()]),
        }
    except Exception as e:
        texto = procesar_imagen(ruta_imagen)
        return {'texto': texto, 'confianza_promedio': 0, 'num_palabras': len(texto.split())}
