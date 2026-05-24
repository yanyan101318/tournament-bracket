const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Firestore doc limit is 1MB — keep base64 string under ~900KB */
const MAX_BASE64_LENGTH = 900_000;
const STORAGE_MAX_DIMENSION = 640;

export function validateProductImageFile(file) {
  if (!file) return { ok: false, error: "No file selected" };
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: "Only JPG, PNG, or WEBP images are allowed" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "Image must be 2MB or smaller" };
  }
  return { ok: true };
}

export function readImagePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize and encode as base64 data URL for Firestore (productImage field).
 * Existing https:// URLs from older uploads still work as img src.
 */
export async function fileToProductImageBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      const maxDim = STORAGE_MAX_DIMENSION;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.82;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > MAX_BASE64_LENGTH && quality > 0.45) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      if (dataUrl.length > MAX_BASE64_LENGTH) {
        reject(new Error("Image is too large after compression. Use a smaller photo."));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Invalid image file"));
    };
    img.src = objectUrl;
  });
}

/** @deprecated Use fileToProductImageBase64 — kept for call-site compatibility */
export async function uploadProductImage(file) {
  return fileToProductImageBase64(file);
}
