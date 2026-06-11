# ParkSpot 🅿

Registra dónde has aparcado cada uno de tus coches. Mapa interactivo, multi-vehículo, Firebase + GitHub Pages.

## Stack

- **Frontend:** HTML + CSS + JS vanilla (ES modules)
- **Mapa:** Leaflet.js + OpenStreetMap (CARTO dark tiles)
- **Auth + BBDD:** Firebase (Auth email/password + Firestore)
- **Hosting:** GitHub Pages

---

## Configuración de Firebase

### 1. Crear proyecto

1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → ponle un nombre → continúa hasta crear
3. En la página principal del proyecto, haz clic en `</>` (Web app)
4. Registra la app (ponle cualquier nombre, **no** actives Firebase Hosting)
5. Copia el objeto `firebaseConfig` que aparece

### 2. Pegar la config

Abre `js/firebase.js` y sustituye el bloque `firebaseConfig` con tus datos:

```js
const firebaseConfig = {
  apiKey:            "...",
  authDomain:        "...",
  projectId:         "...",
  storageBucket:     "...",
  messagingSenderId: "...",
  appId:             "...",
};
```

### 3. Activar Authentication

1. Firebase Console → **Authentication** → Get started
2. Pestaña **Sign-in method** → **Email/Password** → Activar → Guardar

### 4. Crear Firestore

1. Firebase Console → **Firestore Database** → Create database
2. Elige **Start in production mode** → selecciona una región europea (eur3)
3. Una vez creada, ve a **Rules** y pega el contenido de `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/cars/{carId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Publica las reglas.

### 5. Añadir tu dominio a Auth

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Añade: `tuusuario.github.io`

---

## Subir a GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/tuusuario/parking-tracker.git
git push -u origin main
```

Luego en GitHub: **Settings → Pages → Source: Deploy from branch → main / (root)**.

Tu app estará en `https://tuusuario.github.io/parking-tracker/`

---

## Estructura

```
parking-tracker/
├── index.html          ← login / registro
├── app.html            ← app principal con el mapa
├── css/
│   ├── auth.css
│   └── app.css
├── js/
│   ├── firebase.js     ← ⚠️ pon aquí tu config
│   ├── auth.js
│   └── app.js
└── firestore.rules     ← pega esto en Firebase Console
```
