// =========== SERVICIO CENTRALIZADO DE NOTIFICACIONES ===========
// Archivo: notification-service.js
// Sistema de notificaciones vía Backend API REST (simplificado)

class NotificationService {
    constructor(dbInstance = null) {
        this.db = dbInstance;
        this.backendUrl = 'http://localhost:3001';
        this.fromEmail = 'gomez.fredy.sap@gmail.com';
        this.fromName = 'Sistema PDT Futura';

        // Configuración de timeouts y reintentos
        this.timeout = 10000; // 10 segundos
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 segundo para reintentos
    }

    checkConfiguration() {
        if (!this.backendUrl) {
            console.error('❌ URL del backend no configurada');
            return false;
        }

        if (!this.fromEmail) {
            console.error('❌ Email remitente no configurado');
            return false;
        }

        console.log('✅ Configuración del backend verificada');
        return true;
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // ========== ENVÍO DE EMAILS ==========

    async sendEmail(notificationType, data) {
        if (!this.checkConfiguration()) {
            throw new Error('Configuración del backend inválida');
        }

        // Determinar endpoint y preparar datos según tipo
        let endpoint, requestData;
        switch (notificationType) {
            case 'new_user':
                endpoint = '/api/notify/new-user';
                requestData = { userData: data };
                break;
            case 'user_added_to_project':
                endpoint = '/api/notify/user-added-to-project';
                requestData = data; // { projectData, newUser, addedBy }
                break;
            case 'task_completed':
                endpoint = '/api/notify/task-completed';
                requestData = {
                    projectId: data.projectId,
                    taskId: data.taskId,
                    userId: data.userId,
                    taskData: data.taskData,
                    completerData: data.completerData,
                    html: data.html,
                    to: data.to,
                    subject: data.subject
                };
                break;
            default:
                throw new Error(`Tipo de notificación desconocido: ${notificationType}`);
        }

        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`📧 Enviando notificación ${notificationType} al backend (intento ${attempt}/${this.maxRetries})`);

                const response = await fetch(`${this.backendUrl}${endpoint}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData),
                    signal: AbortSignal.timeout(this.timeout)
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    let errorMessage = `Backend error ${response.status}: ${errorData}`;

                    // Check if it's a local mode response (though we removed it)
                    try {
                        const jsonData = JSON.parse(errorData);
                        errorMessage = `Backend error ${response.status}: ${jsonData.details || jsonData.error || errorData}`;
                    } catch (parseError) {
                        // Not JSON, use as-is
                    }

                    throw new Error(errorMessage);
                }

                const result = await response.json();
                console.log(`✅ Notificación ${notificationType} enviada exitosamente al backend:`, result);
                return { success: true, result };

            } catch (error) {
                lastError = error;
                console.warn(`⚠️ Intento ${attempt} falló para ${notificationType}:`, error.message);

                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                }
            }
        }

        console.error(`❌ Fallaron todos los intentos para ${notificationType}:`, lastError.message);
        throw lastError;
    }

    // ========== NOTIFICACIONES ESPECÍFICAS ==========

    /**
     * Notificación de nuevo usuario registrado
     */
    sendNewUserNotification(userData) {
        return this.sendEmail('new_user', { userData });
    }

    /**
     * Notificación de usuario agregado a proyecto
     */
    sendUserAddedToProjectNotification(data) {
        const { projectData, newUser, addedBy } = data;
        return this.sendEmail('user_added_to_project', { projectData, newUser, addedBy });
    }

    /**
     * Notificación de tarea completada con reporte detallado
     */
    async sendTaskCompletedNotification(data) {
        const { projectData, completedTask, completerUser } = data;

        // Enriquecer la tarea con información adicional del proyecto
        const enrichedTask = { ...completedTask };

        // Buscar la fase de la tarea si no tiene phaseName
        if (!enrichedTask.phaseName && projectData.phases) {
            for (const phase of projectData.phases) {
                if (phase.tasks && phase.tasks.some(t => t.name === completedTask.name || t.id === completedTask.id)) {
                    enrichedTask.phaseName = phase.name || 'Sin fase';
                    break;
                }
            }
        }

        // Asegurar que tenga durationHours
        if (!enrichedTask.durationHours && enrichedTask.hours) {
            enrichedTask.durationHours = enrichedTask.hours;
        }

        // Obtener todos los usuarios autorizados del proyecto
        const recipients = await this.getProjectAuthorizedEmails(projectData.id);

        if (recipients.length === 0) {
            console.warn('⚠️ No hay usuarios autorizados para notificar');
            return;
        }

        // Generar reporte completo del proyecto
        const projectReport = await this.generateProjectReport(projectData);

        const emailData = {
            to: recipients,
            subject: `✅ Tarea Completada: ${enrichedTask.name} - ${projectData.projectName}`,
            html: this.generateTaskCompletedTemplate(projectData, enrichedTask, completerUser, projectReport),
            projectId: projectData.id,
            taskId: enrichedTask.id || enrichedTask.name, // Usar nombre si no hay ID
            userId: completerUser.uid || completerUser.id,
            taskData: enrichedTask,
            completerData: completerUser
        };

        return this.sendEmail('task_completed', emailData);
    }

    /**
     * Obtiene usuarios autorizados de un proyecto
     */
    async getProjectAuthorizedEmails(projectId) {
        try {
            const projectDoc = await this.db.collection('projects').doc(projectId).get();
            if (!projectDoc.exists) {
                throw new Error('Proyecto no encontrado');
            }

            const projectData = projectDoc.data();
            const authorizedUsers = projectData.authorizedUsers || [];

            console.log('🔍 authorizedUsers array:', authorizedUsers);
            console.log('🔍 authorizedUsers type:', typeof authorizedUsers);
            console.log('🔍 authorizedUsers length:', authorizedUsers.length);

            const emails = [];
            for (const user of authorizedUsers) {
                console.log('🔍 Processing user:', user, 'Type:', typeof user);

                // If user is an object with email, use it directly
                if (typeof user === 'object' && user && user.email) {
                    console.log('✅ Using email directly from user object:', user.email);
                    emails.push(user.email);
                    continue;
                }

                // If user is a string, treat it as user ID and look it up
                if (typeof user === 'string') {
                    console.log('🔍 Looking up user ID:', user);
                    try {
                        const userDoc = await this.db.collection('users').doc(user).get();
                        if (userDoc.exists) {
                            const userData = userDoc.data();
                            console.log('🔍 User data found:', userData);
                            if (userData.email) {
                                emails.push(userData.email);
                                console.log('✅ Added email from lookup:', userData.email);
                            } else {
                                console.warn('⚠️ User has no email:', user);
                            }
                        } else {
                            console.warn('⚠️ User document not found:', user);
                        }
                    } catch (lookupError) {
                        console.warn('⚠️ Error looking up user:', user, lookupError.message);
                    }
                    continue;
                }

                console.warn('⚠️ Invalid user format in authorizedUsers:', user);
            }

            const validEmails = emails.filter(email => this.validateEmail(email));
            console.log('✅ Final valid emails:', validEmails);

            return validEmails;
        } catch (error) {
            console.error('❌ Error obteniendo usuarios autorizados:', error);
            return [];
        }
    }

    /**
     * Genera reporte completo del proyecto
     */
    async generateProjectReport(projectData) {
        // Calcular métricas del proyecto
        const metrics = this.calculateProjectMetrics(projectData);

        // Calcular análisis de rendimiento (integrar con curva S)
        const performance = await this.calculatePerformanceAnalysis(projectData);

        // Resumen por fases
        const phasesSummary = this.generatePhasesSummary(projectData);

        // Detalle de tareas
        const tasksDetail = this.generateTasksDetail(projectData);

        return {
            metrics,
            performance,
            phasesSummary,
            tasksDetail
        };
    }

    /**
     * Calcula métricas principales del proyecto
     */
    calculateProjectMetrics(projectData) {
        let totalTasks = 0;
        let completedTasks = 0;
        let totalHours = 0;
        let completedHours = 0;

        const phases = projectData.phases || [];
        phases.forEach(phase => {
            const tasks = phase.tasks || [];
            totalTasks += tasks.length;
            tasks.forEach(task => {
                const hours = parseFloat(task.durationHours) || 0;
                totalHours += hours;
                if (task.completed) {
                    completedTasks++;
                    completedHours += hours;
                }
            });
        });

        const taskProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        const hourProgress = totalHours > 0 ? (completedHours / totalHours) * 100 : 0;

        // Calcular duración del proyecto
        const startDate = projectData.startDate ? new Date(projectData.startDate.toDate ? projectData.startDate.toDate() : projectData.startDate) : new Date();
        const endDate = projectData.endDate ? new Date(projectData.endDate.toDate ? projectData.endDate.toDate() : projectData.endDate) : new Date();
        const durationDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        const durationWeeks = Math.ceil(durationDays / 7);

        return {
            totalTasks,
            completedTasks,
            taskProgress: Math.round(taskProgress),
            totalHours: Math.round(totalHours),
            completedHours: Math.round(completedHours),
            hourProgress: Math.round(hourProgress),
            startDate,
            endDate,
            durationDays,
            durationWeeks,
            lastUpdate: projectData.lastUpdated || new Date()
        };
    }

    /**
     * Calcula análisis de rendimiento (SPI, etc.)
     */
    async calculatePerformanceAnalysis(projectData) {
        // Aquí se integraría con la lógica existente de curva S
        // Por ahora, valores simulados basados en métricas
        const metrics = this.calculateProjectMetrics(projectData);

        const spi = metrics.hourProgress > 0 ? (metrics.hourProgress / 100) : 0;
        const scheduleVariance = (spi - 1) * 100;

        let projectStatus = 'En Progreso';
        if (metrics.taskProgress === 100) {
            projectStatus = 'Completado';
        } else if (metrics.taskProgress > 75) {
            projectStatus = 'Avanzado';
        } else if (metrics.taskProgress < 25) {
            projectStatus = 'Inicio';
        }

        // Calcular semana actual del proyecto
        const startDate = metrics.startDate;
        const today = new Date();
        const currentWeek = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24 * 7));

        return {
            scheduleVariance: Math.round(scheduleVariance * 100) / 100,
            performanceIndex: Math.round(spi * 100) / 100,
            projectStatus,
            currentWeek: Math.max(1, currentWeek)
        };
    }

    /**
     * Genera resumen por fases
     */
    generatePhasesSummary(projectData) {
        const phases = projectData.phases || [];

        return phases.map((phase, index) => {
            let phaseTasks = 0;
            let phaseHours = 0;
            let phaseCompleted = 0;
            let phaseCompletedHours = 0;

            const tasks = phase.tasks || [];
            tasks.forEach(task => {
                const hours = parseFloat(task.durationHours) || 0;
                phaseTasks++;
                phaseHours += hours;
                if (task.completed) {
                    phaseCompleted++;
                    phaseCompletedHours += hours;
                }
            });

            const progress = phaseTasks > 0 ? Math.round((phaseCompleted / phaseTasks) * 100) : 0;

            return {
                number: index + 1,
                name: phase.name || `Fase ${index + 1}`,
                tasks: phaseTasks,
                hours: Math.round(phaseHours),
                progress
            };
        });
    }

    /**
     * Genera detalle de tareas
     */
    generateTasksDetail(projectData) {
        const phases = projectData.phases || [];
        const tasks = [];

        phases.forEach((phase, phaseIndex) => {
            const phaseTasks = phase.tasks || [];
            phaseTasks.forEach((task, taskIndex) => {
                tasks.push({
                    number: tasks.length + 1,
                    name: task.name || 'Sin nombre',
                    phase: phase.name || `Fase ${phaseIndex + 1}`,
                    type: task.milestone ? 'Hito' : 'Tarea',
                    hours: parseFloat(task.durationHours) || 0,
                    startDate: task.startDate ? new Date(task.startDate.toDate ? task.startDate.toDate() : task.startDate) : null,
                    endDate: task.endDate ? new Date(task.endDate.toDate ? task.endDate.toDate() : task.endDate) : null,
                    status: task.completed ? 'Completada' : 'Pendiente'
                });
            });
        });

        return tasks;
    }

    // ========== PLANTILLAS DE EMAIL ==========

    /**
     * Genera el HTML para la notificación de tarea completada
     */
    generateTaskCompletedTemplate(projectData, taskData, userData, reportData) {
        const { metrics, performance } = reportData;

        // Formatear fechas
        let completionDate = 'No especificada';
        if (taskData.completionDate) {
            const completionDateObj = new Date(taskData.completionDate.toDate ? taskData.completionDate.toDate() : taskData.completionDate);
            const datePart = completionDateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timePart = completionDateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            completionDate = `${datePart} a las ${timePart}`;
        }
        const projectStartDate = metrics.startDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
        const projectEndDate = metrics.endDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

        // Estilos en línea para máxima compatibilidad
        const styles = {
            body: `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f7; margin: 0; padding: 20px;`,
            container: `max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;`,
            header: `background-color: #003366; color: #ffffff; padding: 20px; text-align: center;`,
            headerTitle: `margin: 0; font-size: 24px;`,
            content: `padding: 25px 30px;`,
            sectionTitle: `font-size: 18px; color: #003366; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; margin-top: 20px; margin-bottom: 15px;`,
            paragraph: `font-size: 16px; color: #333333; line-height: 1.6;`,
            highlight: `font-weight: bold; color: #0056b3;`,
            table: `width: 100%; border-collapse: collapse; margin-top: 15px;`,
            th: `text-align: left; padding: 8px; background-color: #f2f2f2; border-bottom: 1px solid #dddddd; font-size: 14px; color: #555;`,
            td: `text-align: left; padding: 8px; border-bottom: 1px solid #dddddd; font-size: 14px;`,
            progressBarContainer: `background-color: #e0e0e0; border-radius: 5px; height: 20px; width: 100%; overflow: hidden; margin-top: 5px;`,
            progressBar: `background-color: #4CAF50; height: 100%; text-align: center; color: white; font-weight: bold; line-height: 20px;`,
            button: `display: inline-block; background-color: #007bff; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px; margin-top: 20px;`,
            footer: `text-align: center; padding: 20px; font-size: 12px; color: #888888;`
        };

        return `
            <div style="${styles.body}">
                <div style="${styles.container}">
                    <div style="${styles.header}">
                        <h1 style="${styles.headerTitle}">Proyecto: ${projectData.projectName}</h1>
                    </div>
                    <div style="${styles.content}">
                        <h2 style="${styles.sectionTitle}">Tarea Completada</h2>
                        <p style="${styles.paragraph}">
                            Se ha marcado como completada la tarea <span style="${styles.highlight}">${taskData.name}</span>.
                        </p>
                        <table style="${styles.table}">
                            <tr><th style="${styles.th}">Detalle</th><th style="${styles.th}">Información</th></tr>
                            <tr><td style="${styles.td}">Completada por:</td><td style="${styles.td}">${userData.displayName || userData.email}</td></tr>
                            <tr><td style="${styles.td}">Fecha de finalización:</td><td style="${styles.td}">${completionDate}</td></tr>
                            <tr><td style="${styles.td}">Fase:</td><td style="${styles.td}">${taskData.phaseName || 'No especificada'}</td></tr>
                            <tr><td style="${styles.td}">Horas estimadas:</td><td style="${styles.td}">${taskData.durationHours || 'N/A'}</td></tr>
                        </table>

                        <h2 style="${styles.sectionTitle}">Resumen del Proyecto</h2>
                        <table style="${styles.table}">
                            <tr><td style="${styles.td}">Progreso de Tareas:</td><td style="${styles.td}">
                                <div style="${styles.progressBarContainer}">
                                    <div style="${styles.progressBar} width: ${metrics.taskProgress}%;">${metrics.taskProgress}%</div>
                                </div>
                                (${metrics.completedTasks} de ${metrics.totalTasks} tareas)
                            </td></tr>
                            <tr><td style="${styles.td}">Progreso por Horas:</td><td style="${styles.td}">
                                <div style="${styles.progressBarContainer}">
                                    <div style="${styles.progressBar} width: ${metrics.hourProgress}%;">${metrics.hourProgress}%</div>
                                </div>
                                (${metrics.completedHours} de ${metrics.totalHours} horas)
                            </td></tr>
                            <tr><td style="${styles.td}">Estado General:</td><td style="${styles.td}">${performance.projectStatus}</td></tr>
                            <tr><td style="${styles.td}">Duración:</td><td style="${styles.td}">${projectStartDate} - ${projectEndDate} (${metrics.durationDays} días)</td></tr>
                        </table>

                        <div style="text-align: center;">
                            <a href="${window.location.origin}/vistaProyecto.html?id=${projectData.id}" style="${styles.button}">Ver Proyecto</a>
                        </div>
                    </div>
                    <div style="${styles.footer}">
                        Este es un correo generado automáticamente por el Sistema de Gestión de Proyectos PDT Futura.
                    </div>
                </div>
            </div>
        `;
    }


    // ========== MÉTODOS PÚBLICOS ==========

    /**
     * Notifica creación de nuevo usuario
     */
    notifyNewUser(userData) {
        this.sendNewUserNotification(userData).catch(err => console.error("Error en segundo plano al notificar nuevo usuario:", err));
    }

    /**
     * Notifica adición de usuario a proyecto
     */
    notifyUserAddedToProject(projectData, newUser, addedBy) {
        this.sendUserAddedToProjectNotification({ projectData, newUser, addedBy }).catch(err => console.error("Error en segundo plano al notificar usuario agregado:", err));
    }

    /**
     * Notifica tarea completada
     */
    notifyTaskCompleted(projectData, completedTask, completerUser) {
        // Enriquecer la tarea con la fecha de completado en el momento de la llamada
        const taskWithCompletionDate = {
            ...completedTask,
            completionDate: new Date()
        };
        this.sendTaskCompletedNotification({ projectData, completedTask: taskWithCompletionDate, completerUser }).catch(err => console.error("Error en segundo plano al notificar tarea completada:", err));
    }
}
// ========== INSTANCIA GLOBAL ===========

// La instancia global se creará cuando se importe el script
// Se debe inicializar con db desde el código que lo use
let NotificationServiceInstance = null;

function initializeNotificationService(dbInstance) {
    if (!NotificationServiceInstance) {
        NotificationServiceInstance = new NotificationService(dbInstance);
    }
    return NotificationServiceInstance;
}

// Exponer globalmente
window.NotificationService = NotificationService;
window.initializeNotificationService = initializeNotificationService;