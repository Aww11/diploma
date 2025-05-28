"use client"

import type React from "react"

import { useState } from "react"
import { Upload, FileText, Download, Loader2, ArrowLeft, FileCheck, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Типы данных
interface Author {
  name: string
  affiliation?: string
}

interface Metadata {
  id: string
  title?: string
  authors?: Author[]
  journal?: string
  conference?: string
  city?: string
  publicationDate?: string
  abstract?: string
  funding?: string
  references?: string[]
  keywords?: string[]
  doi?: string
  extraction_confidence?: Record<string, number>
  raw_text_sample?: string
}

interface VerificationData {
  raw_text_sample: string
  extraction_confidence: Record<string, number>
  metadata: {
    title: string
    authors: Author[]
    journal: string
    publicationDate: string
    abstract: string
    doi: string
    keywords: string[]
  }
}

// API URL
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState("json")
  const [verificationData, setVerificationData] = useState<VerificationData | null>(null)
  const [activeTab, setActiveTab] = useState("metadata")

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setError(null)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.type === "application/pdf") {
        setFile(droppedFile)
        setError(null)
      } else {
        setError("Пожалуйста, загрузите файл в формате PDF")
      }
    }
  }

  const handleUpload = async () => {
    if (!file) {
      setError("Пожалуйста, выберите файл")
      return
    }

    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      // Отправляем файл на сервер
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Ошибка при загрузке файла")
      }

      // Получаем ответ с ID файла
      const uploadResult = await response.json()

      setIsUploading(false)
      setIsProcessing(true)

      try {
        // Используем полученный ID файла для запроса метаданных
        const metadataResponse = await fetch(`${API_URL}/api/extract?id=${uploadResult.id}`)

        if (!metadataResponse.ok) {
          const errorData = await metadataResponse.json()
          throw new Error(errorData.detail || "Ошибка при извлечении метаданных")
        }

        const data = await metadataResponse.json()
        setMetadata(data)

        // Получаем данные для проверки
        try {
          const verificationResponse = await fetch(`${API_URL}/api/verification/${uploadResult.id}`)
          if (verificationResponse.ok) {
            const verificationData = await verificationResponse.json()
            setVerificationData(verificationData)
          }
        } catch (verificationErr) {
          console.error("Ошибка при получении данных для проверки:", verificationErr)
        }

        setIsProcessing(false)
      } catch (err) {
        setError((err as Error).message)
        setIsProcessing(false)
      }
    } catch (err) {
      setError((err as Error).message)
      setIsUploading(false)
    }
  }

  const handleExport = async () => {
    if (!metadata) return

    try {
      const response = await fetch(`${API_URL}/api/export?format=${exportFormat}&id=${metadata.id}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Ошибка при экспорте данных")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `metadata.${exportFormat}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const resetApp = () => {
    setFile(null)
    setMetadata(null)
    setError(null)
    setVerificationData(null)
    setActiveTab("metadata")
  }

  const getConfidenceBadge = (confidence: number) => {
    if (confidence > 0.7) {
      return <Badge className="bg-green-500">Высокая ({(confidence * 100).toFixed(0)}%)</Badge>
    } else if (confidence > 0.4) {
      return <Badge className="bg-yellow-500">Средняя ({(confidence * 100).toFixed(0)}%)</Badge>
    } else {
      return <Badge className="bg-red-500">Низкая ({(confidence * 100).toFixed(0)}%)</Badge>
    }
  }

  // Если метаданные не загружены, показываем экран загрузки
  if (!metadata) {
    return (
      <main className="container mx-auto py-8 px-4 max-w-3xl">
        <h1 className="text-2xl font-bold text-center mb-6">Извлечение метаданных научных статей</h1>

        <Card>
          <CardHeader>
            <CardTitle>Загрузка документа</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 mb-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload className="h-10 w-10 text-gray-400 mb-3" />
              <p className="text-sm text-gray-500 mb-3">Перетащите PDF файл или выберите</p>
              <div className="relative">
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => document.getElementById("file-upload")?.click()}
                >
                  Выбрать файл
                </Button>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="file-upload"
                />
              </div>
            </div>

            {file && (
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                <FileText className="h-5 w-5 text-blue-500" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-gray-500 ml-auto">{(file.size / 1024 / 1024).toFixed(2)} МБ</span>
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            <Button onClick={handleUpload} disabled={!file || isUploading || isProcessing} className="w-full">
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isUploading ? "Загрузка..." : isProcessing ? "Обработка..." : "Извлечь метаданные"}
            </Button>
          </CardFooter>
        </Card>
      </main>
    )
  }

  // Если метаданные загружены, показываем их или статистику
  return (
    <main className="container mx-auto py-8 px-4 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Результаты извлечения</h1>
        <Button variant="ghost" size="sm" onClick={resetApp}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Загрузить другой файл
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="metadata">Метаданные</TabsTrigger>
          <TabsTrigger value="verification">Проверка</TabsTrigger>
          <TabsTrigger value="statistics">Статистика</TabsTrigger>
        </TabsList>

        <TabsContent value="metadata">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Название</h3>
                  <p>{metadata.title || "Не найдено"}</p>
                  {verificationData && (
                    <div className="mt-1">{getConfidenceBadge(verificationData.extraction_confidence?.title || 0)}</div>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold">Авторы</h3>
                  {metadata.authors && metadata.authors.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {metadata.authors.map((author, index) => (
                        <li key={index}>
                          {author.name}
                          {author.affiliation && <span className="text-gray-500"> ({author.affiliation})</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Не найдено</p>
                  )}
                  {verificationData && (
                    <div className="mt-1">
                      {getConfidenceBadge(verificationData.extraction_confidence?.authors || 0)}
                    </div>
                  )}
                </div>

                <Separator />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">Журнал/Конференция</h3>
                    <p>{metadata.journal || "Не найдено"}</p>
                    {verificationData && (
                      <div className="mt-1">
                        {getConfidenceBadge(verificationData.extraction_confidence?.journal || 0)}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Дата публикации</h3>
                    <p>{metadata.publicationDate || "Не найдено"}</p>
                    {verificationData && (
                      <div className="mt-1">
                        {getConfidenceBadge(verificationData.extraction_confidence?.publicationDate || 0)}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Город</h3>
                    <p>{metadata.city || "Не найдено"}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">DOI</h3>
                    <p>{metadata.doi || "Не найдено"}</p>
                    {verificationData && (
                      <div className="mt-1">{getConfidenceBadge(verificationData.extraction_confidence?.doi || 0)}</div>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold">Аннотация</h3>
                  <p className="text-sm">{metadata.abstract || "Не найдено"}</p>
                  {verificationData && (
                    <div className="mt-1">
                      {getConfidenceBadge(verificationData.extraction_confidence?.abstract || 0)}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold">Поддержка и гранты</h3>
                  <p>{metadata.funding || "Не найдено"}</p>
                  {verificationData && (
                    <div className="mt-1">
                      {getConfidenceBadge(verificationData.extraction_confidence?.funding || 0)}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold">Список литературы</h3>
                  {metadata.references && metadata.references.length > 0 ? (
                    <ul className="list-decimal pl-5 text-sm">
                      {metadata.references.map((ref, index) => (
                        <li key={index}>{ref}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Не найдено</p>
                  )}
                  {verificationData && (
                    <div className="mt-1">
                      {getConfidenceBadge(verificationData.extraction_confidence?.references || 0)}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between border-t pt-4">
              <div className="flex items-center gap-2">
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Формат" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="xml">XML</SelectItem>
                    <SelectItem value="txt">TXT</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleExport} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Экспорт
                </Button>
              </div>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="verification">
          <Card>
            <CardContent className="pt-6">
              {verificationData ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Образец исходного текста</h3>
                    <div className="bg-gray-50 p-3 rounded-md text-sm font-mono whitespace-pre-wrap">
                      {verificationData.raw_text_sample || "Текст не доступен"}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-2">Оценка уверенности извлечения</h3>
                    <div className="space-y-3">
                      {Object.entries(verificationData.extraction_confidence || {}).map(([field, confidence]) => (
                        <div key={field} className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="capitalize">{field}</span>
                            <span>{(confidence * 100).toFixed(0)}%</span>
                          </div>
                          <Progress value={confidence * 100} className="h-2" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center p-3 bg-blue-50 rounded-md">
                    <FileCheck className="h-5 w-5 text-blue-500 mr-2" />
                    <p className="text-sm text-blue-700">
                      Проверка помогает оценить точность извлечения метаданных. Высокая уверенность означает, что
                      данные, скорее всего, извлечены корректно.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <AlertTriangle className="h-10 w-10 text-yellow-500 mb-3" />
                  <p className="text-center text-gray-600">
                    Данные для проверки недоступны. Возможно, они не были получены при извлечении метаданных.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statistics">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold mb-2">Общая информация</h3>
                  <ul className="space-y-2">
                    <li className="flex justify-between">
                      <span>Количество авторов:</span>
                      <span className="font-medium">{metadata.authors?.length || 0}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Количество ссылок:</span>
                      <span className="font-medium">{metadata.references?.length || 0}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Год публикации:</span>
                      <span className="font-medium">
                        {metadata.publicationDate ? new Date(metadata.publicationDate).getFullYear() : "Н/Д"}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold mb-2">Аффилиации</h3>
                  <ul className="space-y-2">
                    {metadata.authors &&
                      metadata.authors
                        .filter((author) => author.affiliation)
                        .map((author, index) => (
                          <li key={index} className="text-sm">
                            {author.affiliation}
                          </li>
                        ))}
                    {(!metadata.authors || metadata.authors.every((author) => !author.affiliation)) && (
                      <li>Нет данных об аффилиациях</li>
                    )}
                  </ul>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg md:col-span-2">
                  <h3 className="text-lg font-semibold mb-2">Ключевые слова</h3>
                  <div className="flex flex-wrap gap-2">
                    {metadata.keywords && metadata.keywords.length > 0 ? (
                      metadata.keywords.map((keyword, index) => (
                        <span key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                          {keyword}
                        </span>
                      ))
                    ) : (
                      <p>Ключевые слова не найдены</p>
                    )}
                  </div>
                </div>

                {verificationData && verificationData.extraction_confidence && (
                  <div className="bg-gray-50 p-4 rounded-lg md:col-span-2">
                    <h3 className="text-lg font-semibold mb-2">Средняя уверенность извлечения</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span>Общая оценка</span>
                        <span>
                          {(
                            (Object.values(verificationData.extraction_confidence).reduce((sum, val) => sum + val, 0) /
                              Object.values(verificationData.extraction_confidence).length) *
                            100
                          ).toFixed(0)}
                          %
                        </span>
                      </div>
                      <Progress
                        value={
                          (Object.values(verificationData.extraction_confidence).reduce((sum, val) => sum + val, 0) /
                            Object.values(verificationData.extraction_confidence).length) *
                          100
                        }
                        className="h-2"
                      />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-between border-t pt-4">
              <div className="flex items-center gap-2">
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Формат" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="xml">XML</SelectItem>
                    <SelectItem value="txt">TXT</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleExport} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Экспорт
                </Button>
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  )
}
