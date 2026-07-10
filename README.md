# Mis Notas MATU - Firebase v2

Aplicación web con:
- Inicio de sesión con Google.
- Sincronización en tiempo real mediante Cloud Firestore.
- Separación de notas por usuario.
- Migración opcional de las notas locales de la versión anterior.
- Exportación CSV y JSON.
- Tarjetas de repaso.
- Caché sin conexión.

## Antes de publicar

1. Firebase Authentication > Configuración > Dominios autorizados:
   agregar `notas-matu.vercel.app`

2. Firestore Database > Reglas:
```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /usuarios/{userId}/notas/{noteId} {
      allow read, create, update, delete:
        if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

3. Subir todos los archivos de esta carpeta a Vercel, reemplazando la versión anterior.

## Prueba

- Abra https://notas-matu.vercel.app en el teléfono y la computadora.
- Inicie sesión con la misma cuenta de Google.
- Cree una nota en uno de los dispositivos.
- Debe aparecer automáticamente en el otro.
