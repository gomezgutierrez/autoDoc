# AutoDoc

Sistema local en Node.js para despachos de abogados que automatiza la recepción de correos IMAP, descarga de adjuntos, preparación documental y clasificación de expedientes.

---

## Requisitos del sistema

- **Node.js >= 18**
- **npm >= 9**
- **Python 3.9+** (solo si quieres OCR de respaldo)
- **Tesseract OCR** (solo si usas Python OCR): https://github.com/UB-Mannheim/tesseract/wiki
- **Poppler para Windows** (solo si usas Python OCR): https://github.com/oschwartz10612/poppler-windows/releases

---

## Instalación rápida

### 1. Clonar e instalar dependencias Node.js

```powershell
cd C:\Users\ivang\workspace\autoDoc
npm install
```

### 2. Configurar el entorno

```powershell
copy .env.example .env
```

Abrir `.env` y rellenar con tus credenciales IMAP reales.

**Para Gmail**: necesitas una *Contraseña de aplicación* (no la contraseña normal).
Ir a: Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones.

### 3. (Opcional) Instalar Python y OCR

```powershell
pip install -r python/requirements.txt
```

---

## Ejecución

### Modo desarrollo (dry-run, no toca correos ni disco)

```powershell
npm run dry-run
```

### Ejecutar una vez y terminar

```powershell
node src/index.js --single-pass
```

### Modo daemon (cron, ejecuta indefinidamente)

```powershell
npm start
```

---

## Estructura de salida

```
data/
├── incoming/          ← Adjuntos temporales (se vacía automáticamente)
├── processed/
│   ├── pasaporte/
│   ├── empadronamiento/
│   ├── contrato_trabajo/
│   ├── ticket/
│   └── otros/
└── review/            ← Documentos que requieren revisión manual
    └── 20260417_1432_mi_documento/
        ├── documento.pdf
        └── metadata.json
logs/
└── autoDoc-2026-04-17.log
```

---

## Categorías de clasificación

| Categoría | Documentos |
|---|---|
| `pasaporte` | Pasaportes, DNI, NIE, documentos de identidad |
| `empadronamiento` | Certificados y volantes de empadronamiento |
| `contrato_trabajo` | Contratos laborales, nóminas, vida laboral |
| `ticket` | Facturas, tickets, recibos |
| `otros` | Todo lo que no encaja en las anteriores |

---

## Revisión manual

Cuando el clasificador no tiene suficiente confianza, el documento se mueve a `data/review/`.
Cada caso tiene su propia carpeta con:

- `documento.pdf`: el fichero a revisar
- `metadata.json`: contexto (remitente, asunto, razón de la duda, mejor estimación)

Tras revisar, mover manualmente el PDF a la categoría correcta:
```
data/processed/{categoria}/
```

---

## Configuración avanzada

Ver `.env.example` para todas las opciones disponibles.

Opciones clave:

| Variable | Descripción | Default |
|---|---|---|
| `CRON_SCHEDULE` | Frecuencia de revisión de correos | `*/5 * * * *` (cada 5 min) |
| `KEYWORD_CONFIDENCE_THRESHOLD` | Confianza mínima para clasificar sin OCR | `0.8` |
| `OCR_CONFIDENCE_THRESHOLD` | Confianza mínima para clasificar con OCR | `0.65` |
| `PYTHON_OCR_ENABLED` | Activar/desactivar el bridge Python | `true` |
| `MAX_ATTACHMENT_SIZE_MB` | Tamaño máximo de adjunto permitido | `25` |

---

## Arquitectura de módulos

```
src/modules/
├── email-reader/          → Conecta IMAP, descarga y parsea correos
├── attachment-downloader/ → Descarga y valida adjuntos a disco
├── document-normalizer/   → HEIC→JPEG, validación PDF
├── pdf-converter/         → Imagen→PDF, corrección de orientación EXIF
├── document-classifier/   → Keywords + Python OCR fallback
├── file-renamer/          → Nombres normalizados {fecha}_{cat}_{hash}.pdf
├── expedient-organizer/   → Mueve PDFs a carpetas de categoría
├── manual-review-manager/ → Gestiona casos dudosos con metadata
└── logger/                → Winston con rotación diaria
```
