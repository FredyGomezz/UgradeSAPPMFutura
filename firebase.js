// p/Proyectos/Mx SAP PM Familia/PDTFutura/PDTFutura/UgradeSAPPMFutura/config/firebase.js

// Reemplaza esto con la configuración de tu proyecto de Firebase
const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_AUTH_DOMAIN",
    projectId: "TU_PROJECT_ID",
    storageBucket: "TU_STORAGE_BUCKET",
    messagingSenderId: "TU_MESSAGING_SENDER_ID",
    appId: "TU_APP_ID"
};

// Esta función se hará global para ser llamada desde los HTML
function initializeFirebaseApp(onReadyCallback) {
    let firebaseApp;
    try {
        firebaseApp = firebase.app(); // Intenta obtener la app existente
    } catch (e) {
        firebaseApp = firebase.initializeApp(firebaseConfig); // Si no existe, inicialízala
    }

    if (typeof onReadyCallback === 'function') {
        onReadyCallback(firebaseApp);
    }
}