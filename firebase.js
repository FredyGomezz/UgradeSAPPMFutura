// ==================================================
//        ARCHIVO DE CONFIGURACIÓN DE FIREBASE
// ==================================================
// Este archivo centraliza la inicialización de Firebase
// para toda la aplicación.

const firebaseConfig = {
    apiKey: "AIzaSyBX1H8MaD6eoIo0jbpVRKO-fGtND3PthlI",
    authDomain: "pdt-futura.firebaseapp.com",
    projectId: "pdt-futura",
    storageBucket: "pdt-futura.appspot.com",
    messagingSenderId: "807986666483",
    appId: "1:807986666483:web:4213a33d83132845c87931"
};

// Inicializar Firebase solo una vez
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}