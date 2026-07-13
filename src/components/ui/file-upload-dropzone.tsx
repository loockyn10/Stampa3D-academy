"use client";

import React, { useCallback, useState } from "react";
import { UploadCloud, File as FileIcon, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { sanitizeFileName, buildStorageReference } from "@/lib/storage";

interface FileUploadDropzoneProps {
  bucket: string;
  pathPrefix: string;
  accept?: string;
  maxSizeMb?: number;
  onUploaded: (referenceOrUrl: string) => void;
  publicBucket?: boolean;
  label?: string;
  helperText?: string;
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
}: FileUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const supabase = createClient();

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleUpload(e.target.files[0]);
    }
  };

  const handleUpload = async (file: File) => {
    setError(null);
    setSuccess(false);

    // Validate size
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`El archivo es muy pesado. Máximo ${maxSizeMb}MB.`);
      return;
    }

    setLoading(true);
    setFileName(file.name);

    try {
      const cleanName = sanitizeFileName(file.name);
      const filePath = `${pathPrefix}/${Date.now()}-${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        setError(uploadError.message || "Error al subir el archivo.");
        setLoading(false);
        return;
      }

      setSuccess(true);

      if (publicBucket) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
        onUploaded(data.publicUrl);
      } else {
        const ref = buildStorageReference(bucket, filePath);
        onUploaded(ref);
      }
    } catch (err: any) {
      console.error("Unexpected upload error:", err);
      setError(err.message || "Ocurrió un error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  const reset = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSuccess(false);
    setError(null);
    setFileName(null);
  };

  return (
    <div className="w-full">
      {label && <label className="block text-[10px] font-semibold text-gray-600 uppercase mb-1">{label}</label>}
      
      <div
        className={`relative flex flex-col items-center justify-center w-full min-h-[120px] rounded-xl border-2 border-dashed transition-all p-4 text-center cursor-pointer overflow-hidden
          ${isDragging ? "border-orange-500 bg-orange-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"}
          ${success ? "border-green-500 bg-green-50" : ""}
          ${error ? "border-red-500 bg-red-50" : ""}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={loading}
        />
        
        {loading ? (
          <div className="flex flex-col items-center justify-center space-y-2 text-orange-500">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-xs font-medium text-gray-600">Subiendo {fileName}...</span>
          </div>
        ) : success ? (
          <div className="flex flex-col items-center justify-center space-y-2 text-green-600">
            <CheckCircle2 className="w-8 h-8" />
            <span className="text-xs font-medium text-gray-800">Archivo subido correctamente</span>
            <span className="text-[10px] text-gray-500 max-w-[200px] truncate">{fileName}</span>
            <button onClick={reset} className="relative z-10 mt-2 text-[10px] font-semibold text-gray-600 bg-white px-3 py-1 rounded border border-gray-200 hover:bg-gray-100">
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
            <span className="text-sm font-medium text-gray-700">
              {error ? <span className="text-red-600">{error}</span> : helperText}
            </span>
            {!error && accept && <span className="text-[10px] text-gray-400">Formatos permitidos: {accept.split(',').join(', ')}</span>}
            {error && (
               <button onClick={reset} className="relative z-10 mt-2 text-[10px] font-semibold text-gray-600 bg-white px-3 py-1 rounded border border-gray-200 hover:bg-gray-100">
                 Intentar de nuevo
               </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
