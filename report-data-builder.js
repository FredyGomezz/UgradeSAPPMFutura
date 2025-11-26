/**
 * Módulo para procesar los datos crudos de un proyecto y transformarlos
 * en una estructura de datos lista para ser renderizada en un reporte.
 */
class ReportDataBuilder {
    constructor(projectData) {
        this.projectData = projectData;
        this.allTasks = this._getAllTasks();
    }

    /**
     * Construye el objeto de datos completo para el reporte.
     * @returns {object} - Un objeto con todas las métricas y datos procesados.
     */
    build() {
        const progressMetrics = this._calculateProgressMetrics();
        const advancedMetrics = this._calculateAdvancedMetrics();
        const highlights = this._getTaskHighlights();
        const phaseSummary = this._getPhaseSummary();

        return {
            projectName: this.projectData.projectName || 'Proyecto sin nombre',
            progressMetrics: progressMetrics,
            advancedMetrics: advancedMetrics,
            highlights: highlights,
            phaseSummary
        };
    }

    _getAllTasks() {
        const tasks = [];
        (this.projectData.phases || []).forEach(phase => {
            (phase.tasks || []).forEach(task => tasks.push({ ...task, phaseName: phase.name || phase.phaseName }));
        });
        return tasks.map(this._normalizeTask.bind(this));
    }

    _calculateProgressMetrics() {
        let totalTasks = this.allTasks.length;
        let completedTasks = 0;
        let totalHours = 0;
        let completedHours = 0;

        this.allTasks.forEach(task => {
            const hours = Number(task.durationHours) || 0;
            totalHours += hours;
            if (task.completed) {
                completedTasks++;
                completedHours += hours;
            }
        });

        const overallProgress = totalHours > 0 ? (completedHours / totalHours) * 100 : 0;

        return [
            { label: 'Avance', value: `${overallProgress.toFixed(0)}%` },
            { label: 'Total Tareas', value: totalTasks.toString() },
            { label: 'Total Horas', value: totalHours.toFixed(1) },
            { label: 'Tareas Completadas', value: completedTasks.toString() },
            { label: 'Horas Completadas', value: completedHours.toFixed(1) }
        ];
    }

    _calculateAdvancedMetrics() {
        if (this.allTasks.length === 0) {
            return { scheduleVariance: 'Sin tareas', performanceIndex: 'Sin tareas', projectStatus: 'Sin tareas' };
        }

        // Si todas las tareas están completadas, el proyecto está finalizado.
        if (this.allTasks.every(t => t.completed)) {
            return { scheduleVariance: 'Finalizado', performanceIndex: 'Finalizado', projectStatus: 'Finalizado' };
        }

        const now = new Date();

        // 1. Calcular el Valor Ganado (EV - Earned Value): Horas de tareas realmente completadas.
        const earnedValueHours = this.allTasks
            .filter(t => t.completed)
            .reduce((sum, t) => sum + (Number(t.durationHours) || 0), 0);

        // 2. Calcular el Valor Planificado (PV - Planned Value): Horas que deberían haberse completado hasta hoy.
        let plannedValueHours = 0;
        this.allTasks.forEach(task => {
            if (!task.startDate || !task.endDate || !task.durationHours) return;

            const taskStart = task.startDate;
            const taskEnd = task.endDate;
            const durationHours = Number(task.durationHours);

            if (now >= taskEnd) {
                // Si la tarea ya debería haber terminado, se cuenta el total de sus horas.
                plannedValueHours += durationHours;
            } else if (now > taskStart) {
                // Si estamos a mitad de la tarea, se calcula la porción de horas planificadas.
                const totalDurationMillis = taskEnd.getTime() - taskStart.getTime();
                const elapsedMillis = now.getTime() - taskStart.getTime();
                const plannedPortion = (elapsedMillis / totalDurationMillis) * durationHours;
                plannedValueHours += plannedPortion;
            }
            // Si la tarea aún no ha comenzado, no se suma nada al PV.
        });

        // 3. Calcular las métricas
        const scheduleVarianceHours = earnedValueHours - plannedValueHours;
        const spi = (plannedValueHours > 0) ? (earnedValueHours / plannedValueHours) : 1; // Si no se ha planificado nada, SPI es 1.

        // 4. Determinar los textos para el reporte
        let svText, spiText, projectStatus;

        // Umbrales para la clasificación del estado
        const totalHours = this.allTasks.reduce((sum, t) => sum + (Number(t.durationHours) || 0), 0);
        const aheadThreshold = totalHours * 0.05; // 5% del total de horas
        const behindThreshold = totalHours * -0.05;

        if (scheduleVarianceHours > aheadThreshold) {
            svText = `Adelantado (+${scheduleVarianceHours.toFixed(0)}h)`;
            projectStatus = 'Adelantado';
        } else if (scheduleVarianceHours < behindThreshold) {
            svText = `Atrasado (${scheduleVarianceHours.toFixed(0)}h)`;
            projectStatus = 'Atrasado';
        } else {
            svText = 'En Tiempo (0h)';
            projectStatus = 'En Tiempo';
        }

        if (spi > 1.05) {
            // Si estamos adelantados, el SPI es una medida de eficiencia.
            const efficiency = ((spi - 1) * 100).toFixed(0);
            spiText = `Eficiente (+${efficiency}%) (SPI: ${spi.toFixed(2)})`;
        } else if (spi < 0.95) {
            const efficiency = ((1 - spi) * 100).toFixed(0);
            spiText = `Ineficiente (-${efficiency}%) (SPI: ${spi.toFixed(2)})`;
        } else if (spi < 0.95) {
            spiText = `Bajo (SPI: ${spi.toFixed(2)})`;
        } else {
            spiText = `Normal (SPI: ${spi.toFixed(2)})`;
        }

        // Caso especial: si el proyecto aún no ha comenzado formalmente.
        const projectStartDate = this.allTasks.reduce((min, t) => (t.startDate && t.startDate < min) ? t.startDate : min, new Date());
        if (now < projectStartDate && earnedValueHours === 0) {
            return { scheduleVariance: 'No iniciado', performanceIndex: 'No iniciado', projectStatus: 'No iniciado' };
        }

        return { scheduleVariance: svText, performanceIndex: spiText, projectStatus: projectStatus };
    }

    /**
     * Devuelve las métricas avanzadas calculadas.
     * @returns {object} - Un objeto con scheduleVariance, performanceIndex y projectStatus.
     */
    getAdvancedMetrics() {
        return this._calculateAdvancedMetrics();
    }

    _getTaskHighlights() {
        const sortedTasks = this.allTasks
            .filter(t => t.startDate)
            .sort((a, b) => a.startDate - b.startDate);
        
        const completedTasks = sortedTasks
            .filter(t => t.completed && t.completedAt)
            .sort((a, b) => b.completedAt - a.completedAt);

        let currentTask = sortedTasks.find(t => !t.completed) || null;
        if (currentTask && currentTask.startDate) {
            const now = new Date();
            // Solo calcular si la tarea ya ha comenzado
            if (now > currentTask.startDate) {
                const timeElapsedMillis = now.getTime() - currentTask.startDate.getTime();
                const totalDurationMillis = currentTask.endDate.getTime() - currentTask.startDate.getTime();
                
                if (totalDurationMillis > 0) {
                    const progressPercentage = Math.min(timeElapsedMillis / totalDurationMillis, 1); // No puede ser más del 100%
                    const hoursInProgress = progressPercentage * (Number(currentTask.durationHours) || 0);
                    currentTask.hoursInProgress = hoursInProgress.toFixed(1);
                }
            }
        }
        let lastCompletedTask = completedTasks.length > 0 ? completedTasks[0] : null;
        if (lastCompletedTask) {
            const isOnTime = lastCompletedTask.completedAt <= lastCompletedTask.endDate;
            lastCompletedTask.onTimeStatus = {
                text: isOnTime ? 'Cierre Oportuno' : 'Cerrada con Retraso',
                color: isOnTime ? 'green' : 'red' // Usaremos estos colores en el drawer
            };
        }


        const recentCompletedTasks = completedTasks.slice(0, 3); // Obtener las últimas 3
        const nextMilestone = sortedTasks.find(t => (t.isMilestone || t.esHito) && !t.completed);

        return { currentTask, lastCompletedTask, nextMilestone, recentCompletedTasks };
    }

    _getPhaseSummary() {
        return (this.projectData.phases || []).map(phase => {
            const tasks = phase.tasks || [];
            const totalTasks = tasks.length;
            const totalHours = tasks.reduce((sum, task) => sum + (Number(task.durationHours) || 0), 0);
            
            let completedHours = 0;
            (tasks || []).forEach(task => {
                if (task.completed) {
                    completedHours += Number(task.durationHours) || 0;
                }
            });
            const phaseProgress = totalHours > 0 ? (completedHours / totalHours) * 100 : 0;

            return [
                phase.name || phase.phaseName || 'Fase sin nombre',
                totalTasks,
                Math.round(totalHours),
                `${phaseProgress.toFixed(0)}%`
            ];
        });
    }

    _normalizeTask(raw) {
        return { ...raw, startDate: this._parseDate(raw.startDate), endDate: this._parseDate(raw.endDate), completedAt: this._parseDate(raw.completedAt) };
    }

    _parseDate(dateValue) {
        if (!dateValue) return null;
        if (dateValue instanceof Date) return dateValue;
        if (typeof dateValue.toDate === 'function') return dateValue.toDate();
        const d = new Date(dateValue);
        return isNaN(d.getTime()) ? null : d;
    }
}

// Asegúrate de incluir este script en tu HTML antes de pdf-generator.js
// <script src="report-data-builder.js"></script>