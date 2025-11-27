
// TODO: Replace with your project's actual Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBX1H8MaD6eoIo0jbpVRKO-fGtND3PthlI",
  authDomain: "pdt-futura.firebaseapp.com",
  databaseURL: "https://pdt-futura-default-rtdb.firebaseio.com",
  projectId: "pdt-futura",
  storageBucket: "pdt-futura.firebasestorage.app",
  messagingSenderId: "807986666483",
  appId: "1:807986666483:web:d1f1ecabe7076c2f2bd086",
  measurementId: "G-RNZF81BCWP"
};

// Esta función se hará global para ser llamada desde los HTML
function initializeFirebaseApp(onReadyCallback) {
    let firebaseApp;
    try {
        // Intenta obtener la app existente para evitar reinicializar
        firebaseApp = firebase.app(); 
    } catch (e) {
        // Si no existe, inicialízala
        firebaseApp = firebase.initializeApp(firebaseConfig); 
    }

    // Si se proporciona un callback, ejecútalo con la instancia de la app
    if (typeof onReadyCallback === 'function') {
        onReadyCallback(firebaseApp);
    }
}
