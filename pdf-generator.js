/**
 * Módulo para la generación de reportes PDF de proyectos.
 * Versión 4.0 - Refactorización a Clase y Desacoplamiento del DOM.
 *
 * Esta versión encapsula toda la lógica en la clase `ProjectPDFGenerator`,
 * eliminando la dependencia directa del DOM para la obtención de datos.
 * Ahora, todos los cálculos se realizan a partir del objeto `projectData`,
 * lo que hace al módulo más robusto, reutilizable y fácil de mantener.
 * Utiliza jsPDF y html2canvas para crear resúmenes de proyectos.
 */

// Paleta de colores centralizada para consistencia visual.
const PDF_COLORS = {
    primary: '#003366', // Azul oscuro
    secondary: '#4A90E2', // Azul claro
    accentGreen: '#28a745',
    accentOrange: '#f5a623',
    accentRed: '#d0021b',
    text: '#333333',
    lightText: '#666666',
    background: '#F8F9FA',
    border: '#DEE2E6'
};

/**
 * Orquesta la generación y exportación del PDF.
 * Esta función actúa como el punto de entrada, gestionando la obtención de datos,
 * la actualización de la UI (necesaria para la captura de gráficos) y la
 * ejecución del generador de PDF.
 *
 * @param {string} projectId - El ID del proyecto en Firestore.
 * @param {object} db - La instancia de la base de datos de Firestore.
 */
async function exportProjectToPDF(projectId, db) {
    console.log(`Iniciando la exportación de PDF para el proyecto: ${projectId}`);
    showPDFLoader(true);

    try {
        // 1. Obtener los datos frescos del proyecto desde Firestore.
        const projectDoc = await db.collection('projects').doc(projectId).get();
        if (!projectDoc.exists) {
            throw new Error('El proyecto no fue encontrado en la base de datos.');
        }
        const projectData = projectDoc.data();

        // 2. Asegurar que los gráficos en la UI estén renderizados antes de capturarlos.
        // Este es el único punto de acoplamiento necesario con la vista, para que html2canvas funcione.
        if (typeof window.updateSCurveMetrics === 'function') {
            window.updateSCurveMetrics(projectData);
        }
        // Dar un pequeño respiro al navegador para que renderice el canvas del gráfico.
        await new Promise(resolve => setTimeout(resolve, 500));

        // 3. Instanciar y ejecutar el generador de PDF.
        const generator = new ProjectPDFGenerator(window.jsPDF, window.html2canvas);
        await generator.generate(projectData);

        console.log('PDF generado y descargado exitosamente.');

    } catch (error) {
        console.error('Error al generar el PDF:', error);
        alert(`Ocurrió un error al generar el resumen en PDF: ${error.message}`);
    } finally {
        showPDFLoader(false); // Ocultar el loader en cualquier caso.
    }
}


/**
 * Clase que encapsula toda la lógica para la creación de un reporte de proyecto en PDF.
 */
class ProjectPDFGenerator {
    constructor(jsPDF, html2canvas) {
        this.jsPDF = jsPDF;
        this.html2canvas = html2canvas;
        this.doc = null;
        this.projectData = null;
        this.yPos = 0;
        this.pageWidth = 0;
        this.pageHeight = 0;
    }

    /**
     * Método principal que genera el documento PDF completo.
     * @param {object} projectData - Los datos del proyecto obtenidos de Firestore.
     */
    async generate(projectData) {
        this.projectData = projectData;
        this.doc = new this.jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'letter'
        });

        this.pageWidth = this.doc.internal.pageSize.getWidth();
        this.pageHeight = this.doc.internal.pageSize.getHeight();

        // Construir cada sección del PDF en orden.
        await this._buildHeaderAndMetrics();
        this._buildStatusSection();
        this._buildHighlightsSection();
        
        this._buildPhaseSummarySection();

        this._addPageIfNecessary(120); // Espacio para los gráficos.
        
        await this._buildChartsSection();

        // Finalizar añadiendo encabezados y pies de página a todas las páginas.
        this._addHeaderAndFooter();

        // Guardar el archivo.
        const projectName = this.projectData.projectName || 'Proyecto_sin_nombre';
        const fileName = `Resumen_${projectName.replace(/\s/g, '_')}.pdf`;
        this.doc.save(fileName);
    }

    // --- MÉTODOS DE CONSTRUCCIÓN DE SECCIONES ---

    async _buildHeaderAndMetrics() {
        this.yPos = 15;

        // Logo y Título
        const logo = new Image();
        logo.src = 'logo_2025web.png'; // Asegúrate que la ruta sea correcta
        await new Promise(resolve => { logo.onload = resolve; });
        this.doc.addImage(logo, 'PNG', this.pageWidth / 2 - 20, this.yPos, 40, 30);
        this.yPos += 35;

        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(18);
        this.doc.setTextColor(PDF_COLORS.primary);
        this.doc.text(this.projectData.projectName || 'Proyecto sin nombre', this.pageWidth / 2, this.yPos, { align: 'center' });
        this.yPos += 10;

        // Métricas de progreso (calculadas desde los datos)
        const metrics = this._calculateProgressMetrics();
        this._drawMetricBoxes(metrics, this.yPos);
        this.yPos += 25;
    }

        _buildStatusSection() {
            this._drawSectionHeader('¿En qué estamos trabajando?', this.yPos);
            this.yPos += 10;
    
            // 1. Definir el layout de 3 columnas
            const pageContentWidth = this.pageWidth - 30; // 15mm de margen a cada lado
            const gap = 3;
            const columnWidth = (pageContentWidth - (gap * 2)) / 3;
    
            const x1 = 15;
            const x2 = x1 + columnWidth + gap;
            const x3 = x2 + columnWidth + gap;
    
            // 2. Obtener los datos a dibujar
            const highlights = this._getTaskHighlights();
            const advancedMetrics = this._calculateAdvancedMetrics();
    
            // 3. Dibujar las tres columnas
                    this._drawInfoCard(
                        'En Progreso',
                        highlights.currentTask,
                        PDF_COLORS.accentOrange,
                        x1, this.yPos, columnWidth
                    );
            
                    this._drawInfoCard(
                        'Último Completado',
                        highlights.lastCompletedTask,
                        PDF_COLORS.accentGreen,
                        x2, this.yPos, columnWidth
                    );            
            this._drawAdvancedStatusMetrics(advancedMetrics, x3, this.yPos);
    
            this.yPos += 65; // Mantener espacio vertical suficiente para la sección, ajustado para optimización
        }
    _buildHighlightsSection() {
        this._drawSectionHeader('Hitos Clave del Proyecto', this.yPos);
        this.yPos += 10;
        const highlights = this._getTaskHighlights();
        this._drawHighlights(highlights, this.yPos);
        this.yPos += 25;
    }

    _buildPhaseSummarySection() {
        this._drawSectionHeader('Estado General de Fases', this.yPos);
        this.yPos += 10;
        this._drawPhaseSummary(this.yPos);
        this.yPos = this.doc.lastAutoTable.finalY + 15;
    }

    async _buildChartsSection() {
        this._drawSectionHeader('Rendimiento del Proyecto', this.yPos);
        this.yPos += 10;

        const sCurveCanvasImage = await this._captureElementAsImage('s-curve-chart');
        if (sCurveCanvasImage) {
            this.doc.addImage(sCurveCanvasImage, 'PNG', 15, this.yPos, 180, 80);
            this.yPos += 90;
        }

        this._addPageIfNecessary(90);

        const ganttCanvasImage = await this._captureElementAsImage('gantt-chart-container');
        if (ganttCanvasImage) {
            this._drawSectionHeader('Diagrama de Gantt', this.yPos);
            this.yPos += 10;
            this.doc.addImage(ganttCanvasImage, 'PNG', 15, this.yPos, 180, 80);
            this.yPos += 90;
        }
    }

    // --- MÉTODOS DE DIBUJO Y ESTILO ---

    _addHeaderAndFooter() {
        const pageCount = this.doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            this.doc.setPage(i);
            // Encabezado
            this.doc.setFontSize(10);
            this.doc.setTextColor(PDF_COLORS.lightText);
            this.doc.text(this.projectData.projectName, 15, 10);
            this.doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, this.pageWidth - 15, 10, { align: 'right' });
            this.doc.setDrawColor(PDF_COLORS.border);
            this.doc.line(15, 12, this.pageWidth - 15, 12);

            // Pie de página
            this.doc.text(`Página ${i} de ${pageCount}`, this.pageWidth / 2, this.pageHeight - 10, { align: 'center' });
        }
    }

    _addPageIfNecessary(requiredHeight) {
        if (this.yPos + requiredHeight > this.pageHeight - 20) {
            this.doc.addPage();
            this.yPos = 20;
        }
    }

    async _captureElementAsImage(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return null;
        try {
            const canvas = await this.html2canvas(element, { scale: 2, useCORS: true });
            return canvas.toDataURL('image/png');
        } catch (error) {
            console.error(`Error capturando el elemento ${elementId}:`, error);
            return null;
        }
    }

    _drawSectionHeader(title, y) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(14);
        this.doc.setTextColor(PDF_COLORS.primary);
        this.doc.text(title, 15, y);
        this.doc.setDrawColor(PDF_COLORS.border);
        this.doc.line(15, y + 2, this.pageWidth - 15, y + 2);
    }

    _drawMetricBoxes(metrics, y) {
        const boxWidth = 35;
        const boxHeight = 20;
        const gap = 5;
        let x = 15;

        metrics.forEach(metric => {
            this.doc.setFillColor(PDF_COLORS.background);
            this.doc.setDrawColor(PDF_COLORS.border);
            this.doc.roundedRect(x, y, boxWidth, boxHeight, 3, 3, 'FD');

            this.doc.setFont('helvetica', 'bold');
            this.doc.setFontSize(14);
            this.doc.setTextColor(PDF_COLORS.primary);
            this.doc.text(metric.value.toString(), x + boxWidth / 2, y + 11, { align: 'center' });

            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(8);
            this.doc.setTextColor(PDF_COLORS.lightText);
            this.doc.text(metric.label, x + boxWidth / 2, y + 17, { align: 'center' });

            x += boxWidth + gap;
        });
    }

    _drawInfoCard(title, task, color, x, y, width) {
        const cardHeight = 35; // Altura para la nueva información
        const text = task ? task.name : 'Ninguna';

        this.doc.setFillColor(color);
        this.doc.roundedRect(x, y, width, cardHeight, 3, 3, 'F');
        
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(9);
        this.doc.setTextColor('#FFFFFF');
        this.doc.text(title, x + width / 2, y + 5, { align: 'center' });
        
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(8);
        this.doc.text(this.doc.splitTextToSize(text, width - 8), x + 4, y + 12);

        // Añadir leyenda de fechas si la tarea existe
        if (task) {
            const formatDate = (dateValue) => {
                const d = this._parseDate(dateValue);
                if (!d) return 'N/A';
                // Formato dd/mm hh:mm
                return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            };

            let dateText = '';
            if (title === 'En Progreso') {
                dateText = `Inicio: ${formatDate(task.startDate)} - Fin: ${formatDate(task.endDate)}`;
            } else if (title === 'Último Completado') {
                // Para las tareas completadas, mostrar Fin Planificado y Fin Real
                dateText = `Fin Plan: ${formatDate(task.endDate)} - Fin Real: ${formatDate(task.completedAt)}`;
            }

            this.doc.setFont('helvetica', 'italic');
            this.doc.setFontSize(7);
            this.doc.setTextColor('#FFFFFF');
            this.doc.text(dateText, x + width / 2, y + cardHeight - 6, { align: 'center' });
        }
    }

    _drawAdvancedStatusMetrics(metrics, x, y) {
        const {
            scheduleStatus, scheduleVariance,
            performanceStatus, spi,
            projectStatus,
            projectHasStarted
        } = metrics;

        const initialX = x;
        const cardWidth = 60; // Ancho ajustado para layout de 3 columnas
        const cardHeight = 18;
        const gap = 2;
        let currentY = y;

        const drawMetricCard = (title, status, value, color) => {
            this.doc.setFillColor(PDF_COLORS.background);
            this.doc.setDrawColor(PDF_COLORS.border);
            this.doc.roundedRect(initialX, currentY, cardWidth, cardHeight, 3, 3, 'FD');

            // Traffic light circle
            this.doc.setFillColor(color);
            this.doc.circle(initialX + 8, currentY + cardHeight / 2, 3, 'F');

            // Title
            this.doc.setFont('arial', 'bold');
            this.doc.setFontSize(9);
            this.doc.setTextColor(PDF_COLORS.text);
            this.doc.text(title, initialX + 20, currentY + 5);

            // Status and Value
            this.doc.setFont('arial', 'normal');
            this.doc.setFontSize(9);
            this.doc.setTextColor(color);
            this.doc.text(status, initialX + 20, currentY + 11);
            
            this.doc.setFontSize(8);
            this.doc.setTextColor(PDF_COLORS.lightText);
            this.doc.text(value, initialX + 20, currentY + 15);

            currentY += cardHeight + gap;
        };

        // --- Definición de colores basada en la nueva lógica ---

        let scheduleColor, perfColor, statusColor;

        if (!projectHasStarted) {
            scheduleColor = perfColor = statusColor = PDF_COLORS.lightText;
        } else {
            // 1. Color para Variación de Cronograma (SV)
            const roundedScheduleVariance = Math.round(scheduleVariance);
            if (roundedScheduleVariance >= 0) {
                scheduleColor = PDF_COLORS.accentGreen;
            } else if (roundedScheduleVariance > -10) { // De -1% a -9%
                scheduleColor = PDF_COLORS.accentOrange;
            } else { // -10% o peor
                scheduleColor = PDF_COLORS.accentRed;
            }

            // 2. Color para Índice de Rendimiento (SPI)
            if (spi >= 1.0) {
                perfColor = PDF_COLORS.accentGreen;
            } else if (spi >= 0.9 && spi < 1.0) {
                perfColor = PDF_COLORS.accentOrange;
            } else { // Menor a 0.9
                perfColor = PDF_COLORS.accentRed;
            }

            // 3. Color para Estado del Proyecto (basado en los otros dos)
            if (scheduleColor === PDF_COLORS.accentRed || perfColor === PDF_COLORS.accentRed) {
                statusColor = PDF_COLORS.accentRed;
            } else if (scheduleColor === PDF_COLORS.accentOrange || perfColor === PDF_COLORS.accentOrange) {
                statusColor = PDF_COLORS.accentOrange;
            } else {
                statusColor = PDF_COLORS.accentGreen;
            }
        }

        // --- Dibujo de las tarjetas ---

        drawMetricCard(
            'Variación de Cronograma',
            scheduleStatus,
            projectHasStarted ? `(${(scheduleVariance > 0 ? '+' : '')}${scheduleVariance.toFixed(0)}%)` : '',
            scheduleColor
        );

        drawMetricCard(
            'Índice de Rendimiento',
            performanceStatus,
            projectHasStarted ? `(SPI: ${spi.toFixed(2)})` : '',
            perfColor
        );

        drawMetricCard(
            'Estado del Proyecto',
            projectStatus,
            '',
            statusColor
        );
    }

    _drawHighlights({ currentTask, lastCompletedTask, nextMilestone }, y) {
        const colWidth = (this.pageWidth - 40) / 3;
        let x = 15;

        // Tarea Actual
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(10);
        this.doc.setTextColor(PDF_COLORS.primary);
        this.doc.text('Tarea Actual', x, y);
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(9);
        this.doc.setTextColor(PDF_COLORS.text);
        const currentText = currentTask ? `${currentTask.name} (${currentTask.durationHours || 0}h)` : 'N/A';
        this.doc.text(this.doc.splitTextToSize(currentText, colWidth), x, y + 5);

        x += colWidth + 5;

        // Última Tarea Completada
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(10);
        this.doc.text('Última Completada', x, y);
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(9);
        const completedText = lastCompletedTask ? `${lastCompletedTask.name}` : 'N/A';
        this.doc.text(this.doc.splitTextToSize(completedText, colWidth), x, y + 5);
        if (lastCompletedTask) {
            const onTime = this._isTaskOnTime(lastCompletedTask);
            this.doc.setTextColor(onTime ? PDF_COLORS.accentGreen : PDF_COLORS.accentRed);
            this.doc.text(onTime ? 'Completada a tiempo' : 'Completada con retraso', x, y + 15);
        }

        x += colWidth + 5;

        // Próximo Hito
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(10);
        this.doc.setTextColor(PDF_COLORS.primary);
        this.doc.text('Próximo Hito', x, y);
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(9);
        this.doc.setTextColor(PDF_COLORS.text);
        const milestoneText = nextMilestone ? `${nextMilestone.name}` : 'N/A';
        this.doc.text(this.doc.splitTextToSize(milestoneText, colWidth), x, y + 5);
        if (nextMilestone) {
            const daysToStart = this._getDaysUntil(nextMilestone.startDate);
            this.doc.setTextColor(PDF_COLORS.lightText);
            this.doc.text(`Inicia en ${daysToStart} días`, x, y + 15);
        }
    }

    _drawPhaseSummary(y) {
        const head = [['Fase', 'Tareas', 'Horas', 'Progreso']];
        const body = (this.projectData.phases || []).map(phase => {
            const tasks = phase.tasks || [];
            const totalTasks = tasks.length;
            const totalHours = tasks.reduce((sum, task) => sum + (Number(task.durationHours) || 0), 0);
            const phaseProgress = this._calculatePhaseProgress(tasks);

            return [
                phase.name || phase.phaseName || 'Fase sin nombre',
                totalTasks,
                Math.round(totalHours),
                `${phaseProgress.toFixed(0)}%`
            ];
        });

        this.doc.autoTable({
            startY: y,
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: PDF_COLORS.primary }
        });
    }

    // --- MÉTODOS DE CÁLCULO (LÓGICA DE NEGOCIO) ---

    _calculateProgressMetrics() {
        let totalTasks = 0;
        let completedTasks = 0;
        let totalHours = 0;
        let completedHours = 0;

        (this.projectData.phases || []).forEach(phase => {
            (phase.tasks || []).forEach(task => {
                totalTasks++;
                const hours = Number(task.durationHours) || 0;
                totalHours += hours;
                if (task.completed) {
                    completedTasks++;
                    completedHours += hours;
                }
            });
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
        const allTasks = this._getAllTasks().filter(t => t.startDate).sort((a, b) => {
            const aDate = this._parseDate(a.endDate || a.startDate);
            const bDate = this._parseDate(b.endDate || b.startDate);
            return aDate - bDate;
        });

        if (allTasks.length === 0) return this._getDefaultMetrics();

        const projectStart = this._parseDate(this.projectData.startDate);
        const projectEnd = allTasks.length > 0 ? this._parseDate(allTasks[allTasks.length - 1].endDate) : new Date();

        if (!projectStart || !projectEnd) return this._getDefaultMetrics();

        const dateLabels = [];
        const currentDate = new Date(projectStart);
        while (currentDate <= projectEnd) {
            dateLabels.push(this._formatDateForInput(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const totalTasks = allTasks.length;

        // Planned % based on task count (from vistaProyecto.js)
        const plannedPercent = [];
        dateLabels.forEach(dateStr => {
            const loopDate = new Date(dateStr + 'T00:00:00');
            let tasksCompletedByDate = 0;
            allTasks.forEach(task => {
                const taskEnd = this._parseDate(task.endDate);
                if (taskEnd <= loopDate) {
                    tasksCompletedByDate++;
                }
            });
            plannedPercent.push(totalTasks > 0 ? Math.min(100, (tasksCompletedByDate / totalTasks) * 100) : 0);
        });

        // Actual % based on task count (from vistaProyecto.js)
        const actualPercent = [];
        dateLabels.forEach(dateStr => {
            const loopDate = new Date(dateStr + 'T00:00:00');
            let actualTasksCompleted = 0;
            allTasks.forEach(task => {
                if (task.completed) {
                    const taskEnd = this._parseDate(task.endDate);
                    if (taskEnd && taskEnd <= loopDate) {
                        actualTasksCompleted++;
                    }
                }
            });
            actualPercent.push(totalTasks > 0 ? Math.min(100, (actualTasksCompleted / totalTasks) * 100) : 0);
        });

        const today = new Date();
        const todayStr = this._formatDateForInput(today);
        const todayIndex = dateLabels.findIndex(dateStr => dateStr >= todayStr);
        const currentIndex = todayIndex >= 0 ? todayIndex : dateLabels.length - 1;

        const currentPlannedPct = plannedPercent[currentIndex] || 0;
        const currentActualPct = actualPercent[currentIndex] || 0;

        const projectHasStarted = today >= projectStart || allTasks.some(task => task.completed);

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
            if (currentActualPct >= 100) {
                projectStatus = 'Finalizado';
            } else if (currentActualPct > currentPlannedPct) {
                projectStatus = 'Adelantado';
            } else if (currentActualPct < currentPlannedPct) {
                projectStatus = 'Atrasado';
            }
        }

        return {
            scheduleStatus,
            scheduleVariance,
            performanceStatus,
            spi,
            projectStatus,
            projectHasStarted
        };
    }

    _getDefaultMetrics(status = 'No disponible') {
        return {
            scheduleStatus: status, scheduleVariance: 0,
            performanceStatus: status, spi: 0,
            projectStatus: status,
            projectHasStarted: false
        };
    }

    _calculatePhaseProgress(tasks = []) {
        let totalHours = 0;
        let completedHours = 0;
        (tasks || []).forEach(task => {
            const hours = Number(task.durationHours) || 0;
            totalHours += hours;
            if (task.completed) {
                completedHours += hours;
            }
        });
        return totalHours > 0 ? (completedHours / totalHours) * 100 : 0;
    }

    _getAllTasks() {
        const allTasks = [];
        (this.projectData.phases || []).forEach(phase => {
            (phase.tasks || []).forEach(task => allTasks.push({ ...task, phaseName: phase.name || phase.phaseName }));
        });
        return allTasks;
    }

    _getTaskHighlights() {
        const allTasks = this._getAllTasks();

        const sortedTasks = allTasks
            .filter(t => this._parseDate(t.startDate))
            .sort((a, b) => this._parseDate(a.startDate) - this._parseDate(b.startDate));
        
        const completedTasks = sortedTasks
            .filter(t => t.completed && this._parseDate(t.completedAt))
            .sort((a, b) => this._parseDate(b.completedAt) - this._parseDate(a.completedAt));

        const currentTask = sortedTasks.find(t => !t.completed) || null;
        const lastCompletedTask = completedTasks.length > 0 ? completedTasks[0] : null;
        const nextMilestone = sortedTasks.find(t => (t.isMilestone || t.esHito) && !t.completed);

        return { currentTask, lastCompletedTask, nextMilestone };
    }

    _isTaskOnTime(task) {
        if (!task.completed || !task.completedAt || !task.endDate) return true;
        const completedDate = this._parseDate(task.completedAt);
        const plannedEndDate = this._parseDate(task.endDate);
        return completedDate && plannedEndDate ? completedDate <= plannedEndDate : true;
    }

    _getDaysUntil(date) {
        if (!date) return 'N/A';
        const targetDate = this._parseDate(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalizar para comparar solo fechas
        const diffTime = targetDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    }

    _formatDateForInput(date) {
        if (!date) return '';
        const d = this._parseDate(date);
        if (!d) return '';
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    _parseDate(dateValue) {
        if (!dateValue) return null;
        if (dateValue instanceof Date) return dateValue;
        if (typeof dateValue.toDate === 'function') return dateValue.toDate(); // Timestamp de Firestore
        const d = new Date(dateValue);
        return isNaN(d.getTime()) ? null : d;
    }
}

// --- FUNCIÓN UTILITARIA PARA MOSTRAR LOADER ---

function showPDFLoader(show) {
    let loader = document.getElementById('pdf-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'pdf-loader';
        loader.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; padding: 20px 40px; border-radius: 8px; text-align: center; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                    <div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 15px auto;"></div>
                    Generando PDF, por favor espere...
                </div>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        document.body.appendChild(loader);
    }
    loader.style.display = show ? 'flex' : 'none';
}