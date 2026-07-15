const CACHE = "mis-notas-firebase-v2-1";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
const imageInput = document.getElementById("noteImage");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewContainer = document.getElementById(
  "imagePreviewContainer"
);
const removeImageButton = document.getElementById("removeImage");

let selectedImage = null;

imageInput.addEventListener("change", async function () {
  const file = this.files[0];

  if (!file) {
    return;
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    alert("Seleccione una imagen JPG, PNG o WEBP.");
    clearSelectedImage();
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    alert("La imagen no puede superar los 8 MB.");
    clearSelectedImage();
    return;
  }

  try {
    selectedImage = await compressImage(file);

    imagePreview.src = selectedImage;
    imagePreviewContainer.hidden = false;
  } catch (error) {
    console.error("Error al procesar la imagen:", error);
    alert("No fue posible procesar la imagen.");
    clearSelectedImage();
  }
});

removeImageButton.addEventListener("click", clearSelectedImage);

function clearSelectedImage() {
  selectedImage = null;
  imageInput.value = "";
  imagePreview.removeAttribute("src");
  imagePreviewContainer.hidden = true;
}

function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("No se pudo leer el archivo."));
    };

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => {
        reject(new Error("El archivo no es una imagen válida."));
      };

      image.onload = () => {
        let width = image.width;
        let height = image.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        if (!context) {
          reject(new Error("El navegador no permite procesar la imagen."));
          return;
        }

        context.drawImage(image, 0, 0, width, height);

        const compressedImage = canvas.toDataURL(
          "image/webp",
          quality
        );

        resolve(compressedImage);
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}
