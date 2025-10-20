# PDT Futura Backend Server

Servidor Node.js robusto para manejar notificaciones de email en PDT Futura.

## Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno:
   - Copiar `.env` y completar con tus credenciales reales
   - Obtener credenciales de Firebase Admin SDK desde Firebase Console
   - Obtener API Key de SendGrid desde SendGrid Dashboard

3. Iniciar el servidor:
```bash
npm start
# o para desarrollo
npm run dev
```

## Configuración

### Firebase Admin SDK
1. Ir a Firebase Console > Project Settings > Service Accounts
2. Generar nueva clave privada (JSON)
3. Copiar los valores al archivo `.env`

### SendGrid
1. Ir a SendGrid Dashboard > Settings > API Keys
2. Crear nueva API Key con permisos de envío
3. Copiar la API Key al archivo `.env`

## Endpoints

- `GET /health` - Verificar estado del servidor
- `POST /api/notify/task-completed` - Enviar notificación de tarea completada

## Desarrollo

El servidor incluye:
- Rate limiting
- CORS configurado
- Manejo de errores robusto
- Logging detallado
- Validación de requests
- Reintentos automáticos

## Producción

Para producción, considera:
- Usar variables de entorno seguras
- Configurar HTTPS
- Monitoreo y logging avanzado
- Escalado horizontal si es necesario