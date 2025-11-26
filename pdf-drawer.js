/**
 * Módulo que encapsula las operaciones de dibujo de jsPDF
 * para crear un reporte de proyecto.
 */
class PDFDrawer {
    constructor(doc, colors) {
        this.doc = doc;
        this.COLORS = colors;
        this.pageWidth = doc.internal.pageSize.getWidth();
        this.pageHeight = doc.internal.pageSize.getHeight();
    }

    drawSectionHeader(title, y, customWidth = null) {
        const width = customWidth || this.pageWidth;
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(14);
        this.doc.setTextColor(this.COLORS.primary);
        this.doc.text(title, 15, y);
        this.doc.setDrawColor(this.COLORS.border);
        this.doc.line(15, y + 2, width - 15, y + 2);
    }

    drawMetricBoxes(metrics, y) {
        const boxWidth = 35;
        const boxHeight = 20;
        const gap = 5;
        let x = 15;

        metrics.forEach(metric => {
            this.doc.setFillColor(this.COLORS.background);
            this.doc.setDrawColor(this.COLORS.border);
            this.doc.roundedRect(x, y, boxWidth, boxHeight, 3, 3, 'FD');

            this.doc.setFont('helvetica', 'bold');
            this.doc.setFontSize(14);
            this.doc.setTextColor(this.COLORS.primary);
            this.doc.text(metric.value.toString(), x + boxWidth / 2, y + 11, { align: 'center' });

            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(8);
            this.doc.setTextColor(this.COLORS.lightText);
            this.doc.text(metric.label, x + boxWidth / 2, y + 17, { align: 'center' });

            x += boxWidth + gap;
        });
    }

    drawAdvancedStatusMetrics(metrics, x, y, containerWidth = 60) {
        const scheduleVarianceText = metrics.scheduleVariance || 'No disponible';
        const performanceIndexText = metrics.performanceIndex || 'No disponible';
        const projectStatusText = metrics.projectStatus || 'No disponible';

        const cardHeight = 18;
        const gap = 2;
        let currentY = y;

        const getColorFromStatus = (text) => {
            const lowerText = text.toLowerCase();
            if (lowerText.includes('atrasado') || lowerText.includes('bajo') || lowerText.includes('crítico')) return this.COLORS.accentRed;
            if (lowerText.includes('ligeramente')) return this.COLORS.accentOrange;
            if (lowerText.includes('adelantado') || lowerText.includes('excelente') || lowerText.includes('normal') || lowerText.includes('en tiempo') || lowerText.includes('finalizado')) return this.COLORS.accentGreen;
            return this.COLORS.lightText;
        };

        const parseMetricText = (text) => {
            const match = text.match(/^(.*?)\s*\((.*)\)$/);
            return match ? { status: match[1].trim(), value: `(${match[2].trim()})` } : { status: text, value: '' };
        };

        const drawCard = (title, status, value, color) => {
            this.doc.setFillColor(this.COLORS.background);
            this.doc.setDrawColor(this.COLORS.border);
            this.doc.roundedRect(x, currentY, containerWidth, cardHeight, 3, 3, 'FD');
            this.doc.setFillColor(color);
            this.doc.circle(x + 8, currentY + cardHeight / 2, 3, 'F');
            this.doc.setFont('helvetica', 'bold');
            this.doc.setFontSize(9);
            this.doc.setTextColor(this.COLORS.text);
            this.doc.text(title, x + 15, currentY + 5); // Acercado al círculo
            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(9);
            this.doc.setTextColor(color);
            this.doc.text(status, x + 15, currentY + 11); // Acercado al círculo
            this.doc.setFontSize(8);
            this.doc.setTextColor(this.COLORS.lightText);
            this.doc.text(value, x + 15, currentY + 15); // Acercado al círculo
            currentY += cardHeight + gap;
        };

        const svParts = parseMetricText(scheduleVarianceText);
        const spiParts = parseMetricText(performanceIndexText);

        drawCard('Variación de Cronograma', svParts.status, svParts.value, getColorFromStatus(scheduleVarianceText));
        drawCard('Índice de Rendimiento', spiParts.status, spiParts.value, getColorFromStatus(performanceIndexText));
        drawCard('Estado del Proyecto', projectStatusText, '', getColorFromStatus(projectStatusText));
    }
    
    /**
     * Dibuja una tarjeta de información para una tarea específica.
     * @param {string} title - Título de la tarjeta (ej. 'En Progreso').
     * @param {object} task - El objeto de la tarea a mostrar.
     * @param {string} color - Color de acento para la tarjeta.
     * @param {number} x - Posición X.
     * @param {number} y - Posición Y.
     * @param {number} width - Ancho de la tarjeta.
     */
    drawInfoCard(title, task, color, x, y, width) {
        const cardHeight = 58; // Altura fija para coincidir con las métricas avanzadas (18*3 + 2*2)
        const text = task ? task.name : 'Ninguna';

        this.doc.setFillColor(color);
        this.doc.roundedRect(x, y, width, cardHeight, 3, 3, 'F');
        
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(9);
        this.doc.setTextColor('#FFFFFF');
        this.doc.text(title, x + width / 2, y + 5, { align: 'center' });
        
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(8);
        this.doc.setTextColor(this.COLORS.text); // Cambiado a negro
        this.doc.text(this.doc.splitTextToSize(text, width - 8), x + 4, y + 12);

        if (task) {
            const formatDate = (dateValue) => {
                if (!dateValue) return 'N/A';
                const d = (dateValue instanceof Date) ? dateValue : (dateValue.toDate ? dateValue.toDate() : new Date(dateValue));
                if (isNaN(d.getTime())) return 'N/A';
                return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            };

            this.doc.setFont('helvetica', 'italic');
            this.doc.setFontSize(7);
            this.doc.setTextColor(this.COLORS.text); // Cambiado a negro
            
            // Lógica diferenciada para tareas en progreso vs. tareas completadas
            if (task.completed) {
                // --- TARJETA DE ÚLTIMO COMPLETADO ---
                const realEndDateStr = formatDate(task.completedAt);
                
                this.doc.setFont('helvetica', 'normal');
                this.doc.text(`Inicio Plan: ${formatDate(task.startDate)}`, x + 4, y + cardHeight - 26);
                this.doc.text(`Fin Plan:    ${formatDate(task.endDate)}`, x + 4, y + cardHeight - 20);
                this.doc.setFont('helvetica', 'bold');
                this.doc.text(`Fin Real:    ${realEndDateStr}`, x + 4, y + cardHeight - 14);

                if (task.onTimeStatus) {
                    this.doc.setFont('helvetica', 'bold');
                    this.doc.setFontSize(8);
                    const statusColor = task.onTimeStatus.color === 'green' ? this.COLORS.accentGreen : this.COLORS.accentRed;
                    this.doc.setTextColor(statusColor);
                    this.doc.text(task.onTimeStatus.text, x + 4, y + cardHeight - 6);
                }
            } else {
                // --- TARJETA DE EN PROGRESO ---
                if (task.hoursInProgress) {
                    this.doc.setFont('helvetica', 'bold');
                    this.doc.text(`En progreso: ${task.hoursInProgress}h de ${task.durationHours}h`, x + width / 2, y + cardHeight - 12, { align: 'center' });
                }
                
                this.doc.setFont('helvetica', 'bold');
                const dateText = `Inicio: ${formatDate(task.startDate)} - Fin: ${formatDate(task.endDate)}`;
                this.doc.text(dateText, x + width / 2, y + cardHeight - 6, { align: 'center' });
            }
        }
    }

    /**
     * Dibuja la sección de hitos y tareas destacadas.
     * @param {object} highlights - Objeto con { currentTask, lastCompletedTask, nextMilestone }.
     * @param {number} y - Posición Y inicial.
     */
    drawHighlights(highlights, y) {
        const { nextMilestone, recentCompletedTasks = [] } = highlights;
        const contentWidth = this.pageWidth - 30; // Margen de 15 a cada lado
        const gap = 10;
        const wideColWidth = (contentWidth - gap) * (2 / 3);
        const narrowColWidth = contentWidth - wideColWidth - gap;

        // 1. Calcular la altura necesaria para la tarjeta más alta (la de tareas recientes)
        const titleHeight = 6;
        const taskLineHeight = 6;
        const topPadding = 6;
        const bottomPadding = 2; // Reducido para compactar
        const contentHeight = recentCompletedTasks.length > 0 ? (recentCompletedTasks.length * taskLineHeight) : 6; // Altura para el texto "No hay tareas"
        let cardHeight = titleHeight + topPadding + contentHeight + bottomPadding;
        cardHeight *= 0.7; // 1. Reducir la altura total en un 30%

        let x = 15;

        // --- Tarjeta 1: Últimas Tareas Concluidas (Ancha) ---
        this.doc.setFillColor(this.COLORS.background);
        this.doc.roundedRect(x, y, wideColWidth, cardHeight, 3, 3, 'F');
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(10);
        this.doc.setTextColor(this.COLORS.primary);
        this.doc.text('Ultimas Tareas Concluidas', x + 5, y + 4); // 2. Mover título a la derecha y un poco hacia abajo

        if (recentCompletedTasks && recentCompletedTasks.length > 0) {
            let taskY = y + 10; // Ajustar posición Y inicial de la lista
            const nameX = x + 5; // 2. Mover contenido a la derecha
            const planX = x + 65;
            const cierreX = x + 90;
            const nameMaxWidth = 63;

            recentCompletedTasks.forEach(task => {
                const endDatePlan = task.endDate ? task.endDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : 'N/A';
                const endDateReal = task.completedAt ? task.completedAt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : 'N/A';
                const isOnTime = task.completedAt <= task.endDate;
                const statusColor = isOnTime ? this.COLORS.accentGreen : this.COLORS.accentRed;

                // Dibujar Nombre de Tarea
                this.doc.setFont('helvetica', 'normal');
                this.doc.setFontSize(8);
                this.doc.setTextColor(this.COLORS.text);
                const taskNameLines = this.doc.splitTextToSize(task.name, nameMaxWidth);
                this.doc.text(taskNameLines[0], nameX, taskY);

                // Dibujar Fecha Plan
                this.doc.setFont('helvetica', 'italic');
                this.doc.setFontSize(7);
                this.doc.setTextColor(this.COLORS.lightText);
                this.doc.text(`Plan: ${endDatePlan}`, planX, taskY);

                // Dibujar Fecha Cierre
                this.doc.setFont('helvetica', 'bolditalic');
                this.doc.setTextColor(statusColor);
                this.doc.text(`Cierre: ${endDateReal}`, cierreX, taskY);

                taskY += 6; // Espacio para la siguiente tarea
            });
        } else {
            this.doc.setFont('helvetica', 'italic');
            this.doc.setFontSize(9);
            this.doc.setTextColor(this.COLORS.lightText);
            this.doc.text('No hay tareas completadas recientemente.', x + 5, y + 10); // 2. Mover contenido a la derecha
        }

        // Mover la posición X para la siguiente tarjeta
        x += wideColWidth + gap;

        // --- Tarjeta 2: Próximo Hito (Estrecha) ---
        this.doc.setFillColor(this.COLORS.background);
        this.doc.roundedRect(x, y, narrowColWidth, cardHeight, 3, 3, 'F');
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(10);
        this.doc.setTextColor(this.COLORS.primary);
        this.doc.text('Próximo Hito', x + 5, y + 4); // 2. Mover título a la derecha y un poco hacia abajo

        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(9);
        this.doc.setTextColor(this.COLORS.text);
        const hitoText = nextMilestone ? `${nextMilestone.name} (${nextMilestone.durationHours || 0}h)` : 'N/A';
        this.doc.text(this.doc.splitTextToSize(hitoText, narrowColWidth - 5), x + 5, y + 10); // 2. Mover contenido a la derecha
        
        const daysToStart = nextMilestone ? Math.ceil((nextMilestone.startDate - new Date()) / (1000 * 60 * 60 * 24)) : 0;
        const subtext = nextMilestone ? `Inicia en ${Math.max(0, daysToStart)} días` : '';
        if (subtext) {
            this.doc.setFont('helvetica', 'italic');
            this.doc.setFontSize(8);
            this.doc.setTextColor(this.COLORS.lightText);
            this.doc.text(subtext, x + 5, y + 16); // 2. Mover contenido a la derecha
        }
    }

    drawTable(head, body, y) {
        this.doc.autoTable({
            startY: y,
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: this.COLORS.primary }
        });
        return this.doc.lastAutoTable.finalY;
    }
        /**
     * Dibuja las métricas de estado avanzadas en formato horizontal (tres tarjetas pequeñas).
     * @param {object} metrics - Objeto con las métricas { scheduleVariance, performanceIndex, projectStatus }.
     * @param {number} startX - Posición X inicial para el grupo de tarjetas.
     * @param {number} startY - Posición Y inicial para el grupo de tarjetas.
     * @param {number} totalAvailableWidth - Ancho total disponible para las tres tarjetas.
     */
    drawHorizontalAdvancedStatusMetrics(metrics, startX, startY, totalAvailableWidth) {
        const cardHeight = 25; // Altura de cada tarjeta
        const cardGap = 5; // Espacio entre tarjetas
        const numCards = 3;
        const effectiveWidth = totalAvailableWidth - (cardGap * (numCards - 1));
        const cardWidth = effectiveWidth / numCards;

        const getColorFromStatus = (text) => {
            const lowerText = text.toLowerCase();
            if (lowerText.includes('atrasado') || lowerText.includes('bajo') || lowerText.includes('crítico')) return this.COLORS.accentRed;
            if (lowerText.includes('ligeramente')) return this.COLORS.accentOrange;
            if (lowerText.includes('adelantado') || lowerText.includes('excelente') || lowerText.includes('normal') || lowerText.includes('en tiempo') || lowerText.includes('finalizado')) return this.COLORS.accentGreen;
            return this.COLORS.lightText;
        };

        const parseMetricText = (text) => {
            const match = text.match(/^(.*?)\s*\((.*)\)$/);
            return match ? { status: match[1].trim(), value: `(${match[2].trim()})` } : { status: text, value: '' };
        };

        const svParts = parseMetricText(metrics.scheduleVariance || 'No disponible');
        const spiParts = parseMetricText(metrics.performanceIndex || 'No disponible');
        const projectStatusParts = parseMetricText(metrics.projectStatus || 'No disponible');

        const cardsToDraw = [
            { title: 'Variación Cronograma', status: svParts.status, value: svParts.value, color: getColorFromStatus(metrics.scheduleVariance) },
            { title: 'Rendimiento', status: spiParts.status, value: spiParts.value, color: getColorFromStatus(metrics.performanceIndex) },
            { title: 'Estado Proyecto', status: projectStatusParts.status, value: projectStatusParts.value, color: getColorFromStatus(metrics.projectStatus) }
        ];

        let currentX = startX;
        cardsToDraw.forEach(card => {
            this.doc.setFillColor(this.COLORS.background);
            this.doc.setDrawColor(this.COLORS.border);
            this.doc.roundedRect(currentX, startY, cardWidth, cardHeight, 2, 2, 'FD'); // Radio de borde más pequeño

            this.doc.setFont('helvetica', 'bold');
            this.doc.setFontSize(8); // Aumentado de 7 a 8
            this.doc.setTextColor(this.COLORS.text);
            this.doc.text(card.title, currentX + cardWidth / 2, startY + 6, { align: 'center' });

            this.doc.setFont('helvetica', 'normal');
            this.doc.setFontSize(8); // Aumentado de 6 a 8
            this.doc.setTextColor(card.color);
            this.doc.text(card.status, currentX + cardWidth / 2, startY + 13, { align: 'center' });

            if (card.value) {
                this.doc.setFontSize(7); // Aumentado de 5 a 7
                this.doc.setTextColor(this.COLORS.lightText);
                this.doc.text(card.value, currentX + cardWidth / 2, startY + 19, { align: 'center' });
            }
            currentX += cardWidth + cardGap;
        });
    }
    /**
     * Dibuja un diagrama de Gantt simplificado directamente en el PDF.
     * @param {Array} phases - Las fases del proyecto con sus tareas.
     * @param {Date} projectStartDate - La fecha de inicio del proyecto.
     * @param {Date} projectEndDate - La fecha de fin del proyecto.
     * @param {number} y - La posición Y inicial.
     * @returns {number} - La nueva posición Y final.
     */
    drawGanttChart(phases, projectStartDate, projectEndDate, y) {
        const margin = 15;
        const chartWidth = this.pageWidth - (margin * 2);
        const chartHeight = 120; // Altura fija para el área del Gantt
        const rowHeight = 8;
        const headerHeight = 15;

        // Dibuja el fondo y el borde del área del gráfico
        this.doc.setDrawColor(this.COLORS.border);
        this.doc.setFillColor(this.COLORS.background);
        this.doc.rect(margin, y, chartWidth, chartHeight, 'FD');

        let currentY = y + headerHeight;

        // Calcular la duración total en días para la escala
        const totalDays = (projectEndDate - projectStartDate) / (1000 * 60 * 60 * 24);
        if (totalDays <= 0) return y + chartHeight;

        // Dibujar meses en el encabezado
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(8);
        this.doc.setTextColor(this.COLORS.lightText);
        let month = new Date(projectStartDate);
        while (month <= projectEndDate) {
            const monthStartDay = (month - projectStartDate) / (1000 * 60 * 60 * 24);
            const xPos = margin + (monthStartDay / totalDays) * chartWidth;
            this.doc.text(month.toLocaleDateString('es-ES', { month: 'short' }), xPos, y + 10);
            this.doc.setDrawColor(this.COLORS.border);
            this.doc.line(xPos, y, xPos, y + chartHeight);
            month.setMonth(month.getMonth() + 1);
        }

        // Dibujar fases y tareas
        (phases || []).forEach((phase, phaseIndex) => {
            if (currentY + rowHeight > y + chartHeight) return; // No dibujar si no hay espacio

            // Dibujar nombre de la fase
            this.doc.setFont('helvetica', 'bold');
            this.doc.setFontSize(7);
            this.doc.setTextColor(this.COLORS.primary);
            this.doc.text(phase.name || `Fase ${phaseIndex + 1}`, margin + 2, currentY + rowHeight / 2, { baseline: 'middle' });
            currentY += rowHeight;

            (phase.tasks || []).forEach(task => {
                if (currentY + rowHeight > y + chartHeight) return;

                const taskStart = task.startDate;
                const taskEnd = task.endDate;

                if (!taskStart || !taskEnd) return;

                // Calcular posición y ancho de la barra
                const startDay = (taskStart - projectStartDate) / (1000 * 60 * 60 * 24);
                const durationDays = (taskEnd - taskStart) / (1000 * 60 * 60 * 24) || 1;

                const barX = margin + (startDay / totalDays) * chartWidth;
                const barWidth = (durationDays / totalDays) * chartWidth;

                // Determinar color de la barra
                const isMilestone = task.isMilestone || task.esHito;
                const color = isMilestone ? this.COLORS.accentOrange : this.COLORS.secondary;

                // Dibujar la barra
                this.doc.setFillColor(color);
                this.doc.roundedRect(barX, currentY, barWidth, rowHeight - 2, 1, 1, 'F');

                // Dibujar progreso dentro de la barra
                if (task.completed) {
                    this.doc.setFillColor(this.COLORS.accentGreen);
                    this.doc.roundedRect(barX, currentY, barWidth, rowHeight - 2, 1, 1, 'F');
                }

                // Dibujar nombre de la tarea sobre la barra
                this.doc.setFont('helvetica', 'normal');
                this.doc.setFontSize(6);
                this.doc.setTextColor('#FFFFFF');
                this.doc.text(task.name, barX + 1, currentY + rowHeight / 2, { baseline: 'middle', maxWidth: barWidth - 2 });

                currentY += rowHeight;
            });
        });

        return y + chartHeight;
    }

}

// Asegúrate de incluir este script en tu HTML antes de pdf-generator.js
// <script src="pdf-drawer.js"></script>