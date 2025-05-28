from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from typing import Dict, Any, List, Optional
import os
import json
import xml.dom.minidom
import dicttoxml
import io
import uuid
import logging
from datetime import datetime
import fitz  # PyMuPDF
import openai
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("metadata_extraction.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("metadata-extractor")

# Инициализация FastAPI
app = FastAPI(title="Metadata Extraction API")

# Настройка CORS
origins = [
    "http://localhost:3000",  # Локальный фронтенд
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Настройка OpenAI API
openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    logger.warning("OPENAI_API_KEY не найден в переменных окружения. Пожалуйста, добавьте его в файл .env")

# Временное хранилище для загруженных файлов и их метаданных
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Словарь для хранения метаданных по ID (для временного хранения)
file_metadata = {}

def extract_text_from_pdf(file_path: str) -> str:
    """Извлекает текст из PDF файла."""
    try:
        logger.info(f"Извлечение текста из PDF: {file_path}")
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        logger.info(f"Успешно извлечено {len(text)} символов из PDF")
        return text
    except Exception as e:
        logger.error(f"Ошибка при извлечении текста из PDF: {e}")
        return ""

def extract_metadata_with_openai(text: str) -> Dict[str, Any]:
    """Извлекает метаданные из текста с помощью OpenAI API."""
    try:
        # Проверяем наличие API ключа
        if not openai.api_key:
            logger.error("API ключ OpenAI не настроен. Пожалуйста, добавьте OPENAI_API_KEY в файл .env")
            return {
                "error": "API ключ OpenAI не настроен. Пожалуйста, настройте бэкенд правильно."
            }
            
        logger.info("Отправка запроса в OpenAI API")
        start_time = datetime.now()
        
        # Ограничиваем размер текста, чтобы не превысить лимиты API
        max_text_length = 40000
        if len(text) > max_text_length:
            logger.info(f"Текст слишком длинный ({len(text)} символов), обрезаем до {max_text_length}")
            text = text[:max_text_length] + "..."
        
        # Используем старый синтаксис OpenAI API
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Ты — эксперт по научным статьям. Извлекай метаинформацию строго в формате JSON. "
                        "Если поле отсутствует в статье, указывай null или пустую строку. "
                        "Не добавляй пояснений, только JSON-объект. "
                        "Для каждого поля добавь оценку уверенности от 0 до 1 в поле confidence."
                    )
                },
                {
                    "role": "user",
                    "content": (
                        "Вот текст статьи:\n\n" + text + 
                        "\n\nПожалуйста, извлеки следующие поля в JSON-формате:\n"
                        "- title (название)\n"
                        "- authors (список авторов в формате [{\"name\": \"Имя\", \"affiliation\": \"Аффилиация\"}])\n"
                        "- journal (название журнала)\n"
                        "- conference (название конференции)\n"
                        "- city (город проведения или публикации)\n"
                        "- publicationDate (дата публикации)\n"
                        "- abstract (аннотация)\n"
                        "- funding (финансовая поддержка или гранты)\n"
                        "- references (список литературы в виде массива строк)\n"
                        "- keywords (ключевые слова в виде массива строк)\n"
                        "- doi (DOI статьи)\n"
                        "- confidence (оценка уверенности для каждого поля от 0 до 1)"
                    )
                }
            ]
        )
        
        # Получаем и парсим JSON-ответ
        output_json = response['choices'][0]['message']['content']
        data = json.loads(output_json)
        
        # Добавляем информацию о времени обработки
        processing_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"Запрос к OpenAI API выполнен за {processing_time:.2f} секунд")
        
        # Получаем оценки уверенности из ответа API
        if 'confidence' in data:
            extraction_confidence = data['confidence']
            del data['confidence']  # Удаляем из основных данных
        else:
            # Если API не вернул оценки, используем значения по умолчанию
            extraction_confidence = {}
            for key in data:
                if data[key]:  # Если поле не пустое
                    extraction_confidence[key] = 0.8
                else:
                    extraction_confidence[key] = 0.0
        
        # Добавляем образец исходного текста для проверки
        data["raw_text_sample"] = text[:500] + "..." if len(text) > 500 else text
        data["extraction_confidence"] = extraction_confidence
        
        return data
    except Exception as e:
        logger.error(f"Ошибка при извлечении метаданных с помощью OpenAI: {e}")
        return {"error": str(e), "raw_text_sample": text[:500] + "..." if len(text) > 500 else text}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Загрузка файла на сервер и извлечение метаданных"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Только PDF файлы поддерживаются")
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}.pdf")
    
    try:
        # Сохраняем файл
        with open(file_path, "wb") as buffer:
            contents = await file.read()
            buffer.write(contents)
        
        logger.info(f"Файл загружен: {file.filename}, сохранен как {file_id}.pdf")
        
        # Извлекаем текст из PDF
        text = extract_text_from_pdf(file_path)
        if not text:
            raise HTTPException(status_code=500, detail="Не удалось извлечь текст из PDF")
        
        # Извлекаем метаданные с помощью OpenAI
        metadata = extract_metadata_with_openai(text)
        
        # Добавляем ID для последующего использования
        metadata["id"] = file_id
        
        # Сохраняем в словарь для быстрого доступа
        file_metadata[file_id] = metadata
        
        return {"filename": file.filename, "id": file_id}
    
    except Exception as e:
        logger.error(f"Ошибка при загрузке файла: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при загрузке файла: {str(e)}")

@app.get("/api/extract")
async def extract_metadata(id: str = Query(...)):
    """Получение извлеченных метаданных по ID"""
    try:
        # Проверяем, есть ли метаданные в нашем словаре
        if id in file_metadata:
            logger.info(f"Возвращаем кэшированные метаданные для файла {id}")
            return file_metadata[id]
        
        # Если не нашли, возвращаем ошибку
        logger.warning(f"Метаданные не найдены: {id}")
        raise HTTPException(status_code=404, detail="Метаданные не найдены")
    
    except Exception as e:
        logger.error(f"Ошибка при получении метаданных: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при получении метаданных: {str(e)}")

@app.get("/api/export")
async def export_metadata(format: str = Query(...), id: str = Query(...)):
    """Экспорт метаданных в выбранном формате"""
    try:
        # Получаем метаданные
        if id not in file_metadata:
            logger.warning(f"Метаданные не найдены для экспорта: {id}")
            raise HTTPException(status_code=404, detail="Метаданные не найдены")
        
        metadata = file_metadata[id]
        
        # Удаляем служебные поля перед экспортом
        export_metadata = metadata.copy()
        if "raw_text_sample" in export_metadata:
            del export_metadata["raw_text_sample"]
        if "extraction_confidence" in export_metadata:
            del export_metadata["extraction_confidence"]
        
        if format.lower() == "json":
            logger.info(f"Экспорт метаданных в формате JSON для файла {id}")
            return JSONResponse(content=export_metadata)
        elif format.lower() == "xml":
            logger.info(f"Экспорт метаданных в формате XML для файла {id}")
            xml_data = dicttoxml.dicttoxml(export_metadata, custom_root="metadata", attr_type=False)
            dom = xml.dom.minidom.parseString(xml_data)
            pretty_xml = dom.toprettyxml()
            return Response(content=pretty_xml, media_type="application/xml")
        elif format.lower() == "txt":
            logger.info(f"Экспорт метаданных в формате TXT для файла {id}")
            # Простой текстовый формат
            text_output = io.StringIO()
            text_output.write(f"Название: {export_metadata.get('title', 'Н/Д')}\n\n")
            
            text_output.write("Авторы:\n")
            for author in export_metadata.get('authors', []):
                text_output.write(f"- {author.get('name', 'Н/Д')}")
                if author.get('affiliation'):
                    text_output.write(f" ({author.get('affiliation')})")
                text_output.write("\n")
            text_output.write("\n")
            
            text_output.write(f"Журнал: {export_metadata.get('journal', 'Н/Д')}\n")
            text_output.write(f"Конференция: {export_metadata.get('conference', 'Н/Д')}\n")
            text_output.write(f"Город: {export_metadata.get('city', 'Н/Д')}\n")
            text_output.write(f"Дата публикации: {export_metadata.get('publicationDate', 'Н/Д')}\n")
            text_output.write(f"DOI: {export_metadata.get('doi', 'Н/Д')}\n\n")
            
            text_output.write(f"Аннотация:\n{export_metadata.get('abstract', 'Н/Д')}\n\n")
            
            text_output.write(f"Поддержка и гранты:\n{export_metadata.get('funding', 'Н/Д')}\n\n")
            
            text_output.write("Список литературы:\n")
            for i, ref in enumerate(export_metadata.get('references', []), 1):
                text_output.write(f"{i}. {ref}\n")
            
            return Response(content=text_output.getvalue(), media_type="text/plain")
        else:
            logger.warning(f"Неподдерживаемый формат экспорта: {format}")
            raise HTTPException(status_code=400, detail="Неподдерживаемый формат. Используйте json, xml или txt.")
    
    except Exception as e:
        logger.error(f"Ошибка при экспорте метаданных: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при экспорте метаданных: {str(e)}")

@app.get("/api/verification/{id}")
async def get_verification_data(id: str):
    """Получение данных для проверки извлечения метаданных"""
    try:
        # Получаем метаданные
        if id not in file_metadata:
            logger.warning(f"Метаданные не найдены для проверки: {id}")
            raise HTTPException(status_code=404, detail="Метаданные не найдены")
        
        metadata = file_metadata[id]
        
        # Формируем данные для проверки
        verification_data = {
            "raw_text_sample": metadata.get("raw_text_sample", ""),
            "extraction_confidence": metadata.get("extraction_confidence", {}),
            "metadata": {
                "title": metadata.get("title", ""),
                "authors": metadata.get("authors", []),
                "journal": metadata.get("journal", ""),
                "publicationDate": metadata.get("publicationDate", ""),
                "abstract": metadata.get("abstract", ""),
                "doi": metadata.get("doi", ""),
                "keywords": metadata.get("keywords", [])
            }
        }
        
        logger.info(f"Возвращаем данные для проверки файла {id}")
        return verification_data
    
    except Exception as e:
        logger.error(f"Ошибка при получении данных для проверки: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при получении данных для проверки: {str(e)}")

@app.get("/api/statistics/{id}")
async def get_statistics(id: str):
    """Получение статистики по метаданным"""
    try:
        # Получаем метаданные
        if id not in file_metadata:
            logger.warning(f"Метаданные не найдены для статистики: {id}")
            raise HTTPException(status_code=404, detail="Метаданные не найдены")
        
        metadata = file_metadata[id]
        
        # Вычисление статистики
        stats = {
            "authorCount": len(metadata.get("authors", [])),
            "referenceCount": len(metadata.get("references", [])),
            "publicationYear": metadata.get("publicationDate", "").split("-")[0] if metadata.get("publicationDate") else None,
            "affiliations": list(set([a.get("affiliation") for a in metadata.get("authors", []) if a.get("affiliation")])),
            "keywordCount": len(metadata.get("keywords", [])),
            "extractionConfidence": {
                "average": sum(metadata.get("extraction_confidence", {}).values()) / len(metadata.get("extraction_confidence", {})) if metadata.get("extraction_confidence") else 0,
                "byField": metadata.get("extraction_confidence", {})
            }
        }
        
        logger.info(f"Возвращаем статистику для файла {id}")
        return stats
    
    except Exception as e:
        logger.error(f"Ошибка при получении статистики: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при получении статистики: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
