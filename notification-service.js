// =========== SERVICIO CENTRALIZADO DE NOTIFICACIONES ===========
// Archivo: notification-service.js
// Sistema de notificaciones vía Backend API REST (simplificado)

class NotificationService {
    constructor(dbInstance = null) {
        this.db = dbInstance;
        this.backendUrl = 'http://192.168.0.104:3001';
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
    sendTaskCompletedNotification(data) {
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
            subject: `✅ Tarea Completada: ${enrichedTask.name} - ${projectData.name}`,
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
        this.sendTaskCompletedNotification({ projectData, completedTask, completerUser }).catch(err => console.error("Error en segundo plano al notificar tarea completada:", err));
    }

    /**
     * Obtiene estadísticas del servicio
     */

    getStats() {
        return {
            queueLength: this.notificationQueue.length,
            isProcessing: this.isProcessing
        };
    }
}

// ========== TEMPLATES HTML ==========

NotificationService.prototype.generateNewUserTemplate = function(userData) {
    const registrationDate = new Date().toLocaleString('es-ES');

    return `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">🆕 Nuevo Usuario Registrado</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Sistema PDT Futura</p>
            </div>

            <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h2 style="color: #495057; margin-bottom: 20px;">Datos del Nuevo Usuario</h2>

                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; font-weight: bold; width: 150px;">Nombre:</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">${userData.displayName || 'No especificado'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; font-weight: bold;">Email:</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">${userData.email}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; font-weight: bold;">Contraseña:</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; color: #dc3545; font-weight: bold;">${userData.password || 'No disponible'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; font-weight: bold;">Fecha de Registro:</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">${registrationDate}</td>
                    </tr>
                </table>

                <div style="background: #e7f3ff; border: 1px solid #b3d7ff; border-radius: 5px; padding: 15px; margin-top: 20px;">
                    <p style="margin: 0; color: #004085; font-weight: bold;">💡 Acción requerida:</p>
                    <p style="margin: 5px 0 0 0; color: #004085;">Verificar la información del usuario y confirmar su acceso al sistema.</p>
                </div>
            </div>
        </div>
    `;
};

NotificationService.prototype.generateUserAddedTemplate = function(projectData, newUser, addedBy) {
    const additionDate = new Date().toLocaleString('es-ES');

    return `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
            <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">👥 Nuevo Usuario en Proyecto</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Sistema PDT Futura</p>
            </div>

            <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h2 style="color: #495057; margin-bottom: 20px;">Usuario Agregado al Proyecto</h2>

                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h3 style="color: #495057; margin-bottom: 15px;">📋 Información del Proyecto</h3>
                    <p style="margin: 5px 0;"><strong>Proyecto:</strong> ${projectData.name || 'Sin nombre'}</p>
                    <p style="margin: 5px 0;"><strong>Fecha de Incorporación:</strong> ${additionDate}</p>
                </div>

                <div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h3 style="color: #004085; margin-bottom: 15px;">👤 Nuevo Usuario Autorizado</h3>
                    <p style="margin: 5px 0;"><strong>Nombre:</strong> ${newUser.displayName || newUser.name || 'No especificado'}</p>
                    <p style="margin: 5px 0;"><strong>Email:</strong> ${newUser.email}</p>
                    <p style="margin: 5px 0;"><strong>Rol:</strong> ${newUser.role || 'Usuario'}</p>
                </div>

                <div style="background: #fff3cd; padding: 20px; border-radius: 8px;">
                    <h3 style="color: #856404; margin-bottom: 15px;">👨‍💼 Agregado por</h3>
                    <p style="margin: 5px 0;"><strong>Nombre:</strong> ${addedBy.displayName || addedBy.name || 'Sistema'}</p>
                    <p style="margin: 5px 0;"><strong>Email:</strong> ${addedBy.email}</p>
                </div>
            </div>
        </div>
    `;
};

NotificationService.prototype.generateTaskCompletedTemplate = function(projectData, completedTask, completerUser, projectReport) {
    const completionDate = new Date().toLocaleString('es-ES');
    const { metrics, performance, phasesSummary, tasksDetail } = projectReport;

    return `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">📊 Resumen del Proyecto</h1>
                <h2 style="margin: 10px 0; font-size: 20px; opacity: 0.9;">${projectData.name || 'Proyecto sin nombre'}</h2>
                <p style="margin: 5px 0 0 0; opacity: 0.8;">Sistema PDT Futura - Gestión de Proyectos</p>
                <p style="margin: 10px 0 0 0; font-size: 14px;">Reporte generado: ${completionDate}</p>
            </div>

            <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">

                <!-- TAREA COMPLETADA -->
                <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                    <h2 style="color: #155724; margin-bottom: 15px;">✅ Tarea Completada</h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; width: 150px;">Tarea:</td>
                            <td style="padding: 8px 0;">${completedTask.name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Fase:</td>
                            <td style="padding: 8px 0;">${completedTask.phaseName || 'Sin fase'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Horas:</td>
                            <td style="padding: 8px 0;">${completedTask.durationHours || completedTask.hours || 0} horas</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Completada por:</td>
                            <td style="padding: 8px 0;">${completerUser.displayName || completerUser.email}</td>
                        </tr>
                    </table>
                </div>

                <!-- INFORMACIÓN DEL PROYECTO -->
                <div style="margin-bottom: 30px;">
                    <h2 style="color: #495057; border-bottom: 2px solid #007bff; padding-bottom: 10px;">📋 Información del Proyecto</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <strong>Fecha de Inicio:</strong><br>${metrics.startDate.toLocaleDateString('es-ES')}
                        </div>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <strong>Fecha de Fin Estimada:</strong><br>${metrics.endDate.toLocaleDateString('es-ES')}
                        </div>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <strong>Duración Total:</strong><br>${metrics.durationDays} días (${metrics.durationWeeks} semanas)
                        </div>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <strong>Última Actualización:</strong><br>${metrics.lastUpdate.toLocaleString('es-ES')}
                        </div>
                    </div>
                </div>

                <!-- MÉTRICAS PRINCIPALES -->
                <div style="margin-bottom: 30px;">
                    <h2 style="color: #495057; border-bottom: 2px solid #28a745; padding-bottom: 10px;">📈 Métricas Principales</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 15px;">
                        <div style="background: #e7f3ff; padding: 15px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: #007bff;">${metrics.totalTasks}</div>
                            <div style="font-size: 12px; color: #004085;">Total de Tareas</div>
                        </div>
                        <div style="background: #d4edda; padding: 15px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: #28a745;">${metrics.completedTasks}</div>
                            <div style="font-size: 12px; color: #155724;">Tareas Completadas</div>
                        </div>
                        <div style="background: #fff3cd; padding: 15px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: #856404;">${metrics.taskProgress}%</div>
                            <div style="font-size: 12px; color: #856404;">Progreso de Tareas</div>
                        </div>
                        <div style="background: #e7f3ff; padding: 15px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: #007bff;">${metrics.totalHours}h</div>
                            <div style="font-size: 12px; color: #004085;">Total de Horas</div>
                        </div>
                        <div style="background: #d4edda; padding: 15px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: #28a745;">${metrics.completedHours}h</div>
                            <div style="font-size: 12px; color: #155724;">Horas Completadas</div>
                        </div>
                        <div style="background: #fff3cd; padding: 15px; border-radius: 5px; text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: #856404;">${metrics.hourProgress}%</div>
                            <div style="font-size: 12px; color: #856404;">Progreso de Horas</div>
                        </div>
                    </div>
                </div>

                <!-- ANÁLISIS DE RENDIMIENTO -->
                <div style="margin-bottom: 30px;">
                    <h2 style="color: #495057; border-bottom: 2px solid #6f42c1; padding-bottom: 10px;">🎯 Análisis de Rendimiento</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
                        <div style="background: ${performance.scheduleVariance >= 0 ? '#d4edda' : '#f8d7da'}; padding: 15px; border-radius: 5px;">
                            <strong>Variación del Cronograma:</strong><br>
                            <span style="font-size: 18px; font-weight: bold;">${performance.scheduleVariance}%</span>
                        </div>
                        <div style="background: ${performance.performanceIndex >= 1 ? '#d4edda' : '#f8d7da'}; padding: 15px; border-radius: 5px;">
                            <strong>Índice de Rendimiento (SPI):</strong><br>
                            <span style="font-size: 18px; font-weight: bold;">${performance.performanceIndex}</span>
                        </div>
                        <div style="background: #e7f3ff; padding: 15px; border-radius: 5px;">
                            <strong>Estado del Proyecto:</strong><br>
                            <span style="font-size: 18px; font-weight: bold; color: #007bff;">${performance.projectStatus}</span>
                        </div>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <strong>Semana Actual:</strong><br>
                            <span style="font-size: 18px; font-weight: bold;">${performance.currentWeek}</span>
                        </div>
                    </div>
                </div>

                <!-- RESUMEN POR FASES -->
                <div style="margin-bottom: 30px;">
                    <h2 style="color: #495057; border-bottom: 2px solid #fd7e14; padding-bottom: 10px;">📊 Resumen por Fases</h2>
                    <div style="overflow-x: auto; margin-top: 15px;">
                        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                            <thead>
                                <tr style="background: #f8f9fa;">
                                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">#</th>
                                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">Nombre de la Fase</th>
                                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">Tareas</th>
                                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">Horas</th>
                                    <th style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">Progreso</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${phasesSummary.map(phase => `
                                    <tr>
                                        <td style="padding: 10px; border: 1px solid #dee2e6;">${phase.number}</td>
                                        <td style="padding: 10px; border: 1px solid #dee2e6;">${phase.name}</td>
                                        <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">${phase.tasks}</td>
                                        <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">${phase.hours}h</td>
                                        <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">
                                            <div style="background: ${phase.progress === 100 ? '#d4edda' : phase.progress > 50 ? '#fff3cd' : '#f8d7da'}; padding: 4px 8px; border-radius: 3px; display: inline-block;">
                                                ${phase.progress}%
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- DIAGRAMA DE GANTT -->
                <div style="margin-bottom: 30px;">
                    <h2 style="color: #495057; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">📅 Diagrama de Gantt</h2>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 15px;">
                        <div style="font-family: monospace; font-size: 12px; line-height: 1.4;">
                            <div style="margin-bottom: 10px;"><strong>Línea de tiempo del proyecto:</strong></div>
                            ${generateGanttChart(projectData)}
                        </div>
                    </div>
                </div>
                    <div style="overflow-x: auto; margin-top: 15px;">
                        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                            <thead>
                                <tr style="background: #f8f9fa;">
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: left;">#</th>
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: left;">Nombre de la Tarea</th>
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">Tipo</th>
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">Horas</th>
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">Inicio</th>
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">Fin</th>
                                    <th style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tasksDetail.map(task => `
                                    <tr style="background: ${task.status === 'Completada' ? '#f8fff8' : 'white'};">
                                        <td style="padding: 8px; border: 1px solid #dee2e6;">${task.number}</td>
                                        <td style="padding: 8px; border: 1px solid #dee2e6;">${task.name}</td>
                                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                                            <span style="background: ${task.type === 'Hito' ? '#e74c3c' : '#3498db'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">
                                                ${task.type}
                                            </span>
                                        </td>
                                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">${task.hours}h</td>
                                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                                            ${task.startDate ? task.startDate.toLocaleDateString('es-ES') : '--'}
                                        </td>
                                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                                            ${task.endDate ? task.endDate.toLocaleDateString('es-ES') : '--'}
                                        </td>
                                        <td style="padding: 8px; border: 1px solid #dee2e6; text-align: center;">
                                            <span style="background: ${task.status === 'Completada' ? '#28a745' : '#ffc107'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">
                                                ${task.status}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- PIE DE PÁGINA -->
                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                    <p style="color: #6c757d; font-size: 14px;">
                        Este es un reporte automático generado por el Sistema PDT Futura<br>
                        Para más detalles, accede a la plataforma del proyecto.
                    </p>
                </div>
            </div>
        </div>
    `;
};

// ========== FUNCIONES AUXILIARES ==========

function generateGanttChart(projectData) {
    if (!projectData.phases || !Array.isArray(projectData.phases)) {
        return '<div>No hay datos de fases disponibles</div>';
    }

    const projectStart = projectData.startDate ? new Date(projectData.startDate.toDate ? projectData.startDate.toDate() : projectData.startDate) : new Date();
    const projectEnd = projectData.phases.reduce((end, phase) => {
        if (phase.tasks && phase.tasks.length > 0) {
            const lastTask = phase.tasks[phase.tasks.length - 1];
            const taskEnd = lastTask.endDate ? new Date(lastTask.endDate.toDate ? lastTask.endDate.toDate() : lastTask.endDate) : end;
            return taskEnd > end ? taskEnd : end;
        }
        return end;
    }, projectStart);

    const totalDays = Math.ceil((projectEnd - projectStart) / (1000 * 60 * 60 * 24));
    const chartWidth = Math.min(60, Math.max(30, totalDays)); // Ancho adaptable del gráfico

    let ganttHtml = '<div style="font-family: monospace; font-size: 11px;">';

    projectData.phases.forEach((phase, phaseIndex) => {
        if (!phase.tasks || !Array.isArray(phase.tasks)) return;

        ganttHtml += `<div style="margin-bottom: 8px;"><strong>${phase.name || `Fase ${phaseIndex + 1}`}</strong></div>`;

        phase.tasks.forEach((task, taskIndex) => {
            const taskStart = task.startDate ? new Date(task.startDate.toDate ? task.startDate.toDate() : task.startDate) : projectStart;
            const taskEnd = task.endDate ? new Date(task.endDate.toDate ? task.endDate.toDate() : task.endDate) : taskStart;

            const startOffset = Math.max(0, Math.floor((taskStart - projectStart) / (1000 * 60 * 60 * 24)));
            const duration = Math.max(1, Math.ceil((taskEnd - taskStart) / (1000 * 60 * 60 * 24)) + 1);

            const barStart = Math.floor((startOffset / totalDays) * chartWidth);
            const barWidth = Math.max(1, Math.floor((duration / totalDays) * chartWidth));

            let bar = '';
            for (let i = 0; i < chartWidth; i++) {
                if (i >= barStart && i < barStart + barWidth) {
                    bar += task.completed ? '█' : '░';
                } else {
                    bar += '─';
                }
            }

            const status = task.completed ? '✅' : '⏳';
            const taskName = `${status} ${task.name || `Tarea ${taskIndex + 1}`}`.substring(0, 20);

            ganttHtml += `<div style="margin-left: 10px; margin-bottom: 2px;">${taskName.padEnd(22)} ${bar}</div>`;
        });

        ganttHtml += '<div style="margin-bottom: 10px;"></div>';
    });

    ganttHtml += '</div>';
    return ganttHtml;
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