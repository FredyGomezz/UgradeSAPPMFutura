
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

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
