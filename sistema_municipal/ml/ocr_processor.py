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


def preprocesar_imagen(origen) -> np.ndarray:
    """
    Preprocesa la imagen para mejorar la precisión del OCR.
    Aplica: escala de grises → reducción de ruido → binarización adaptativa
            → operaciones morfológicas

    Args:
        origen: Ruta del archivo de imagen (str), objeto PIL Image o array NumPy (OpenCV)

    Returns:
        Imagen procesada como array NumPy
    """
    if isinstance(origen, str):
        img = cv2.imread(origen)
        if img is None:
            # Intentar cargar con PIL si OpenCV falla
            img_pil = Image.open(origen).convert("RGB")
            img = np.array(img_pil)
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    elif isinstance(origen, np.ndarray):
        img = origen.copy()
    else:
        # Asumir que es una imagen PIL
        img_pil = origen.convert("RGB")
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


def procesar_imagen_generator(ruta_imagen: str):
    """Generador que procesa una imagen y reporta el progreso de carga."""
    try:
        yield 15, "Verificando archivo de imagen..."
        if not os.path.exists(ruta_imagen):
            yield 100, "Error: Archivo no encontrado."
            return

        yield 35, "Preprocesando imagen con OpenCV (reducción de ruido y binarización)..."
        img_procesada = preprocesar_imagen(ruta_imagen)

        yield 60, "Analizando texto con Tesseract OCR..."
        config_tesseract = "--oem 3 --psm 6 -l spa"
        texto_raw = pytesseract.image_to_string(img_procesada, config=config_tesseract)

        yield 85, "Limpiando y normalizando texto extraído..."
        texto_limpio = limpiar_texto(texto_raw)

        if not texto_limpio.strip():
            yield 100, "No se pudo extraer texto legible del documento."
            return

        yield 100, texto_limpio

    except pytesseract.TesseractNotFoundError:
        yield 100, "Error: Tesseract no instalado."
    except Exception as e:
        yield 100, f"Error en OCR: {str(e)}"


def procesar_imagen(ruta_imagen: str) -> str:
    """Extrae el texto completo de una imagen mediante OCR (síncrono)."""
    res = ""
    for pct, val in procesar_imagen_generator(ruta_imagen):
        if pct == 100:
            res = val
    return res


def procesar_pdf_generator(ruta_pdf: str):
    """Generador que procesa un PDF en paralelo y reporta el progreso página a página."""
    try:
        from pdf2image import convert_from_path, pdfinfo_from_path
        from concurrent.futures import ThreadPoolExecutor
        import multiprocessing
        import concurrent.futures
        
        # Intentar usar la ruta local de Poppler si existe
        poppler_path = r"c:\Users\Huafesh\OneDrive\Desktop\sistema_municipal_yau\poppler-26.02.0\Library\bin"
        
        yield 5, "Analizando la estructura del archivo PDF..."
        
        info = {}
        try:
            if os.path.exists(poppler_path):
                info = pdfinfo_from_path(ruta_pdf, poppler_path=poppler_path)
            else:
                info = pdfinfo_from_path(ruta_pdf)
        except Exception as info_err:
            print("Error obteniendo info de PDF:", info_err)
            
        total_paginas = info.get("Pages", 1)
        max_paginas = 50
        excede_limite = total_paginas > max_paginas
        paginas_a_procesar = min(total_paginas, max_paginas)
        
        yield 15, f"Convirtiendo {paginas_a_procesar} páginas a imágenes digitales..."
        
        # Convertir las páginas del PDF
        if os.path.exists(poppler_path):
            paginas = convert_from_path(ruta_pdf, dpi=200, poppler_path=poppler_path, last_page=paginas_a_procesar)
        else:
            paginas = convert_from_path(ruta_pdf, dpi=200, last_page=paginas_a_procesar)

        yield 30, f"Iniciando OCR en paralelo ({paginas_a_procesar} páginas)..."

        # Función auxiliar para procesar una página individual en memoria
        def procesar_pagina_individual(arg_tuple):
            idx, pagina = arg_tuple
            try:
                img_procesada = preprocesar_imagen(pagina)
                config_tesseract = "--oem 3 --psm 6 -l spa"
                texto_raw = pytesseract.image_to_string(img_procesada, config=config_tesseract)
                texto_limpio = limpiar_texto(texto_raw)
                return idx, f"--- Página {idx+1} ---\n{texto_limpio}"
            except Exception as e:
                print(f"Error procesando página {idx+1}: {e}")
                return idx, f"--- Página {idx+1} ---\nError en OCR: {str(e)}"

        # Determinar número óptimo de hilos concurrentes
        cpu_cores = multiprocessing.cpu_count() or 4
        num_workers = min(paginas_a_procesar, cpu_cores)
        
        tareas = list(enumerate(paginas))
        textos_ordenados = [None] * len(paginas)
        paginas_completadas = 0
        
        # Ejecución paralela multihilo
        with ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = {executor.submit(procesar_pagina_individual, tarea): tarea[0] for tarea in tareas}
            
            for future in concurrent.futures.as_completed(futures):
                idx, texto = future.result()
                textos_ordenados[idx] = texto
                paginas_completadas += 1
                
                # Escalar el progreso de 30% a 90%
                pct = 30 + int((paginas_completadas / paginas_a_procesar) * 60)
                yield pct, f"Ejecutando OCR: página {paginas_completadas} de {paginas_a_procesar}..."

        yield 92, "Consolidando textos extraídos..."
        resultado = "\n\n".join(textos_ordenados)
        if excede_limite:
            resultado += f"\n\n--- [NOTA DEL SISTEMA: El archivo original contiene {total_paginas} páginas. Para optimizar el rendimiento de la mesa de partes, se han procesado las primeras {max_paginas} páginas] ---"
            
        yield 100, resultado

    except ImportError:
        yield 100, "Error: Instale pdf2image con: pip install pdf2image"
    except Exception as e:
        yield 100, f"Error al procesar PDF: {str(e)}"


def procesar_pdf(ruta_pdf: str) -> str:
    """Convierte PDF a imágenes y extrae texto con OCR en paralelo (síncrono)."""
    res = ""
    for pct, val in procesar_pdf_generator(ruta_pdf):
        if pct == 100:
            res = val
    return res


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


def obtener_datos_ocr_generator(ruta_imagen: str):
    """Generador que extrae texto + metadatos (confianza) del OCR y reporta progreso."""
    try:
        yield 15, "Inicializando análisis avanzado OCR de la imagen..."
        img_procesada = preprocesar_imagen(ruta_imagen)
        config = "--oem 3 --psm 6 -l spa"

        yield 45, "Ejecutando Tesseract OCR (análisis de confianza por palabra)..."
        datos = pytesseract.image_to_data(
            img_procesada,
            config=config,
            output_type=pytesseract.Output.DICT
        )

        yield 75, "Calculando niveles de confianza del texto..."
        confianzas = [int(c) for c in datos['conf'] if str(c) != '-1' and int(c) > 0]
        confianza_prom = sum(confianzas) / len(confianzas) if confianzas else 0

        texto = ' '.join([t for t in datos['text'] if t.strip()])
        texto = limpiar_texto(texto)

        yield 100, {
            'texto': texto,
            'confianza_promedio': round(confianza_prom, 1),
            'num_palabras': len([t for t in datos['text'] if t.strip()]),
        }
    except Exception as e:
        # Fallback usando procesar_imagen
        texto = ""
        for pct, val in procesar_imagen_generator(ruta_imagen):
            if pct == 100:
                texto = val
            else:
                yield pct, val
        yield 100, {'texto': texto, 'confianza_promedio': 0, 'num_palabras': len(texto.split())}


def obtener_datos_ocr(ruta_imagen: str) -> dict:
    """Extrae texto + metadatos del OCR (síncrono)."""
    res = {}
    for pct, val in obtener_datos_ocr_generator(ruta_imagen):
        if pct == 100:
            res = val
    return res
