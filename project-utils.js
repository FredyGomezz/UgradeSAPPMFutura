/**
 * project-utils.js
 * 
 * Contiene funciones de utilidad compartidas entre diferentes vistas del proyecto,
 * como el cálculo de la Curva S y la normalización de datos.
 */

/**
 * Normaliza una tarea para asegurar que las fechas sean objetos Date.
 * @param {object} raw - La tarea cruda desde Firestore.
 * @returns {object} - La tarea con fechas normalizadas.
 */
window.parseDate = function(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return dateValue;
    if (typeof dateValue.toDate === 'function') return dateValue.toDate(); // Maneja Timestamps de Firestore
    const d = new Date(dateValue);
    return isNaN(d.getTime()) ? null : d;
};

/**
 * Normaliza una tarea para asegurar que las fechas sean objetos Date.
 * @param {object} raw - La tarea cruda desde Firestore.
 * @returns {object} - La tarea con fechas normalizadas.
 */
window.normalizeTask = function(raw) {
    const startDate = window.parseDate(raw.startDate);
    const endDate = window.parseDate(raw.endDate);
    const completedAt = window.parseDate(raw.completedAt);
    const startTime = typeof raw.startTime === 'string' && /^\d{2}:\d{2}$/.test(raw.startTime) ? raw.startTime : '--:--';
    const endTime = typeof raw.endTime === 'string' && /^\d{2}:\d{2}$/.test(raw.endTime) ? raw.endTime : '--:--';
    return {
        ...raw,
        startDate,
        endDate,
        completedAt,
        startTime,
        endTime
    };
}

/**
 * Formatea un objeto Date a un string 'yyyy-MM-dd'.
 * @param {Date} date - El objeto Date a formatear.
 * @returns {string} - La fecha formateada.
 */
window.formatDateForInput = function(date) {
    if (!date) return '';
    if (typeof date.toDate === 'function') date = date.toDate();
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Calcula los datos para la Curva S (Planificado vs Real).
 * @param {object} data - El objeto de datos del proyecto.
 * @returns {object} - Un objeto con todos los datos necesarios para la gráfica.
 */
window.calculateSCurveData = function(data) {
    console.log("--- Iniciando cálculo de Curva S (v3.0 - Distribución Diaria) ---");

    // 1. Normalizar y recopilar todas las tareas
    const allTasks = data.phases?.flatMap(phase => (phase.tasks || []).map(normalizeTask)) || [];

    if (allTasks.length === 0) {
        console.warn("No se encontraron tareas. La Curva S estará vacía.");
        return { tasks: [], dateLabels: [], plannedPercent: [], actualPercent: [], totalHours: 0 };
    }

    // 2. Determinar el rango de fechas del proyecto a partir de las tareas
    let projectStart = null;
    let projectEnd = null;
    allTasks.forEach(task => {
        if (task.startDate && (!projectStart || task.startDate < projectStart)) {
            projectStart = task.startDate;
        }
        if (task.endDate && (!projectEnd || task.endDate > projectEnd)) {
            projectEnd = task.endDate;
        }
    });

    if (!projectStart || !projectEnd) {
        console.error("No se pudo determinar el rango de fechas del proyecto a partir de las tareas.");
        return { tasks: allTasks, dateLabels: [], plannedPercent: [], actualPercent: [], totalHours: 0 };
    }

    // Asegurarse de que projectStart y projectEnd sean objetos Date válidos y a medianoche
    projectStart = new Date(projectStart.getFullYear(), projectStart.getMonth(), projectStart.getDate());
    projectEnd = new Date(projectEnd.getFullYear(), projectEnd.getMonth(), projectEnd.getDate());

    // 3. Generar el eje de tiempo (etiquetas de fecha)
    const dateLabels = [];
    let currentDate = new Date(projectStart);
    while (currentDate <= projectEnd) {
        dateLabels.push(formatDateForInput(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // 4. Calcular el total de horas del proyecto
    const totalHours = allTasks.reduce((sum, t) => sum + (parseFloat(t.durationHours) || 0), 0);
    if (totalHours === 0) {
        console.warn("El total de horas del proyecto es 0. La Curva S estará vacía.");
        return { tasks: allTasks, dateLabels, plannedPercent: Array(dateLabels.length).fill(0), actualPercent: Array(dateLabels.length).fill(0), totalHours: 0 };
    }

    // 5. Distribuir horas planificadas y reales por día
    const dailyPlannedHours = {};
    const dailyActualHours = {};

    allTasks.forEach(task => {
        const durationHours = parseFloat(task.durationHours) || 0; // Line 107
        if (durationHours === 0) return;

        // Distribución de horas planificadas
        if (task.startDate && task.endDate) {
            // Asegurarse de que startDate y endDate sean objetos Date válidos en este punto.
            const safeStartDate = window.parseDate(task.startDate);
            const safeEndDate = window.parseDate(task.endDate);
            if (!safeStartDate || !safeEndDate) return; // Saltar si alguna fecha es inválida
            const taskStartDate = new Date(safeStartDate.getFullYear(), safeStartDate.getMonth(), safeStartDate.getDate());
            const taskEndDate = new Date(safeEndDate.getFullYear(), safeEndDate.getMonth(), safeEndDate.getDate());
            
            let daysInTask = 0;
            let d = new Date(taskStartDate);
            while (d <= taskEndDate) {
                daysInTask++;
                d.setDate(d.getDate() + 1);
            }

            const hoursPerDay = daysInTask > 0 ? durationHours / daysInTask : 0;

            d = new Date(taskStartDate);
            while (d <= taskEndDate) {
                const dateStr = formatDateForInput(d);
                dailyPlannedHours[dateStr] = (dailyPlannedHours[dateStr] || 0) + hoursPerDay;
                d.setDate(d.getDate() + 1);
            }
        }

        // Distribución de horas reales (en la fecha de completado)
        if (task.completed && task.completedAt) {
            // Asegurarse de que task.completedAt sea un objeto Date válido en este punto.
            const safeCompletedAt = window.parseDate(task.completedAt);
            if (!safeCompletedAt) return; // Saltar si la fecha es inválida
            const completedAtDate = new Date(safeCompletedAt.getFullYear(), safeCompletedAt.getMonth(), safeCompletedAt.getDate());
            const dateStr = formatDateForInput(completedAtDate);
            dailyActualHours[dateStr] = (dailyActualHours[dateStr] || 0) + durationHours;
        }
    });

    // 6. Calcular porcentajes acumulados
    let cumulativePlanned = 0;
    let cumulativeActual = 0;
    const plannedPercent = [];
    const actualPercent = [];

    dateLabels.forEach(dateStr => {
        cumulativePlanned += (dailyPlannedHours[dateStr] || 0);
        cumulativeActual += (dailyActualHours[dateStr] || 0);

        plannedPercent.push(parseFloat(((cumulativePlanned / totalHours) * 100).toFixed(4)));
        actualPercent.push(parseFloat(((cumulativeActual / totalHours) * 100).toFixed(4)));
    });
    
    console.log(`--- Cálculo de Curva S finalizado (v3.0) ---`);
    console.log(`Rango de fechas: ${dateLabels[0]} a ${dateLabels[dateLabels.length - 1]}`);
    console.log(`Total de horas: ${totalHours}`);
    console.log(`Puntos de datos generados: ${dateLabels.length}`);
    console.log(`% Planificado final: ${plannedPercent[plannedPercent.length - 1]}`);
    console.log(`% Real final: ${actualPercent[actualPercent.length - 1]}`);

    return { tasks: allTasks, dateLabels, plannedPercent, actualPercent, totalHours };
}