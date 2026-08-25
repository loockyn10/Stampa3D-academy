import { SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";
import { sanitizeFileName } from "@/lib/storage";

export interface UploadStlFileParams {
  supabase: SupabaseClient;
  file: File;
  bucket: string;
  pathPrefix: string;
  onProgress?: (progress: number) => void;
  onSuccess?: (storagePath: string) => void;
  onError?: (error: Error) => void;
}

export function uploadStlFile({
  supabase,
  file,
  bucket,
  pathPrefix,
  onProgress,
  onSuccess,
  onError,
}: UploadStlFileParams) {
  return new Promise<string>(async (resolve, reject) => {
    try {
      const MAX_STL_SIZE = 100 * 1024 * 1024; // 100MB
      const fileNameLower = file.name.toLowerCase();

      // Validación de extensión y tamaño
      if (!fileNameLower.endsWith(".stl") && !fileNameLower.endsWith(".3mf") && !fileNameLower.endsWith(".zip")) {
        throw new Error("El archivo debe ser .stl, .3mf o .zip");
      }

      if (file.size > MAX_STL_SIZE) {
        throw new Error("El archivo no puede superar los 100MB");
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !sessionData.session) {
        throw new Error("No hay sesión activa para subir el archivo.");
      }

      const cleanName = sanitizeFileName(file.name);
      const storagePath = `${pathPrefix}/${Date.now()}-${cleanName}`;
      
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Faltan variables de entorno de Supabase.");
      }

      const uploadEndpoint = `${supabaseUrl}/storage/v1/upload/resumable`;

      const upload = new tus.Upload(file, {
        endpoint: uploadEndpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${sessionData.session.access_token}`,
          apikey: supabaseAnonKey,
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: bucket,
          objectName: storagePath,
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
        },
        chunkSize: 6 * 1024 * 1024, // 6 MB
        onError: function (error) {
          console.error("TUS upload failed:", error);
          if (onError) onError(error);
          reject(error);
        },
        onProgress: function (bytesUploaded, bytesTotal) {
          const percentage = (bytesUploaded / bytesTotal) * 100;
          if (onProgress) onProgress(percentage);
        },
        onSuccess: function () {
          if (onSuccess) onSuccess(storagePath);
          resolve(storagePath);
        },
      });

      // Validar subidas previas incompletas (opcional)
      upload.findPreviousUploads().then(function (previousUploads) {
        if (previousUploads.length) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      });

    } catch (err: any) {
      console.error("[uploadStlFile] Error:", err);
      if (onError) onError(err);
      reject(err);
    }
  });
}
