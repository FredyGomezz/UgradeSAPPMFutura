// Las instancias de 'firebase', 'auth' y 'db' ahora se asumen
// que están disponibles globalmente gracias a firebase-init.js

// const db = firebase.firestore(); // Eliminado para evitar redeclaración

// Inicializar servicio de notificaciones
const notificationService = initializeNotificationService(db);

// Función para obtener el rol del usuario actual
async function getCurrentUserRole() {
    try {
        const user = firebase.auth().currentUser;
        if (!user) return null;

        // Verificar si es el usuario admin por defecto
        if (user.email === 'admin@gnce.com') {
            return 'admin';
        }

        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            return userDoc.data().role || 'user';
        }
        return 'user'; // Rol por defecto si no se encuentra
    } catch (error) {
        console.error('Error obteniendo rol del usuario:', error);
        return 'user'; // Rol por defecto en caso de error
    }
}

// Función mejorada para cargar la configuración del proyecto
async function loadProjectConfig(data) {
    console.log('Cargando configuración del proyecto:', data);
    
    // Obtener el rol del usuario actual
    const userRole = await getCurrentUserRole();
    const isAdmin = userRole === 'admin';
    
    // Cargar fecha de inicio
    if (data.startDate) {
        const startDate = data.startDate && typeof data.startDate.toDate === 'function' ? 
            data.startDate.toDate() : new Date(data.startDate);
        const startDateInput = document.getElementById('start-date-input');
        const projectStartDate = document.getElementById('project-start-date');
        if (startDateInput) {
            startDateInput.valueAsDate = startDate;
            startDateInput.disabled = !isAdmin; // Solo admin puede modificar
        }
        if (projectStartDate) projectStartDate.textContent = safeDateFormatForDisplay(startDate);
    }

    // Cargar configuración de días laborables
    const includeSaturdays = document.getElementById('include-saturdays');
    const includeSundays = document.getElementById('include-sundays');
    const includeHolidays = document.getElementById('include-holidays');
    if (includeSaturdays) {
        includeSaturdays.checked = data.includeSaturdays !== undefined ? !data.includeSaturdays : false;
        includeSaturdays.disabled = !isAdmin; // Solo admin puede modificar
    }
    if (includeSundays) {
        includeSundays.checked = data.includeSundays !== undefined ? !data.includeSundays : false;
        includeSundays.disabled = !isAdmin; // Solo admin puede modificar
    }
    if (includeHolidays) {
        includeHolidays.checked = data.includeHolidays !== undefined ? data.includeHolidays : true;
        includeHolidays.disabled = !isAdmin; // Solo admin puede modificar
    }

    // Cargar configuración del turno
    const shiftStartTime = document.getElementById('shift-start-time');
    const shiftEndTime = document.getElementById('shift-end-time');
    const shiftBreakStartTime = document.getElementById('shift-break-start-time');
    const shiftBreakHours = document.getElementById('shift-break-hours');
    if (shiftStartTime) {
        shiftStartTime.value = data.shiftStartTime || '08:00';
        shiftStartTime.disabled = !isAdmin; // Solo admin puede modificar
    }
    if (shiftEndTime) {
        shiftEndTime.value = data.shiftEndTime || '17:00';
        shiftEndTime.disabled = !isAdmin; // Solo admin puede modificar
    }
    if (shiftBreakStartTime) {
        shiftBreakStartTime.value = data.shiftBreakStartTime || '12:00';
        shiftBreakStartTime.disabled = !isAdmin; // Solo admin puede modificar
    }
    if (shiftBreakHours) {
        shiftBreakHours.value = data.shiftBreakHours !== undefined ? data.shiftBreakHours : 1;
        shiftBreakHours.disabled = !isAdmin; // Solo admin puede modificar
    }

    // Cargar festivos
    const holidays = sanitizeHolidays((data.settings && data.settings.holidays) || data.holidays || []);
    loadHolidays(holidays, isAdmin); // Pasar el rol para deshabilitar edición
    // Mantener consistencia
    data.holidays = holidays;

// Mostrar/ocultar lista de festivos según el checkbox
toggleHolidaysList();
}

// Función mejorada para formatear fechas de manera segura
function safeDateFormatForDisplay(dateValue) {
    if (!dateValue) return '--';
    
    try {
        let date;
        if (typeof dateValue.toDate === 'function') {
            // Es un Timestamp de Firestore
            date = dateValue.toDate();
        } else {
            // Es una cadena o número
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime())) {
            console.warn('Fecha inválida:', dateValue);
            return '--';
        }
        
        return date.toLocaleDateString('es-ES');
    } catch (error) {
        console.warn('Error formateando fecha:', dateValue, error);
        return '--';
    }
}

// Función mejorada para formatear fechas con horas
function safeDateTimeFormatForDisplay(dateValue) {
    if (!dateValue) return '--';
    
    try {
        let date;
        if (typeof dateValue.toDate === 'function') {
            // Es un Timestamp de Firestore
            date = dateValue.toDate();
        } else {
            // Es una cadena o número
            date = new Date(dateValue);
        }
        
        if (isNaN(date.getTime())) {
            console.warn('Fecha inválida:', dateValue);
            return '--';
        }
        
        return date.toLocaleString('es-ES');
    } catch (error) {
        console.warn('Error formateando fecha y hora:', dateValue, error);
        return '--';
    }
}

// Función mejorada para cargar festivos
function loadHolidays(holidays, isAdmin = true) {
// Solo gestiona la visualización y edición de festivos
const container = document.getElementById('holidays-container');
if (!container) {
    console.error('No se encontró el contenedor de festivos');
    return;
}
container.innerHTML = '';
if (!holidays || !Array.isArray(holidays)) {
    console.log('No hay festivos o el formato es inválido');
    return;
}
console.log('Cargando festivos:', holidays);
    holidays.forEach((holiday, index) => {
        let dateValue = formatDateForInput(holiday.date);    const holidayName = holiday.name || '';
    const holidayItem = document.createElement('div');
    holidayItem.className = 'holiday-item';

    // Crear input date
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = dateValue;
    dateInput.setAttribute('data-index', index);
    dateInput.disabled = !isAdmin; // Solo admin puede editar

    // Crear input text
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.placeholder = 'Nombre del festivo';
    textInput.value = holidayName.replace(/"/g, '&quot;');
    textInput.setAttribute('data-index', index);
    textInput.disabled = !isAdmin; // Solo admin puede editar

    // Crear botón (solo visible para admin)
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Eliminar';
    button.onclick = () => removeHolidayItem(button);
    if (!isAdmin) {
        button.style.display = 'none'; // Ocultar botón para usuarios regulares
    }

    // Agregar elementos al contenedor
    holidayItem.appendChild(dateInput);
    holidayItem.appendChild(textInput);
    holidayItem.appendChild(button);
    container.appendChild(holidayItem);
});
}

// Función para mostrar/ocultar la lista de festivos
function toggleHolidaysList() {
    const includeHolidaysCheckbox = document.getElementById('include-holidays');
    const holidaysList = document.getElementById('holidays-list');
    
    if (includeHolidaysCheckbox && holidaysList) {
        // Mostrar u ocultar según el estado del checkbox
        holidaysList.style.display = includeHolidaysCheckbox.checked ? 'block' : 'none';
        
        // Agregar event listener para cambios

        includeHolidaysCheckbox.addEventListener('change', function() {
            holidaysList.style.display = this.checked ? 'block' : 'none';
        });
    }
}

// Función para configurar la funcionalidad de festivos
async function setupHolidaysFunctionality(data) {
    const addHolidayBtn = document.getElementById('add-holiday-btn');
    if (addHolidayBtn) {
        const userRole = await getCurrentUserRole();
        const isAdmin = userRole === 'admin';
        
        if (!isAdmin) {
            addHolidayBtn.style.display = 'none'; // Ocultar botón para usuarios regulares
        } else {
            addHolidayBtn.addEventListener('click', function() {
                addNewHolidayItem();
            });
        }
    }
}

// Función para agregar un nuevo festivo
function addNewHolidayItem() {
    const container = document.getElementById('holidays-container');
    if (!container) return;
    const index = container.children.length;
    const holidayItem = document.createElement('div');
    holidayItem.className = 'holiday-item';
    holidayItem.innerHTML =
        '<input type="date" value="" data-index="' + index + '">' +
        '<input type="text" placeholder="Nombre del festivo" value="" data-index="' + index + '">' +
        '<button type="button" onclick="removeHolidayItem(this)">Eliminar</button>';
    container.appendChild(holidayItem);
}

// Función para eliminar un festivo
function removeHolidayItem(button) {
    button.parentElement.remove();
    // Reindexar los elementos restantes
    const container = document.getElementById('holidays-container');
    const items = container.querySelectorAll('.holiday-item');
    items.forEach((item, index) => {
        const inputs = item.querySelectorAll('input');
        inputs.forEach(input => input.setAttribute('data-index', index));
    });
}

// Función para actualizar estadísticas de progreso
function updateProgressStats(data) {
    // Recalcular estadísticas
    let totalTasks = 0;
    let totalHours = 0;
    let completedTasks = 0;
    let completedHours = 0;
    
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach(phase => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                totalTasks += phase.tasks.length;
                phase.tasks.forEach(task => {
                    const taskHours = parseFloat(task.durationHours) || 0;
                    totalHours += taskHours;
                    if (task.completed) {
                        completedTasks++;
                        completedHours += taskHours;
                    }
                });
            }
        });
    }
    
    // Actualizar UI
    document.getElementById('total-tasks').textContent = totalTasks;
    document.getElementById('total-hours').textContent = Math.round(totalHours);
    document.getElementById('completed-tasks').textContent = completedTasks;
    document.getElementById('completed-hours').textContent = Math.round(completedHours);
    
    // Actualizar barra de progreso
    const progressPercentage = totalHours > 0 ? (completedHours / totalHours) * 100 : 0;
    document.getElementById('overall-progress').style.width = progressPercentage + '%';
    document.getElementById('progress-text').textContent = Math.round(progressPercentage) + '%';
}

// Función para guardar el proyecto en Firebase
async function saveProject(data) {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('id');
    
    if (!projectId) {
        console.error('No project ID found');
        return;
    }
    
    try {
        // Actualizar fecha de última modificación
        data.lastUpdated = new Date();
        
        await db.collection('projects').doc(projectId).update(data);
        console.log('Proyecto guardado exitosamente');
    } catch (error) {
        console.error('Error al guardar el proyecto:', error);
        throw error;
    }
}

// Placeholder functions para componentes que faltan
function renderCalendar(data) {
    // Obtener el contenedor del calendario al inicio
    const calendarContainer = document.getElementById('calendar-container');
    if (!calendarContainer) return;
    // Tooltip único para tareas
    let tooltip = document.getElementById('calendar-tooltip-task');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'calendar-tooltip-task';
        tooltip.className = 'calendar-tooltip-task';
        document.body.appendChild(tooltip);
    }
    // Panel de detalles único
    let detailPanel = document.getElementById('task-detail-panel');
    if (!detailPanel) {
        detailPanel = document.createElement('div');
        detailPanel.id = 'task-detail-panel';
        document.body.appendChild(detailPanel);
    }
    function closeDetailPanel() {
        detailPanel.classList.remove('open');
        setTimeout(() => { detailPanel.innerHTML = ''; }, 300);
    }
    calendarContainer.innerHTML = '';
    // ...el resto del código de renderizado y eventos se mantiene igual...

    // Calcular rango de fechas del proyecto
    let minDate = null;
    let maxDate = null;
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach((phase, phaseIdx) => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.map(normalizeTask).forEach((task, taskIdx) => {
                    const start = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
                    const end = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
                    if (start && !isNaN(start.getTime())) {
                        if (!minDate || start < minDate) minDate = new Date(start);
                    }
                    if (end && !isNaN(end.getTime())) {
                        if (!maxDate || end > maxDate) maxDate = new Date(end);
                    }
                });
            }
        });
    }
    if (!minDate) minDate = new Date();
    if (!maxDate) maxDate = new Date(minDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 días por defecto

    // Generar lista de meses
    const months = [];
    let current = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (current <= maxDate) {
        months.push(new Date(current));
        current.setMonth(current.getMonth() + 1);
    }

    // Definir opciones para días hábiles
    const options = {
        skipSaturday: data.includeSaturdays === false || data.includeSaturdays === undefined ? true : !data.includeSaturdays,
        skipSunday: data.includeSundays === false || data.includeSundays === undefined ? true : !data.includeSundays,
        holidays: sanitizeHolidays(data.holidays || [])
    };

    // Obtener tareas y festivos, y mapear número global de tarea y fase
    const tasks = [];
    let globalTaskNumber = 1;
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach((phase, phaseIdx) => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.map(normalizeTask).forEach((task, taskIdx) => {
                    tasks.push({
                        ...task,
                        globalTaskNumber,
                        phaseName: phase.name || `Fase ${phaseIdx + 1}`,
                        phaseIdx,
                        taskIdx
                    });
                    globalTaskNumber++;
                });
            }
        });
    }
    // Exponer para depuración
    window._calendarTasks = tasks;
    const holidays = sanitizeHolidays(data.holidays || []).map(h => ({
        date: formatDateForInput(parseHolidayDate(h.date)),
        name: h.name || ''
    }));

    // Construir el calendario con múltiples meses
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    let calendarHtml = '';

    months.forEach(monthDate => {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();

        // Construir cuadrícula para este mes
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const firstWeekDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Lunes=0
        const daysInMonth = lastDay.getDate();

        calendarHtml += `<div class="month-container"><div class="month-header">${monthNames[month]} ${year}</div><div class="calendar-grid">`;
        const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        weekDays.forEach(d => calendarHtml += `<div class="calendar-day-header">${d}</div>`);

        // Rellenar días de la semana anterior
        for (let i = 0; i < firstWeekDay; i++) {
            calendarHtml += '<div class="calendar-day other-month"></div>';
        }

        // Días del mes
        for (let day = 1; day <= daysInMonth; day++) {
            const dateObj = new Date(year, month, day);
            const dateStr = formatDateForInput(dateObj);
            // Verificar si es día hábil
            const isWorkDayFlag = isWorkDay(dateObj, options);
            // Buscar si es festivo
            const holiday = holidays.find(h => h.date === dateStr);
            // Buscar tareas que abarcan este día (inicio <= día <= fin), solo si es día hábil
            const dayTasks = isWorkDayFlag ? tasks.filter(task => {
                const start = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
                const end = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
                // Comparar solo fechas, ignorando horas
                const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                const currentDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
                return startDay <= currentDay && currentDay <= endDay;
            }) : [];
            // Buscar tareas completadas
            const completed = dayTasks.some(t => t.completed);
            // Buscar hitos
            const hasMilestone = dayTasks.some(t => t.isMilestone || t.esHito);

            let dayClass = '';
            if (holiday) dayClass += ' holiday';
            if (dayTasks.length > 0) dayClass += ' has-task';
            if (hasMilestone) dayClass += ' has-milestone';
            if (completed) dayClass += ' has-completed-task';

            // Agregar clases de fase de tarea solo si es día hábil
            if (isWorkDayFlag) {
                dayTasks.forEach(task => {
                    const start = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
                    const end = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
                    // Comparar solo fechas
                    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                    const currentDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
                    if (startDay.getTime() === currentDay.getTime()) {
                        dayClass += ' task-start';
                    }
                    if (endDay.getTime() === currentDay.getTime()) {
                        dayClass += ' task-end';
                    }
                    if (startDay < currentDay && currentDay < endDay) {
                        dayClass += ' task-ongoing';
                    }
                });
            }

            calendarHtml += `<div class="calendar-day${dayClass}" data-date="${dateStr}">
                <span class="day-number">${day}</span>
                ${holiday ? `<div class="holiday-name">${holiday.name}</div>` : ''}
                ${dayTasks.map(t => `
                    <span class="task-indicator" 
                        data-task-number="${t.globalTaskNumber}" 
                        data-phase-name="${t.phaseName}" 
                        data-task-name="${t.name || 'Tarea'}" 
                        data-duration="${t.durationHours || 0}h" 
                        data-start="${safeDateFormatForDisplay(t.startDate)} ${t.startTime || '--:--'}" 
                        data-end="${safeDateFormatForDisplay(t.endDate)} ${t.endTime || '--:--'}"
                        title="Tarea ${t.globalTaskNumber}: ${t.name || 'Tarea'} (${t.durationHours || 0}h)"
                    >${t.globalTaskNumber}</span>`).join('')}
            </div>`;
        }

        // Rellenar días de la semana siguiente
        const totalCells = firstWeekDay + daysInMonth;
        const nextDays = (7 - (totalCells % 7)) % 7;
        for (let i = 0; i < nextDays; i++) {
            calendarHtml += '<div class="calendar-day other-month"></div>';
        }
        calendarHtml += '</div></div>';
    });

    calendarContainer.innerHTML = calendarHtml;


    // Mostrar tabla de tareas al hacer clic en un día
    calendarContainer.querySelectorAll('.calendar-day').forEach(dayEl => {
        dayEl.addEventListener('click', function() {
            const date = dayEl.getAttribute('data-date');
            const dayDateObj = new Date(date + 'T00:00:00');
            const dayTasks = tasks.filter(task => {
                const start = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
                const end = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
                // Comparar solo fechas
                const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                const currentDay = new Date(dayDateObj.getFullYear(), dayDateObj.getMonth(), dayDateObj.getDate());
                return startDay <= currentDay && currentDay <= endDay;
            });
            if (dayTasks.length === 0) return;
            // Mostrar resumen en una sola línea por tarea
            let resumenHtml = dayTasks.map(t => {
                let nombre = t.name || t.nombre || '';
                let milestone = (t.isMilestone || t.esHito) ? ' 🎯' : '';
                let duracion = (t.durationHours !== undefined ? t.durationHours : t.duracion) || '';
                let inicio = `${safeDateFormatForDisplay(t.startDate)} ${t.startTime || '--:--'}`;
                let fin = `${safeDateFormatForDisplay(t.endDate)} ${t.endTime || '--:--'}`;
                return `<div style="padding:0.5em 0.7em;border-bottom:1px solid #e0e6ef;font-size:1.04em;line-height:1.5;display:flex;flex-wrap:wrap;align-items:center;gap:1.1em;margin-bottom:2px;">
                    <span style="color:#3498db;font-weight:bold;min-width:2.5em;max-width:30vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.globalTaskNumber}. ${nombre}${milestone}</span>
                    <span style="color:#aaa;">|</span>
                    <span style="color:#222;min-width:3em;">${duracion}h</span>
                    <span style="color:#aaa;">|</span>
                    <span style="color:#444;max-width:32vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Inicio: ${inicio}</span>
                    <span style="color:#aaa;">|</span>
                    <span style="color:#444;max-width:32vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Fin: ${fin}</span>
                </div>`;
            }).join('');
            const modal = document.getElementById('day-tasks-modal');
            const modalTitle = document.getElementById('modal-date-title');
            const modalList = document.getElementById('modal-tasks-list');
            modalTitle.textContent = `Tareas del día ${date.split('-').reverse().join('/')}`;
            modalList.innerHTML = resumenHtml;
            modal.classList.add('show');
            document.getElementById('close-modal-btn').onclick = () => modal.classList.remove('show');
        });
    });

    // Agregar funcionalidad de resaltado al hacer clic en indicadores de tarea
    calendarContainer.querySelectorAll('.task-indicator').forEach(indicator => {
        indicator.addEventListener('click', function(e) {
            e.stopPropagation(); // Evitar que se active el clic del día
            const taskNumber = parseInt(this.getAttribute('data-task-number'));
            
            // Encontrar la tarea correspondiente
            const task = tasks.find(t => t.globalTaskNumber === taskNumber);
            if (!task) return;
            
            // Quitar resaltado anterior
            document.querySelectorAll('.task.highlighted').forEach(el => el.classList.remove('highlighted'));
            
            // Encontrar el elemento de la tarea en la lista de fases
            const taskElement = document.querySelector(`.task[data-task-index="${task.taskIdx}"][data-phase-index="${task.phaseIdx}"]`);
            if (taskElement) {
                // Expandir la fase si está contraída
                const phaseEl = taskElement.closest('.phase');
                if (phaseEl && phaseEl.classList.contains('collapsed')) {
                    phaseEl.classList.remove('collapsed');
                    const phaseHeader = phaseEl.querySelector('.phase-header');
                    if (phaseHeader) {
                        phaseHeader.classList.remove('collapsed');
                    }
                }
                
                // Agregar resaltado
                taskElement.classList.add('highlighted');
                
                // Hacer scroll a la sección de fases
                const phasesSection = document.getElementById('phases-container');
                if (phasesSection) {
                    phasesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    
                    // Después del scroll, hacer scroll adicional para centrar la tarea
                    setTimeout(() => {
                        taskElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        
                        // Quitar el resaltado después de 3 segundos
                        setTimeout(() => {
                            taskElement.classList.remove('highlighted');
                        }, 3000);
                    }, 500);
                }
            }
        });
    });
}

function setupCalendarInteractions(data) {
    console.log('Configurando interacciones del calendario');
    // Implementación de interacciones del calendario
}


let sCurveChartInstance = null;
function renderSCurve(data) {
    const chartContainer = document.getElementById('s-curve-chart');
    if (!chartContainer) return;
    chartContainer.innerHTML = '<canvas id="sCurveCanvas" height="400"></canvas>';
    const ctx = document.getElementById('sCurveCanvas').getContext('2d');

    // Recolectar tareas ordenadas por fecha de fin
    let tasks = [];
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach(phase => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.map(normalizeTask).forEach(task => tasks.push(task));
            }
        });
    }
    tasks = tasks.filter(t => t.startDate).sort((a, b) => {
        const aDate = a.endDate && typeof a.endDate.toDate === 'function' ? a.endDate.toDate() : new Date(a.endDate || a.startDate);
        const bDate = b.endDate && typeof b.endDate.toDate === 'function' ? b.endDate.toDate() : new Date(b.endDate || b.startDate);
        return aDate - bDate;
    });

    if (tasks.length === 0) return;

    // Calcular fechas del proyecto
    const projectStart = data.startDate && typeof data.startDate.toDate === 'function' ? data.startDate.toDate() : new Date(data.startDate);
    const projectEnd = tasks[tasks.length - 1].endDate && typeof tasks[tasks.length - 1].endDate.toDate === 'function' ?
        tasks[tasks.length - 1].endDate.toDate() : new Date(tasks[tasks.length - 1].endDate);

    // Generar fechas diarias desde inicio hasta fin del proyecto
    const dateLabels = [];
    const currentDate = new Date(projectStart);
    while (currentDate <= projectEnd) {
        dateLabels.push(formatDateForInput(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calcular totales del proyecto
    const totalTasks = tasks.length;
    const totalHours = tasks.reduce((sum, t) => sum + (parseFloat(t.durationHours) || 0), 0);

    // Calcular progreso PLANIFICADO (basado en fechas)
    const plannedPercent = [];
    const plannedHours = [];

    dateLabels.forEach(dateStr => {
        const currentDate = new Date(dateStr + 'T00:00:00');

        // Calcular tareas que deberían estar completadas HASTA esta fecha
        let tasksCompletedByDate = 0;
        let hoursCompletedByDate = 0;

        tasks.forEach(task => {
            const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
            if (taskEnd <= currentDate) {
                tasksCompletedByDate++;
                hoursCompletedByDate += parseFloat(task.durationHours) || 0;
            }
        });

        plannedPercent.push(Math.min(100, (tasksCompletedByDate / totalTasks) * 100));
        plannedHours.push(Math.min(totalHours, hoursCompletedByDate));
    });

    // Calcular progreso REAL (basado en tareas completadas)
    const actualPercent = [];
    const actualHours = [];
    let actualTasksCompleted = 0;
    let actualHoursCompleted = 0;

    dateLabels.forEach(dateStr => {
        const currentDate = new Date(dateStr + 'T00:00:00');

        // Reset para cada fecha
        actualTasksCompleted = 0;
        actualHoursCompleted = 0;

        // Contar tareas realmente completadas hasta esta fecha
        tasks.forEach(task => {
            if (task.completed) {
                const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
                if (taskEnd <= currentDate) {
                    actualTasksCompleted++;
                    actualHoursCompleted += parseFloat(task.durationHours) || 0;
                }
            }
        });

        actualPercent.push(Math.min(100, (actualTasksCompleted / totalTasks) * 100));
        actualHours.push(Math.min(totalHours, actualHoursCompleted));
    });

    // Crear gráfica con Chart.js
    if (sCurveChartInstance) sCurveChartInstance.destroy();
    sCurveChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dateLabels.map(d => {
                const date = new Date(d + 'T00:00:00');
                return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
            }),
            datasets: [
                {
                    label: 'Plan - % Tareas',
                    data: plannedPercent,
                    borderColor: '#95a5a6',
                    backgroundColor: 'rgba(149, 165, 166, 0.1)',
                    borderDash: [5, 5],
                    yAxisID: 'y1',
                    tension: 0.2,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Real - % Tareas',
                    data: actualPercent,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.2,
                    pointRadius: 3,
                    fill: false
                },
                {
                    label: 'Plan - Horas',
                    data: plannedHours,
                    borderColor: '#bdc3c7',
                    backgroundColor: 'rgba(189, 195, 199, 0.1)',
                    borderDash: [5, 5],
                    yAxisID: 'y2',
                    tension: 0.2,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Real - Horas',
                    data: actualHours,
                    borderColor: '#27ae60',
                    backgroundColor: 'rgba(39, 174, 96, 0.1)',
                    yAxisID: 'y2',
                    tension: 0.2,
                    pointRadius: 3,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            stacked: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                title: {
                    display: true,
                    text: 'Curva S - Plan vs Real',
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const dateIndex = context[0].dataIndex;
                            const fullDate = dateLabels[dateIndex];
                            const date = new Date(fullDate + 'T00:00:00');
                            return date.toLocaleDateString('es-ES', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.datasetIndex < 2) {
                                // Porcentajes
                                label += Math.round(context.parsed.y) + '%';
                            } else {
                                // Horas
                                label += Math.round(context.parsed.y) + 'h';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: { display: true, text: 'Fecha' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 100,
                    title: { display: true, text: '% Completado' },
                    grid: { drawOnChartArea: false }
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: Math.max(100, totalHours),
                    title: { display: true, text: 'Horas Acumuladas' }
                }
            }
        }
    });

    // Actualizar métricas
    const today = new Date();
    const todayStr = formatDateForInput(today);

    // Encontrar el índice de la fecha actual en dateLabels
    const todayIndex = dateLabels.findIndex(dateStr => dateStr >= todayStr);
    const currentIndex = todayIndex >= 0 ? todayIndex : dateLabels.length - 1;

    // Usar el progreso hasta la fecha actual para calcular métricas
    const currentPlannedPct = plannedPercent[currentIndex] || 0;
    const currentActualPct = actualPercent[currentIndex] || 0;
    const currentPlannedHrs = plannedHours[currentIndex] || 0;
    const currentActualHrs = actualHours[currentIndex] || 0;

    // Verificar si el proyecto no ha iniciado
    const projectHasStarted = today >= projectStart || tasks.some(task => task.completed);

    let scheduleStatus, performanceStatus, projectStatus, scheduleVariance, spi;

    if (!projectHasStarted) {
        // Proyecto no ha iniciado
        scheduleStatus = 'No iniciado';
        performanceStatus = 'No iniciado';
        projectStatus = 'No iniciado';
        scheduleVariance = 0;
        spi = 0;
    } else {
        // Proyecto ha iniciado, calcular métricas basadas en progreso hasta hoy
        // Calcular variación de cronograma (Actual - Planificado)
        scheduleVariance = currentActualPct - currentPlannedPct;
        const scheduleVarianceAbs = Math.abs(scheduleVariance);

        scheduleStatus = 'En tiempo';
        if (scheduleVariance > 5) {
            scheduleStatus = 'Adelantado';
        } else if (scheduleVariance < -5) {
            scheduleStatus = 'Atrasado';
        }

        // Calcular índice de rendimiento (SPI) - Schedule Performance Index
        spi = currentPlannedPct > 0 ? (currentActualPct / currentPlannedPct) : (currentActualPct > 0 ? 1 : 0);
        performanceStatus = 'Normal';
        if (spi > 1.1) {
            performanceStatus = 'Sobrerendimiento';
        } else if (spi < 0.9) {
            performanceStatus = 'Subrendimiento';
        }

        // Determinar estado del proyecto basado en progreso actual
        projectStatus = 'En tiempo';
        if (currentActualPct === 100) {
            projectStatus = 'Finalizado';
        } else if (currentActualPct > currentPlannedPct) {
            projectStatus = 'Adelantado';
        } else if (currentActualPct < currentPlannedPct) {
            projectStatus = 'Atrasado';
        }
    }

    // Actualizar elementos HTML
    const scheduleVarianceEl = document.getElementById('schedule-variance');
    const performanceIndexEl = document.getElementById('performance-index');
    const projectStatusEl = document.getElementById('project-status');

    if (scheduleVarianceEl) {
        scheduleVarianceEl.textContent = projectHasStarted ? `${scheduleStatus} (${scheduleVariance > 0 ? '+' : ''}${Math.round(scheduleVariance)}%)` : scheduleStatus;
    }
    if (performanceIndexEl) {
        performanceIndexEl.textContent = projectHasStarted ? `${performanceStatus} (SPI: ${spi.toFixed(2)})` : performanceStatus;
    }
    if (projectStatusEl) {
        projectStatusEl.textContent = projectStatus;
    }
}

function renderGantt(data) {
    const container = document.getElementById('gantt-chart-container');
    if (!container) return;

    const phaseColors = ['#667eea', '#764ba2', '#28a745', '#ffc107', '#e74c3c'];
    const options = data.settings || {};
    options.holidays = sanitizeHolidays(data.holidays || []);

    function isNonWorkDay(day) {
        return !isWorkDay(day, options);
    }

    // Recopilar todas las tareas del proyecto
    // Asignar números globales de tarea directamente a las tareas en las fases
    let globalTaskNumber = 1;
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach((phase, phaseIndex) => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.forEach((task, taskIndex) => {
                    task.globalTaskNumber = globalTaskNumber++;
                });
            }
        });
    }

    // Calcular fechas mínimas y máximas del proyecto
    // minDate: fecha de inicio del proyecto (o fecha de la primera tarea si es anterior)
    // maxDate: fecha de fin estimada del proyecto (basada en la última tarea, o fecha por defecto)
    let minDate = null;
    let maxDate = null;

    // Usar la fecha de inicio del proyecto como base para minDate
    if (data.startDate) {
        const projectStart = data.startDate && typeof data.startDate.toDate === 'function' ? data.startDate.toDate() : new Date(data.startDate);
        if (projectStart && !isNaN(projectStart.getTime())) {
            minDate = new Date(projectStart.getFullYear(), projectStart.getMonth(), projectStart.getDate());
        }
    }

    // Calcular el rango basado en las tareas existentes
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach(phase => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.forEach(task => {
                    const start = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
                    const end = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);

                    if (start && !isNaN(start.getTime())) {
                        // Normalizar a medianoche para evitar problemas de horas
                        const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                        if (!minDate || normalizedStart < minDate) minDate = new Date(normalizedStart);
                    }
                    if (end && !isNaN(end.getTime())) {
                        // Normalizar a medianoche para evitar problemas de horas
                        const normalizedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                        if (!maxDate || normalizedEnd > maxDate) maxDate = new Date(normalizedEnd);
                    }
                });
            }
        });
    }

    // Fallbacks si no hay fechas calculadas
    if (!minDate) minDate = new Date();
    if (!maxDate) {
        // Si hay fecha de inicio del proyecto, usar 30 días por defecto
        // Si no, usar la fecha actual + 30 días
        const baseDate = data.startDate ? minDate : new Date();
        maxDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 días por defecto
    }

    // Limitar el timeline a máximo 12 meses (365 días) para mejor visualización
    const maxTimelineDays = 365;
    const calculatedDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (calculatedDays > maxTimelineDays) {
        maxDate = new Date(minDate.getTime() + (maxTimelineDays - 1) * 24 * 60 * 60 * 1000);
    }

    // Crear timeline solo con los días relevantes (desde minDate hasta maxDate)
    const timelineDays = [];
    const currentDate = new Date(minDate);
    while (currentDate <= maxDate) {
        timelineDays.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    const totalDays = timelineDays.length;

    // Obtener fecha actual para la línea del día actual
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalizar a medianoche

    // Calcular posición de la línea del día actual
    let todayPosition = -1;
    if (today >= minDate && today <= maxDate) {
        const diffTime = today.getTime() - minDate.getTime();
        todayPosition = Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    // Obtener configuración de holidays para determinar días no laborables
    const holidays = data.holidays || data.settings?.holidays || [];
    const sanitizedHolidays = sanitizeHolidays(holidays);

    // Función auxiliar para verificar si un día es no laborable
    function isNonWorkDay(date) {
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // Verificar si es festivo
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const dayOfMonth = date.getDate().toString().padStart(2, '0');
        const dateString = `${year}-${month}-${dayOfMonth}`;
        const isHoliday = sanitizedHolidays.some(h => h.date === dateString);

        return isWeekend || isHoliday;
    }

    // Definir ancho fijo por día para asegurar alineación perfecta
    const dayWidthPx = 20; // 20px por día para mejor compresión
    const timelineWidthPx = totalDays * dayWidthPx;

    // Crear HTML del diagrama de Gantt
    let ganttHtml = `
        <div style="font-family: 'Inter', 'Roboto', sans-serif; background-color: #f8f9fa; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="overflow-x: auto; overflow-y: auto; max-height: 600px;">

                <!-- Encabezado con timeline -->
                <div style="display: flex; position: sticky; top: 0; z-index: 10; background: white; border-bottom: 1px solid #e9ecef;">

                    <!-- Espacio vacío para alinear con el eje izquierdo -->
                    <div style="width: 300px; padding: 16px; border-right: 1px solid #e9ecef; background: #f8f9fa; flex-shrink: 0;"></div>

                    <!-- Timeline -->
                    <div style="position: relative; width: ${timelineWidthPx}px; flex-shrink: 0;">

                        <!-- Primera fila: Meses -->
                        <div style="display: flex; height: 40px; border-bottom: 1px solid #e9ecef;">`;

    // Agrupar días por meses
    const months = [];
    let currentMonth = null;
    let monthStartIndex = 0;

    timelineDays.forEach((day, index) => {
        const monthKey = `${day.getFullYear()}-${day.getMonth()}`;
        if (currentMonth !== monthKey) {
            if (currentMonth !== null) {
                months.push({
                    month: currentMonth,
                    startIndex: monthStartIndex,
                    endIndex: index - 1,
                    days: index - monthStartIndex
                });
            }
            currentMonth = monthKey;
            monthStartIndex = index;
        }
    });
    if (currentMonth !== null) {
        months.push({
            month: currentMonth,
            startIndex: monthStartIndex,
            endIndex: timelineDays.length - 1,
            days: timelineDays.length - monthStartIndex
        });
    }

    months.forEach(month => {
        const monthDate = timelineDays[month.startIndex];
        const monthName = monthDate.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
        const monthWidthPx = month.days * dayWidthPx;

        ganttHtml += `
            <div style="width: ${monthWidthPx}px; text-align: center; padding: 8px; border-right: 1px solid #e9ecef; background: #f8f9fa; font-weight: 600; color: #495057;">
                ${monthName}
            </div>`;
    });

    ganttHtml += `
                        </div>

                        <!-- Segunda fila: Días -->
                        <div style="display: flex; height: 30px;">
`;

    timelineDays.forEach((day, index) => {
        const dayNumber = day.getDate();
        const isNonWorkable = isNonWorkDay(day);
        const background = isNonWorkable ? '#f1f3f4' : 'white';

        ganttHtml += `
            <div style="width: ${dayWidthPx}px; text-align: center; padding: 4px; border-right: 1px solid #e9ecef; background: ${background}; font-size: 12px; color: #6c757d;">
                ${dayNumber}
            </div>`;
    });

    ganttHtml += `
                        </div>

                        <!-- Línea vertical para hoy -->
                        ${todayPosition >= 0 ? `<div style="position: absolute; top: 0; left: ${todayPosition * dayWidthPx}px; width: 2px; height: 100%; background: #dc3545; z-index: 5;"></div>` : ''}

                    </div>
                </div>

                <!-- Contenido del Gantt -->
                <div style="display: flex; flex-direction: column;">`;

    // Procesar fases y tareas
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach((phase, phaseIndex) => {
            const phaseColor = phaseColors[phaseIndex % phaseColors.length];
            const phaseLightColor = lightenColor(phaseColor, 0.3);

            // Fila de fase
            ganttHtml += `
                    <div style="display: flex; height: 32px; border: 1px solid #dee2e6; border-bottom: none; border-top: none;">
                        <div style="width: 300px; padding: 0 16px; border-right: 1px solid #dee2e6; background: ${phaseColor}; color: white; font-weight: 600; display: flex; align-items: center; overflow: hidden; flex-shrink: 0; border-left: 1px solid #dee2e6;">
                            <span style="font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; margin-left: 8px;">${phase.name || `Fase ${phaseIndex + 1}`}</span>
                        </div>
                        <div style="position: relative; background: white; width: ${timelineWidthPx}px; flex-shrink: 0; border: 1px solid #dee2e6; border-left: none; display: flex;">
                            <!-- Fondos de colores por día (igual que la escala de tiempo) -->
                            ${timelineDays.map((day, index) => {
                                const isNonWorkable = isNonWorkDay(day);
                                const background = isNonWorkable ? '#f1f3f4' : 'white';
                                return `<div style="width: ${dayWidthPx}px; height: 100%; background: ${background}; border-right: 1px solid #e9ecef;"></div>`;
                            }).join('')}
                            <!-- Cuadrícula vertical para alinear con los días -->
                            ${timelineDays.map((day, index) => `<div style="position: absolute; top: 0; left: ${index * dayWidthPx}px; width: 1px; height: 100%; background: #e9ecef; z-index: 1;"></div>`).join('')}
                            <!-- Espacio para barras de fase si es necesario -->
                        </div>
                    </div>`;

            // Tareas de la fase
            for (const task of phase.tasks) {
                const taskName = `${task.globalTaskNumber}. ${task.name || 'Tarea sin nombre'}`;
                const isMilestone = task.isMilestone || task.esHito || false;
                const isCompleted = task.completed || false;

                // Calcular posición y duración de la barra usando índices del timeline
                const start = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
                const end = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);

                if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) continue;

                // Normalizar fechas a medianoche para cálculo preciso
                const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                const normalizedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());

                const startDiff = normalizedStart.getTime() - minDate.getTime();
                const endDiff = normalizedEnd.getTime() - minDate.getTime();
                const startDays = Math.round(startDiff / (1000 * 60 * 60 * 24));
                const endDays = Math.round(endDiff / (1000 * 60 * 60 * 24));

                const durationDays = Math.max(1, endDays - startDays + 1);
                const leftPx = startDays * dayWidthPx;
                const widthPx = durationDays * dayWidthPx;

                const barColor = isCompleted ? '#28a745' : phaseLightColor;
                const barStyle = `left: ${leftPx}px; width: ${widthPx}px; background: ${barColor}; height: 100%; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); position: absolute; top: 0; display: flex; align-items: center; justify-content: center;`;

                // Fila de tarea
                ganttHtml += `
                    <div style="display: flex; border: 1px solid #dee2e6; border-bottom: none; border-top: none;">
                        <div style="width: 300px; padding: 0 16px 0 32px; border-right: 1px solid #e9ecef; background: white; display: flex; align-items: center; overflow: hidden; flex-shrink: 0; border-left: 1px solid #dee2e6;">
                            <span style="font-size: 13px; font-weight: 500; color: #495057; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">${taskName}${isMilestone ? ' 🎯' : ''}</span>
                        </div>
                        <div style="position: relative; width: ${timelineWidthPx}px; flex-shrink: 0; border: 1px solid #dee2e6; border-left: none; display: flex;">
                            <!-- Fondos de colores por día (igual que la escala de tiempo) -->
                            ${timelineDays.map((day, index) => {
                                const isNonWorkable = isNonWorkDay(day);
                                const background = isNonWorkable ? '#f1f3f4' : 'white';
                                return `<div style="width: ${dayWidthPx}px; height: 100%; background: ${background}; border-right: 1px solid #e9ecef;"></div>`;
                            }).join('')}
                            <!-- Cuadrícula vertical para alinear con los días -->
                            ${timelineDays.map((day, index) => `<div style="position: absolute; top: 0; left: ${index * dayWidthPx}px; width: 1px; height: 100%; background: #e9ecef; z-index: 1;"></div>`).join('')}
                            <div style="${barStyle}" title="${taskName} - ${safeDateFormatForDisplay(start)} a ${safeDateFormatForDisplay(end)} (${task.durationHours || 0}h)">
                                <div style="padding: 0 8px; color: white; font-size: 11px; font-weight: 500; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);">${task.durationHours || 0}h</div>
                            </div>
                        </div>
                    </div>`;
            }
        });
    }

    ganttHtml += `
                </div>
            </div>
        </div>`;

    container.innerHTML = ganttHtml;
}

// Función auxiliar para aclarar colores
function lightenColor(color, percent) {
    // Convertir hex a RGB
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent * 100);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

function refreshSCurve(data) {
    renderSCurve(data);
}

function updateSCurveMetrics(data) {
    // Esta función actualiza las métricas Y la gráfica de curva S cuando cambian los estados de completado

    // Recolectar tareas ordenadas por fecha de fin
    let tasks = [];
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach(phase => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.map(normalizeTask).forEach(task => tasks.push(task));
            }
        });
    }
    tasks = tasks.filter(t => t.startDate).sort((a, b) => {
        const aDate = a.endDate && typeof a.endDate.toDate === 'function' ? a.endDate.toDate() : new Date(a.endDate || a.startDate);
        const bDate = b.endDate && typeof b.endDate.toDate === 'function' ? b.endDate.toDate() : new Date(b.endDate || b.startDate);
        return aDate - bDate;
    });

    if (tasks.length === 0) return;

    // Calcular fechas del proyecto
    const projectStart = data.startDate && typeof data.startDate.toDate === 'function' ? data.startDate.toDate() : new Date(data.startDate);

    // Generar fechas diarias desde inicio hasta fin del proyecto
    const projectEnd = tasks[tasks.length - 1].endDate && typeof tasks[tasks.length - 1].endDate.toDate === 'function' ?
        tasks[tasks.length - 1].endDate.toDate() : new Date(tasks[tasks.length - 1].endDate);

    const dateLabels = [];
    const currentDate = new Date(projectStart);
    while (currentDate <= projectEnd) {
        dateLabels.push(formatDateForInput(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calcular totales del proyecto
    const totalTasks = tasks.length;
    const totalHours = tasks.reduce((sum, t) => sum + (parseFloat(t.durationHours) || 0), 0);

    // Calcular progreso PLANIFICADO (basado en fechas)
    const plannedPercent = [];
    const plannedHours = [];

    dateLabels.forEach(dateStr => {
        const currentDate = new Date(dateStr + 'T00:00:00');

        // Calcular tareas que deberían estar completadas HASTA esta fecha
        let tasksCompletedByDate = 0;
        let hoursCompletedByDate = 0;

        tasks.forEach(task => {
            const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
            if (taskEnd <= currentDate) {
                tasksCompletedByDate++;
                hoursCompletedByDate += parseFloat(task.durationHours) || 0;
            }
        });

        plannedPercent.push(Math.min(100, (tasksCompletedByDate / totalTasks) * 100));
        plannedHours.push(Math.min(totalHours, hoursCompletedByDate));
    });

    // Calcular progreso REAL (basado en tareas completadas)
    const actualPercent = [];
    const actualHours = [];

    dateLabels.forEach(dateStr => {
        const currentDate = new Date(dateStr + 'T00:00:00');

        // Contar tareas realmente completadas hasta esta fecha
        let actualTasksCompleted = 0;
        let actualHoursCompleted = 0;

        tasks.forEach(task => {
            if (task.completed) {
                const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
                if (taskEnd <= currentDate) {
                    actualTasksCompleted++;
                    actualHoursCompleted += parseFloat(task.durationHours) || 0;
                }
            }
        });

        actualPercent.push(Math.min(100, (actualTasksCompleted / totalTasks) * 100));
        actualHours.push(Math.min(totalHours, actualHoursCompleted));
    });

    // Actualizar la gráfica de Chart.js si existe
    if (sCurveChartInstance) {
        // Actualizar los datasets de progreso real
        sCurveChartInstance.data.datasets[1].data = actualPercent; // Real - % Tareas
        sCurveChartInstance.data.datasets[3].data = actualHours;   // Real - Horas

        // Actualizar la gráfica
        sCurveChartInstance.update('none'); // 'none' para evitar animaciones que puedan confundir
    }

    // Actualizar métricas usando el progreso hasta la fecha actual
    const today = new Date();
    const todayStr = formatDateForInput(today);
    const todayIndex = dateLabels.findIndex(dateStr => dateStr >= todayStr);
    const currentIndex = todayIndex >= 0 ? todayIndex : dateLabels.length - 1;

    const currentPlannedPct = plannedPercent[currentIndex] || 0;
    const currentActualPct = actualPercent[currentIndex] || 0;

    const projectHasStarted = today >= projectStart || tasks.some(task => task.completed);

    let scheduleStatus, performanceStatus, projectStatus, scheduleVariance, spi;

    if (!projectHasStarted) {
        scheduleStatus = 'No iniciado';
        performanceStatus = 'No iniciado';
        projectStatus = 'No iniciado';
        scheduleVariance = 0;
        spi = 0;
    } else {
        scheduleVariance = currentActualPct - currentPlannedPct;

        scheduleStatus = 'En tiempo';
        if (scheduleVariance > 5) {
            scheduleStatus = 'Adelantado';
        } else if (scheduleVariance < -5) {
            scheduleStatus = 'Atrasado';
        }

        spi = currentPlannedPct > 0 ? (currentActualPct / currentPlannedPct) : (currentActualPct > 0 ? 1 : 0);
        performanceStatus = 'Normal';
        if (spi > 1.1) {
            performanceStatus = 'Sobrerendimiento';
        } else if (spi < 0.9) {
            performanceStatus = 'Subrendimiento';
        }

        projectStatus = 'En tiempo';
        if (currentActualPct === 100) {
            projectStatus = 'Finalizado';
        } else if (currentActualPct > currentPlannedPct) {
            projectStatus = 'Adelantado';
        } else if (currentActualPct < currentPlannedPct) {
            projectStatus = 'Atrasado';
        }
    }

    // Actualizar elementos HTML
    const scheduleVarianceEl = document.getElementById('schedule-variance');
    const performanceIndexEl = document.getElementById('performance-index');
    const projectStatusEl = document.getElementById('project-status');

    if (scheduleVarianceEl) {
        scheduleVarianceEl.textContent = projectHasStarted ? `${scheduleStatus} (${scheduleVariance > 0 ? '+' : ''}${Math.round(scheduleVariance)}%)` : scheduleStatus;
    }
    if (performanceIndexEl) {
        performanceIndexEl.textContent = projectHasStarted ? `${performanceStatus} (SPI: ${spi.toFixed(2)})` : performanceStatus;
    }
    if (projectStatusEl) {
        projectStatusEl.textContent = projectStatus;
    }
}

function setupBackToProjectsFunctionality() {
    const backBtn = document.getElementById('back-to-projects-btn');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            window.location.href = 'proyectos.html';
        });
    }
}

function setupLogoutFunctionality() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            firebase.auth().signOut().then(() => {
                window.location.href = 'index.html';
            });
        });
    }
}

function setupDateRecalculation(data) {
    const recalculateBtn = document.getElementById('recalculate-dates-btn');
    if (recalculateBtn) {
        // Verificar rol del usuario y deshabilitar botón si no es admin
        getCurrentUserRole().then(userRole => {
            const isAdmin = userRole === 'admin';
            recalculateBtn.disabled = !isAdmin;
            recalculateBtn.style.opacity = isAdmin ? '1' : '0.5';
            recalculateBtn.title = isAdmin ? '' : 'Solo los administradores pueden modificar la configuración';
        });
        
        recalculateBtn.addEventListener('click', async () => {
            // Verificar rol del usuario antes de aplicar cambios
            const userRole = await getCurrentUserRole();
            if (userRole !== 'admin') {
                alert('No tienes permisos para modificar la configuración del proyecto. Solo los administradores pueden aplicar cambios.');
                return;
            }
            
            try {
                // Collect new config values
                const startDateInput = document.getElementById('start-date-input');
                const includeSaturdays = document.getElementById('include-saturdays');
                const includeSundays = document.getElementById('include-sundays');
                const includeHolidays = document.getElementById('include-holidays');
                const shiftStartTime = document.getElementById('shift-start-time');
                const shiftEndTime = document.getElementById('shift-end-time');
                const shiftBreakStartTime = document.getElementById('shift-break-start-time');
                const shiftBreakHours = document.getElementById('shift-break-hours');

                const newConfig = {
                    startDate: startDateInput ? createDateFromInput(startDateInput.value) : null,
                    includeSaturdays: includeSaturdays ? !includeSaturdays.checked : false,
                    includeSundays: includeSundays ? !includeSundays.checked : false,
                    includeHolidays: includeHolidays ? includeHolidays.checked : true,
                    shiftStartTime: shiftStartTime ? shiftStartTime.value : '08:00',
                    shiftEndTime: shiftEndTime ? shiftEndTime.value : '17:00',
                    shiftBreakStartTime: shiftBreakStartTime ? shiftBreakStartTime.value : '12:00',
                    shiftBreakHours: shiftBreakHours ? parseFloat(shiftBreakHours.value) || 1 : 1
                };

                // Collect holidays
                const holidays = [];
                const holidayItems = document.querySelectorAll('#holidays-container .holiday-item');
                holidayItems.forEach(item => {
                    const dateInput = item.querySelector('input[type="date"]');
                    const nameInput = item.querySelector('input[type="text"]');
                    if (dateInput && dateInput.value) {
                        holidays.push({
                            date: dateInput.value,
                            name: nameInput ? nameInput.value : ''
                        });
                    }
                });
                const sanitizedHolidays = sanitizeHolidays(holidays);
                newConfig.holidays = sanitizedHolidays;

                // Update settings
                data.settings = {
                    skipSaturday: !newConfig.includeSaturdays,
                    skipSunday: !newConfig.includeSundays,
                    holidays: sanitizedHolidays
                };

                // Mantener consistencia
                data.holidays = sanitizedHolidays;

                // Update data object
                Object.assign(data, newConfig);

                // Recalculate task dates with new config
                calculateAllTaskDates(data);

                // Save to Firebase
                await saveProject(data);

                // Update global data
                currentProjectData = data;

                // Re-render project
                renderProject(data, null, currentProjectData.id);

                alert('Cambios aplicados exitosamente.');
            } catch (error) {
                console.error('Error al aplicar cambios:', error);
                alert('Error al aplicar cambios. Inténtalo de nuevo.');
            }
        });
    }
}

// Función mejorada para renderizar el proyecto
function renderProject(data, autoDownload = null, projectId = null) {
    console.log('Renderizando proyecto con datos:', data);
    if (!data) {
        console.error('No hay datos para renderizar');
        return;
    }
    currentProjectData = data; // Actualizar datos globales

    // --- Renderizar Título y Estadísticas ---
    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl) projectNameEl.textContent = data.projectName || 'Proyecto sin nombre';

    // Cargar configuración del proyecto
    loadProjectConfig(data);

    // Normalizar todas las tareas del proyecto
    let allTasks = [];
    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach(phase => {
            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks = phase.tasks.map(normalizeTask);
                allTasks = allTasks.concat(phase.tasks);
            }
        });
    }

    // Calcular estadísticas
    let totalTasks = allTasks.length;
    let totalHours = 0;
    let completedTasks = 0;
    let completedHours = 0;
    allTasks.forEach(task => {
        const taskHours = parseFloat(task.durationHours) || 0;
        totalHours += taskHours;
        if (task.completed) {
            completedTasks++;
            completedHours += taskHours;
        }
    });

    document.getElementById('total-tasks').textContent = totalTasks;
    document.getElementById('total-hours').textContent = Math.round(totalHours);
    document.getElementById('completed-tasks').textContent = completedTasks;
    document.getElementById('completed-hours').textContent = Math.round(completedHours);

    // Calcular y mostrar progreso general
    const progressPercentage = totalHours > 0 ? (completedHours / totalHours) * 100 : 0;
    document.getElementById('overall-progress').style.width = progressPercentage + '%';
    document.getElementById('progress-text').textContent = Math.round(progressPercentage) + '%';

    // Calcular y mostrar fechas del proyecto
    const projectStartDate = data.startDate && typeof data.startDate.toDate === 'function' ?
        data.startDate.toDate() : new Date(data.startDate);

    let projectEndDate = new Date(projectStartDate);
    let durationDays = 0;

    if (data.phases && data.phases.length > 0) {
        const lastPhase = data.phases[data.phases.length - 1];
        if (lastPhase.tasks && lastPhase.tasks.length > 0) {
            const lastTask = lastPhase.tasks[lastPhase.tasks.length - 1];
            if (lastTask.endDate) {
                projectEndDate = lastTask.endDate && typeof lastTask.endDate.toDate === 'function' ?
                    lastTask.endDate.toDate() : new Date(lastTask.endDate);
                durationDays = Math.ceil((projectEndDate - projectStartDate) / (1000 * 60 * 60 * 24));
            }
        }
    }

    document.getElementById('project-end-date').textContent = safeDateFormatForDisplay(projectEndDate);
    document.getElementById('project-duration').textContent = durationDays;
    document.getElementById('project-last-update').textContent = data.lastUpdated && typeof data.lastUpdated.toDate === 'function' ?
        data.lastUpdated.toDate().toLocaleString() : (data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A');

    // --- Renderizar Fases y Tareas ---
    const phasesContainer = document.getElementById('phases-container');
    phasesContainer.innerHTML = ''; // Limpiar contenido estático

    // Contador global de tareas para numeración
    let globalTaskNumber = 1;

    if (data.phases && Array.isArray(data.phases)) {
        data.phases.forEach((phase, index) => {
            const phaseEl = document.createElement('div');
            phaseEl.className = 'phase';

            let tasksHtml = '';

            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.forEach((task, taskIndex) => {
                    const isMilestone = task.isMilestone || task.esHito || false;
                    const isCompleted = task.completed || false;
                    const startTime = task.startTime || '';
                    const endTime = task.endTime || '';

                    // Obtener fechas formateadas de manera segura
                    const startDateStr = safeDateFormatForDisplay(task.startDate);
                    const endDateStr = safeDateFormatForDisplay(task.endDate);

                    // Obtener información de completado formateada
                    let completedInfo = '';
                    if (isCompleted && task.completedBy) {
                        const completedDate = safeDateFormatForDisplay(task.completedAt);
                        const completedTime = task.completedTime || '--:--';
                        completedInfo = '<div class="task-completed-info">✓ Completada por ' + task.completedBy + ' el ' + completedDate + ' a las ' + completedTime + '</div>';
                    }

                    tasksHtml +=
                        '<div class="task ' + (isMilestone ? 'milestone' : '') + (isCompleted ? ' completed' : '') + '" data-task-index="' + taskIndex + '" data-phase-index="' + index + '">' +
                            '<div class="task-content">' +
                                '<div class="task-left">' +
                                    '<input type="checkbox" class="task-checkbox" data-task-index="' + taskIndex + '" data-phase-index="' + index + '" ' + (isCompleted ? 'checked' : '') + '>' +
                                    '<div class="task-name">' + globalTaskNumber + '. ' + (task.name || 'Tarea sin nombre') + (isMilestone ? ' 🎯' : '') + '</div>' +
                                '</div>' +
                                '<div class="task-right">' +
                                    '<div class="task-details">' +
                                        '<span class="task-hours">' + (task.durationHours || 0) + 'h</span>' +
                                    '</div>' +
                                    '<div class="task-times-enhanced">' +
                                        '<div class="time-row">' +
                                            '<span class="time-label">Inicio:</span>' +
                                            '<span class="time-value">' + startDateStr + ' ' + (startTime || '--:--') + '</span>' +
                                        '</div>' +
                                        '<div class="time-row">' +
                                            '<span class="time-label">Fin:</span>' +
                                            '<span class="time-value">' + endDateStr + ' ' + (endTime || '--:--') + '</span>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            completedInfo +
                        '</div>';

                    // Incrementar el contador global de tareas
                    globalTaskNumber++;
                });
            }

            phaseEl.innerHTML = `
                <div class="phase-header phase${(index % 4) + 1}" data-phase-index="${index}">
                    <div class="phase-number">${index + 1}</div>
                    <div class="phase-title">${phase.name || 'Fase ' + (index + 1)}</div>
                    <div class="phase-toggle">▼</div>
                </div>
                <div class="tasks-timeline">${tasksHtml}</div>
            `;
            phasesContainer.appendChild(phaseEl);
        });
    }

    // Configurar interacciones de fases
    setupPhaseInteractions();

    // Configurar checkboxes de tareas
    setupTaskCheckboxes(data);

    // --- Renderizar componentes adicionales ---
    renderCalendar(data);
    setupCalendarInteractions(data);
    renderSCurve(data);
    renderGantt(data);

    // Configurar funcionalidades
    setTimeout(() => setupDateRecalculation(data), 0);
    setupHolidaysFunctionality(data);
    setupBackToProjectsFunctionality();
    setupLogoutFunctionality();

    console.log('Proyecto renderizado exitosamente');
}


// Función para configurar interacciones de fases
function setupPhaseInteractions() {
    document.querySelectorAll('.phase-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const phaseEl = header.parentElement;
            const isCollapsed = phaseEl.classList.contains('collapsed');

            if (isCollapsed) {
                phaseEl.classList.remove('collapsed');
                header.classList.remove('collapsed');
            } else {
                phaseEl.classList.add('collapsed');
                header.classList.add('collapsed');
            }
        });

        // Doble clic para colapsar/expandir todas las fases
        header.addEventListener('dblclick', (e) => {
            e.preventDefault();

            const allPhases = document.querySelectorAll('.phase');
            const allCollapsed = Array.from(allPhases).every(phase => phase.classList.contains('collapsed'));

            if (allCollapsed) {
                // Expandir todas las fases
                allPhases.forEach(phase => {
                    phase.classList.remove('collapsed');
                    const header = phase.querySelector('.phase-header');
                    if (header) {
                        header.classList.remove('collapsed');
                    }
                });
            } else {
                // Colapsar todas las fases
                allPhases.forEach(phase => {
                    phase.classList.add('collapsed');
                    const header = phase.querySelector('.phase-header');
                    if (header) {
                        header.classList.add('collapsed');
                    }
                });
            }
        });
    });
}

// Función para configurar checkboxes de tareas
async function setupTaskCheckboxes(data) {
    const userRole = await getCurrentUserRole();
    const isAdmin = userRole === 'admin';

    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        // Evitar agregar listeners duplicados
        if (checkbox.hasAttribute('data-listener-attached')) {
            return;
        }
        checkbox.setAttribute('data-listener-attached', 'true');

        const taskIndex = parseInt(checkbox.dataset.taskIndex);
        const phaseIndex = parseInt(checkbox.dataset.phaseIndex);
        const task = data.phases[phaseIndex]?.tasks[taskIndex];
        const isCompleted = task?.completed || false;

        // Deshabilitar checkboxes de tareas completadas para usuarios no admin
        if (isCompleted && !isAdmin) {
            checkbox.disabled = true;
            checkbox.style.opacity = '0.5';
            checkbox.title = 'Solo los administradores pueden desmarcar tareas completadas';
        }

        checkbox.addEventListener('change', async (e) => {
            const isCompletedNow = e.target.checked;

            // Obtener el usuario actual al inicio del handler
            const user = firebase.auth().currentUser;

            // Verificar permisos para desmarcar tareas completadas
            if (!isCompletedNow) {
                if (!isAdmin) {
                    alert('Solo los administradores pueden desmarcar tareas completadas.');
                    e.target.checked = true; // Mantener marcado
                    return;
                }
            }

            // Aplicar/remover clase visual inmediatamente
            const taskElement = e.target.closest('.task');
            if (isCompletedNow) {
                taskElement.classList.add('completed');
            } else {
                taskElement.classList.remove('completed');
            }

            try {
                // Actualizar el estado de la tarea en los datos locales
                if (data.phases && data.phases[phaseIndex] && data.phases[phaseIndex].tasks && data.phases[phaseIndex].tasks[taskIndex]) {
                    const task = data.phases[phaseIndex].tasks[taskIndex];
                    task.completed = isCompletedNow;

                    if (isCompletedNow) {
                        // Guardar información de completado
                        task.completedBy = user ? user.email : 'Usuario desconocido';
                        task.completedAt = firebase.firestore.Timestamp.now();
                        task.completedTime = new Date().toLocaleTimeString('es-ES', {
                            hour: '2-digit',
                            minute: '2-digit'
                        });

                        // Si se marca como completada y no tiene fecha de fin, asignar fecha actual
                        if (!task.endDate) {
                            task.endDate = firebase.firestore.Timestamp.now();
                        }
                    } else {
                        // Limpiar información de completado al desmarcar
                        delete task.completedBy;
                        delete task.completedAt;
                        delete task.completedTime;
                    }
                }

                // Guardar el proyecto usando la función helper
                await saveProject(data);

                // Enviar notificación de tarea completada si se marcó como completada
                if (isCompletedNow) {
                    try {
                        await notificationService.notifyTaskCompleted(currentProjectData, task, user);
                        console.log('Notificación de tarea completada enviada exitosamente');
                    } catch (notificationError) {
                        console.error('Error al enviar notificación de tarea completada:', notificationError);
                        // No mostrar error al usuario ya que la tarea se guardó correctamente
                    }
                }

                // Actualizar la visualización de la información de completado
                updateTaskCompletedInfo(taskElement, data.phases[phaseIndex].tasks[taskIndex]);

                // Recalcular y actualizar las estadísticas
                updateProgressStats(data);

                // Actualizar calendario y métricas de curva S (más eficiente que volver a renderizar toda la gráfica)
                renderCalendar(data);
                setupCalendarInteractions(data);
                updateSCurveMetrics(data);
                renderGantt(data);

            } catch (error) {
                console.error('Error al actualizar el estado de la tarea:', error);
                // Revertir el cambio del checkbox en caso de error
                e.target.checked = !isCompletedNow;
                // Revertir también la clase visual
                if (isCompletedNow) {
                    taskElement.classList.remove('completed');
                } else {
                    taskElement.classList.add('completed');
                }
                alert('Error al guardar el cambio. Inténtalo de nuevo.');
            }
        });
    });
}

// Función para actualizar la información de completado de una tarea
function updateTaskCompletedInfo(taskElement, task) {
    // Remover información anterior si existe
    const existingInfo = taskElement.querySelector('.task-completed-info');
    if (existingInfo) {
        existingInfo.remove();
    }

    // Agregar nueva información si la tarea está completada
    if (task.completed && task.completedBy) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'task-completed-info';
        infoDiv.textContent = `✓ Completada por ${task.completedBy} el ${safeDateFormatForDisplay(task.completedAt)} a las ${task.completedTime || '--:--'}`;
        taskElement.appendChild(infoDiv);
    }
}

// =========== FUNCIONES AUXILIARES ===========

// Función para sanitizar holidays
function sanitizeHolidays(holidays) {
    if (!Array.isArray(holidays)) return [];
    return holidays.filter(h => h && typeof h.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.date.trim())).map(h => ({
        date: h.date.trim(),
        name: (h.name || '').trim()
    }));
}

// Normaliza y valida una tarea para asegurar fechas y horas válidas
function normalizeTask(raw) {
    function toDate(val) {
        if (!val) return null;
        if (val instanceof Date) return val;
        if (typeof val.toDate === 'function') return val.toDate();
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    const startDate = toDate(raw.startDate);
    const endDate = toDate(raw.endDate);
    const startTime = typeof raw.startTime === 'string' && /^\d{2}:\d{2}$/.test(raw.startTime) ? raw.startTime : '--:--';
    const endTime = typeof raw.endTime === 'string' && /^\d{2}:\d{2}$/.test(raw.endTime) ? raw.endTime : '--:--';
    return {
        ...raw,
        startDate,
        endDate,
        startTime,
        endTime
    };
}

// Convierte un string o Date a yyyy-MM-dd para input type=date
function formatDateForInput(date) {
    if (!date) return '';
    if (typeof date === 'string') date = new Date(date);
    if (typeof date.toDate === 'function') date = date.toDate();
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Parsea un string yyyy-MM-dd o Date a Date
function parseHolidayDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        // Si ya es formato yyyy-MM-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            const [y, m, d] = val.split('-');
            return new Date(Number(y), Number(m) - 1, Number(d));
        }
        // Si es otro formato, intentar parsear
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

// Verifica si una fecha es día laborable considerando sábados, domingos y holidays
function isWorkDay(date, options) {
    const { skipSaturday, skipSunday, holidays } = options;
    const day = date.getDay();

    if (skipSunday && day === 0) return false;
    if (skipSaturday && day === 6) return false;

    if (holidays && holidays.length > 0) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const dayOfMonth = date.getDate().toString().padStart(2, '0');
        const dateString = `${year}-${month}-${dayOfMonth}`;

        if (holidays.some(h => h.date === dateString)) {
            return false;
        }
    }

    return true;
}

// Crea un Date desde un input de tipo date (yyyy-MM-dd)
function createDateFromInput(dateString) {
    if (!dateString) return null;
    return new Date(dateString + 'T00:00:00');
}

// Calcula todas las fechas de tareas del proyecto
function calculateAllTaskDates(projectData) {
    const options = projectData.settings;

    const shiftStartTime = projectData.shiftStartTime || '09:00';
    const [shiftStartHour, shiftStartMin] = shiftStartTime.split(':').map(Number);
    const shiftEndTime = projectData.shiftEndTime || '18:00';
    const [shiftEndHour, shiftEndMin] = shiftEndTime.split(':').map(Number);
    const shiftBreakHours = projectData.shiftBreakHours || 1;
    const shiftBreakStartTime = projectData.shiftBreakStartTime || '13:00';
    const [shiftBreakStartHour, shiftBreakStartMin] = shiftBreakStartTime.split(':').map(Number);
    const shiftBreakEndHour = shiftBreakStartHour + shiftBreakHours;
    const shiftBreakEndMin = shiftBreakStartMin;

    options.shiftStartHour = shiftStartHour;
    options.shiftEndHour = shiftEndHour;
    options.shiftBreakHours = shiftBreakHours;
    options.shiftBreakStartHour = shiftBreakStartHour;
    options.shiftBreakStartMin = shiftBreakStartMin;
    options.shiftBreakEndHour = shiftBreakEndHour;
    options.shiftBreakEndMin = shiftBreakEndMin;
    options.holidays = sanitizeHolidays(options.holidays || []);

    let lastEndDate = moveToNextWorkableMoment(new Date(projectData.startDate.toDate ? projectData.startDate.toDate() : projectData.startDate), options);

    projectData.phases.forEach(phase => {
        phase.tasks.forEach(task => {
            const taskStartDate = new Date(lastEndDate);
            task.startDate = firebase.firestore.Timestamp.fromDate(taskStartDate);
            task.startTime = taskStartDate.getHours().toString().padStart(2, '0') + ':' + taskStartDate.getMinutes().toString().padStart(2, '0');

            const taskEndDate = getEndDate(new Date(taskStartDate), task.durationHours, options);
            task.endDate = firebase.firestore.Timestamp.fromDate(taskEndDate);
            task.endTime = taskEndDate.getHours().toString().padStart(2, '0') + ':' + taskEndDate.getMinutes().toString().padStart(2, '0');

            lastEndDate = taskEndDate;
        });
    });
}

// Mueve una fecha al siguiente momento laborable
function moveToNextWorkableMoment(date, options) {
    let newDate = new Date(date);

    if (newDate.getHours() >= (options.shiftEndHour - options.shiftBreakHours)) {
        newDate.setDate(newDate.getDate() + 1);
        newDate.setHours(options.shiftStartHour, 0, 0, 0);
    }

    while (!isWorkDay(newDate, options)) {
        newDate.setDate(newDate.getDate() + 1);
        newDate.setHours(options.shiftStartHour, 0, 0, 0);
    }

    if (newDate.getHours() < options.shiftStartHour) {
        newDate.setHours(options.shiftStartHour, 0, 0, 0);
    }

    if ((newDate.getHours() > options.shiftBreakStartHour || (newDate.getHours() === options.shiftBreakStartHour && newDate.getMinutes() >= options.shiftBreakStartMin)) &&
        (newDate.getHours() < options.shiftBreakEndHour || (newDate.getHours() === options.shiftBreakEndHour && newDate.getMinutes() < options.shiftBreakEndMin))) {
        newDate.setHours(options.shiftBreakEndHour, options.shiftBreakEndMin, 0, 0);
    }

    return newDate;
}

// Calcula la fecha de fin de una tarea basada en duración y opciones
function getEndDate(startDate, durationHours, options) {
    const duration = Number(durationHours);
    if (!isFinite(duration) || duration < 0) {
        return new Date(startDate);
    }

    if (duration === 0) {
        return new Date(startDate);
    }

    let remainingMinutes = Math.round(duration * 60);
    let currentDate = new Date(startDate);

    while (remainingMinutes > 0) {
        currentDate = moveToNextWorkableMoment(currentDate, options);

        const currentHour = currentDate.getHours();
        const currentMinute = currentDate.getMinutes();
        const effectiveEndHour = options.shiftEndHour;
        let minutesLeftInDay = (effectiveEndHour - currentHour) * 60 - currentMinute;

        if (currentHour < options.shiftBreakStartHour && options.shiftBreakEndHour < effectiveEndHour) {
            minutesLeftInDay -= options.shiftBreakHours * 60;
        }

        if (currentHour >= options.shiftBreakStartHour && currentHour < options.shiftBreakEndHour) {
            minutesLeftInDay = 0;
        }

        if (minutesLeftInDay <= 0) {
            currentDate.setDate(currentDate.getDate() + 1);
            currentDate.setHours(options.shiftStartHour, 0, 0, 0);
            continue;
        }

        const minutesToConsume = Math.min(remainingMinutes, minutesLeftInDay);
        currentDate.setMinutes(currentMinute + minutesToConsume);
        remainingMinutes -= minutesToConsume;
    }

    return currentDate;
}


    // Variable global para almacenar los datos del proyecto
    let currentProjectData = null;
    document.addEventListener('DOMContentLoaded', async function() {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('id');
        const autoDownload = params.get('download');
        const container = document.getElementById('project-container');

        if (!projectId) {
            container.innerHTML = '<h1>Error: No se especificó un ID de proyecto.</h1>';
            return;
        }

        try {
            const docRef = db.collection('projects').doc(projectId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                container.innerHTML = `<h1>Error: No se encontró el proyecto con ID ${projectId}.</h1>`;
                return;
            }

            const projectData = docSnap.data();
            projectData.id = projectId; // Agregar el ID del proyecto a los datos
            currentProjectData = projectData; // Guardar en variable global
            console.log('Datos cargados desde Firebase:', projectData);
            renderProject(projectData, autoDownload, projectId);

        } catch (error) {
            console.error("Error al cargar el proyecto:", error);
            container.innerHTML = '<h1>Error al cargar el proyecto. Revise la consola.</h1>';
        }
    });