#!/usr/bin/env python3
"""
classifier.py — OCR y clasificación de documentos PDF.

Este script es invocado por el módulo Node.js python-bridge.js como subprocess.

USO:
  python classifier.py --file /ruta/al/documento.pdf --format json

SALIDA (stdout, JSON):
  {
    "category": "pasaporte",
    "confidence": 0.82,
    "text_snippet": "primeros 500 chars del texto extraído"
  }

DEPENDENCIAS:
  pip install pytesseract Pillow pdf2image

  Además requiere:
  - Tesseract OCR instalado en Windows:
    https://github.com/UB-Mannheim/tesseract/wiki
  - Poppler para Windows (pdf2image lo necesita):
    https://github.com/oschwartz10612/poppler-windows/releases
    → Descomprimir y añadir /bin al PATH del sistema.
"""

import sys
import os
import json
import argparse
import re

# Configurar Tesseract desde variable de entorno (establecida por Node.js)
try:
    import pytesseract
    tesseract_cmd = os.environ.get('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
except ImportError:
    print(json.dumps({
        "category": "otros",
        "confidence": 0.0,
        "text_snippet": "",
        "error": "pytesseract no instalado. Ejecuta: pip install pytesseract"
    }))
    sys.exit(0)

try:
    from PIL import Image
    from pdf2image import convert_from_path
except ImportError as e:
    print(json.dumps({
        "category": "otros",
        "confidence": 0.0,
        "text_snippet": "",
        "error": f"Dependencia faltante: {str(e)}. Ejecuta: pip install Pillow pdf2image"
    }))
    sys.exit(0)


# ─── Reglas de clasificación ──────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    "pasaporte": [
        "pasaporte", "passport", "documento de identidad", "identity document",
        "nif", "nie", "dni", "fecha de expedicion", "fecha de caducidad",
        "lugar de nacimiento", "place of birth", "nationality", "nacionalidad",
        "republic", "kingdom", "reino", "republica"
    ],
    "empadronamiento": [
        "empadronamiento", "padron", "certificado de empadronamiento",
        "ayuntamiento", "municipio", "registro municipal", "domicilio",
        "volante de empadronamiento", "alta en el padron", "residencia"
    ],
    "contrato_trabajo": [
        "contrato de trabajo", "contrato laboral", "nomina", "nomina mensual",
        "trabajador", "empresa", "empleador", "jornada laboral",
        "alta seguridad social", "tc2", "vida laboral", "sueldo", "salario",
        "convenio colectivo", "categoria profesional", "tipo de contrato"
    ],
    "ticket": [
        "ticket", "factura", "recibo", "receipt", "invoice", "total",
        "importe", "iva", "subtotal", "num factura", "numero de factura",
        "fecha de compra", "forma de pago", "tpv", "establecimiento"
    ],
}


def normalize_text(text: str) -> str:
    """Normaliza texto: lowercase, sin acentos, sin puntuación."""
    text = text.lower()
    # Eliminar acentos comunes en español
    replacements = {
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
        'ü': 'u', 'ñ': 'n', 'ç': 'c',
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    # Conservar solo alfanuméricos y espacios
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def classify_text(text: str) -> dict:
    """
    Clasifica el texto extraído por OCR según las categorías definidas.
    Devuelve category, confidence (0-1) y el score por categoría.
    """
    normalized = normalize_text(text)
    scores = {}

    for category, keywords in CATEGORY_KEYWORDS.items():
        hits = sum(1 for kw in keywords if normalize_text(kw) in normalized)
        scores[category] = hits / max(len(keywords), 1)

    best_category = max(scores, key=lambda c: scores[c])
    best_score = scores[best_category]

    # Normalizar: si el best score es 0, devolver 'otros' con confianza 0
    if best_score == 0:
        return {
            "category": "otros",
            "confidence": 0.0,
            "scores": scores,
        }

    # Penalizar si hay empate cerrado (resta confianza)
    sorted_scores = sorted(scores.values(), reverse=True)
    if len(sorted_scores) > 1 and sorted_scores[0] - sorted_scores[1] < 0.05:
        confidence = best_score * 0.8  # Penalización por ambigüedad
    else:
        confidence = min(best_score * 2, 1.0)  # Amplificar hasta max 1.0

    return {
        "category": best_category,
        "confidence": round(confidence, 3),
        "scores": {k: round(v, 3) for k, v in scores.items()},
    }


def extract_text_from_pdf(pdf_path: str, max_pages: int = 2) -> str:
    """
    Extrae texto de un PDF usando OCR:
    1. Convierte páginas a imágenes con pdf2image (Poppler)
    2. Aplica Tesseract OCR en español e inglés
    Limita a max_pages para mantener la velocidad.
    """
    try:
        pages = convert_from_path(
            pdf_path,
            dpi=200,              # 200 DPI: balance calidad/velocidad
            first_page=1,
            last_page=max_pages,
        )
    except Exception as e:
        raise RuntimeError(f"Error convirtiendo PDF a imágenes: {e}. "
                          f"¿Tienes Poppler instalado y en el PATH?")

    full_text = ""
    for i, page_image in enumerate(pages):
        try:
            # Intentar con español e inglés
            text = pytesseract.image_to_string(
                page_image,
                lang="spa+eng",
                config="--oem 3 --psm 3",  # OEM 3: LSTM, PSM 3: auto
            )
            full_text += text + "\n"
        except Exception as e:
            # Fallback: intentar solo inglés
            try:
                text = pytesseract.image_to_string(page_image, lang="eng")
                full_text += text + "\n"
            except Exception:
                pass  # Si falla, continuar con el resto de páginas

    return full_text.strip()


def main():
    parser = argparse.ArgumentParser(description='AutoDoc — Clasificador OCR')
    parser.add_argument('--file', required=True, help='Ruta al fichero PDF')
    parser.add_argument('--format', default='json', choices=['json', 'text'],
                        help='Formato de salida')
    args = parser.parse_args()

    pdf_path = args.file

    if not os.path.isfile(pdf_path):
        output = {
            "category": "otros",
            "confidence": 0.0,
            "text_snippet": "",
            "error": f"Fichero no encontrado: {pdf_path}"
        }
        print(json.dumps(output, ensure_ascii=False))
        sys.exit(0)

    try:
        # Extraer texto con OCR
        extracted_text = extract_text_from_pdf(pdf_path, max_pages=2)

        if not extracted_text:
            output = {
                "category": "otros",
                "confidence": 0.0,
                "text_snippet": "",
                "error": "OCR no pudo extraer texto (imagen en blanco o fuera de idioma)"
            }
        else:
            # Clasificar
            result = classify_text(extracted_text)
            output = {
                "category": result["category"],
                "confidence": result["confidence"],
                "text_snippet": extracted_text[:500],  # Primeros 500 chars para debug
                "scores": result.get("scores", {}),
            }

    except Exception as e:
        output = {
            "category": "otros",
            "confidence": 0.0,
            "text_snippet": "",
            "error": str(e)
        }

    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
