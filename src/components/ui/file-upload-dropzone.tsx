"use client";

import React, { useRef, useState } from "react";
import { UploadCloud, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { sanitizeFileName, buildStorageReference } from "@/lib/storage";
import { ImageCropEditor } from "@/components/ui/image-crop-editor";
import {
  getSupportedRasterImageType,
  validateRasterImageFile,
  type ImageCropConfig,
} from "@/lib/images/crop";

interface FileUploadDropzoneProps {
  bucket: string;
  pathPrefix: string;
  accept?: string;
  maxSizeMb?: number;
  onUploaded: (referenceOrUrl: string) => void;
  publicBucket?: boolean;
  label?: string;
  helperText?: string;
  imageEditor?: ImageCropConfig;
}

export function FileUploadDropzone({
  bucket,
  pathPrefix,
  accept,
  maxSizeMb = 10,
  onUploaded,
  publicBucket = false,
  label = "Subir archivo",
  helperText = "Arrastrá un archivo acá o seleccioná desde tu PC",
  imageEditor,
}: FileUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const supabase = createClient();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
    e.target.value = "";
  };

  const validateAcceptedFile = (file: File): string | null => {
    const maximumSize = imageEditor?.maxFileSizeMb ?? maxSizeMb;
    if (file.size > maximumSize * 1024 * 1024) {
      return `El archivo es muy pesado. Máximo ${maximumSize}MB.`;
    }

    if (accept) {
      const acceptedValues = accept.split(",").map((value) => value.trim().toLowerCase());
      const fileName = file.name.toLowerCase();
      const fileType = file.type.toLowerCase();
      const isAccepted = acceptedValues.some((value) => {
        if (value.startsWith(".")) return fileName.endsWith(value);
        if (value.endsWith("/*")) return fileType.startsWith(value.slice(0, -1));
        return fileType === value;
      });
      if (!isAccepted) return `El archivo debe ser uno de los siguientes tipos: ${accept}`;
    }

    if (imageEditor) return validateRasterImageFile(file, maximumSize);
    return null;
  };

  const handleSelectedFile = (file: File) => {
    setError(null);
    setSuccess(false);
    const validationError = validateAcceptedFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (imageEditor) {
      setPendingImage(file);
      return;
    }

    void handleUpload(file);
  };

  const handleUpload = async (file: File) => {
    setError(null);
    setSuccess(false);
    setUploadProgress(0);

    const validationError = validateAcceptedFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setFileName(file.name);

    try {
      const cleanName = sanitizeFileName(file.name);
      const filePath = `${pathPrefix}/${Date.now()}-${cleanName}`;
      
      const onUploadComplete = (finalFilePath: string) => {
        setSuccess(true);
        if (publicBucket) {
          const { data } = supabase.storage.from(bucket).getPublicUrl(finalFilePath);
          onUploaded(data.publicUrl);
        } else {
          const ref = buildStorageReference(bucket, finalFilePath);
          onUploaded(ref);
        }
        setLoading(false);
      };

      if (maxSizeMb > 20) { // Usa TUS para archivos grandes
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          throw new Error("No hay sesión activa para subir el archivo.");
        }

        const tus = await import("tus-js-client");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const uploadEndpoint = `${supabaseUrl}/storage/v1/upload/resumable`;

        const upload = new tus.Upload(file, {
          endpoint: uploadEndpoint,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: {
            authorization: `Bearer ${sessionData.session.access_token}`,
            apikey: supabaseAnonKey!,
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: bucket,
            objectName: filePath,
            contentType: file.type || "application/octet-stream",
            cacheControl: "3600",
          },
          chunkSize: 6 * 1024 * 1024, // 6 MB
          onError: (err) => {
            console.error("TUS upload failed:", err);
            setError(err.message || "Error al subir el archivo grande.");
            setLoading(false);
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
            setUploadProgress(percentage);
          },
          onSuccess: () => {
            onUploadComplete(filePath);
          },
        });

        upload.findPreviousUploads().then((previousUploads) => {
          if (previousUploads.length) {
            upload.resumeFromPreviousUpload(previousUploads[0]);
          }
          upload.start();
        });
      } else { // Standard direct upload
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(filePath, file, { upsert: true });

        if (uploadError) {
          console.error("Storage upload error:", uploadError);
          setError(uploadError.message || "Error al subir el archivo.");
          setLoading(false);
          return;
        }

        onUploadComplete(filePath);
      }
    } catch (err: unknown) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado al subir.");
      setLoading(false);
    }
  };

  const reset = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSuccess(false);
    setError(null);
    setFileName(null);
    setPendingImage(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="w-full">
      {label && <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">{label}</label>}
      
      <div
        className={`relative flex flex-col items-center justify-center w-full min-h-[120px] rounded-xl border-2 border-dashed transition-all p-4 text-center cursor-pointer overflow-hidden
          ${isDragging ? "border-stampa-orange bg-orange-50" : "border-white/20 bg-stampa-bg-soft hover:bg-white/5"}
          ${success ? "border-green-500 bg-green-50" : ""}
          ${error ? "border-red-500 bg-red-50" : ""}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer bg-stampa-surface border border-stampa-border text-neutral-100 focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 placeholder:text-neutral-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          disabled={loading}
        />
        
        {loading ? (
          <div className="flex flex-col items-center justify-center space-y-3 text-stampa-orange w-full px-6">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-xs font-medium text-gray-400">Subiendo {fileName}...</span>
            {uploadProgress > 0 && (
              <div className="w-full max-w-xs mt-2">
                <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Progreso</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div 
                    className="bg-stampa-orange h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        ) : success ? (
          <div className="flex flex-col items-center justify-center space-y-2 text-green-600">
            <CheckCircle2 className="w-8 h-8" />
            <span className="text-xs font-medium text-gray-200">Archivo subido correctamente</span>
            <span className="text-[10px] text-gray-500 max-w-[200px] truncate">{fileName}</span>
            <button onClick={reset} className="relative z-10 mt-2 text-[10px] font-semibold text-gray-400 bg-stampa-surface px-3 py-1 rounded border border-stampa-border hover:bg-white/5">
              Reemplazar archivo
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-2 text-gray-500">
            {error ? (
              <AlertCircle className="w-8 h-8 text-red-500" />
            ) : (
              <UploadCloud className="w-8 h-8 text-gray-400 group-hover:text-gray-500" />
            )}
            <span className="text-sm font-medium text-gray-300">
              {error ? <span className="text-red-600">{error}</span> : helperText}
            </span>
            {!error && accept && <span className="text-[10px] text-gray-400">Formatos permitidos: {accept.split(',').join(', ')}</span>}
            {error && (
               <button onClick={reset} className="relative z-10 mt-2 text-[10px] font-semibold text-gray-400 bg-stampa-surface px-3 py-1 rounded border border-stampa-border hover:bg-white/5">
                 Intentar de nuevo
               </button>
            )}
          </div>
        )}
      </div>
      {pendingImage && imageEditor && getSupportedRasterImageType(pendingImage) && (
        <ImageCropEditor
          file={pendingImage}
          config={imageEditor}
          onCancel={() => setPendingImage(null)}
          onConfirm={(processedFile) => {
            setPendingImage(null);
            void handleUpload(processedFile);
          }}
        />
      )}
    </div>
  );
}
