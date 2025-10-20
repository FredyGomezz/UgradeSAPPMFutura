const express = require('express');
const path = require('path');
const app = express();
const PORT = 8000;

// Servir archivos estáticos desde el directorio actual
app.use(express.static(path.join(__dirname)));

// Ruta por defecto
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor local PDT Futura ejecutándose en http://localhost:${PORT}`);
    console.log(`📁 Archivos servidos desde: ${__dirname}`);
});