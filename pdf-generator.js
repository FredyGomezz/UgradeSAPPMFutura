/**
 * Módulo para la generación de reportes PDF de proyectos.
 * Versión 4.1 - Inyección de dependencia para la Curva S.
 *
 * Esta versión modifica la forma en que se genera la Curva S. En lugar de
 * depender de variables globales o capturas de pantalla, la imagen del gráfico
 * se genera en el momento del clic y se pasa ("inyecta") directamente al
 * generador de PDF. Esto mejora la fiabilidad y desacopla los módulos.
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
 * @param {string} projectId - El ID del proyecto en Firestore.
 * @param {object} db - La instancia de la base de datos de Firestore.
 * @param {object} sCurvePayload - Objeto con los datos para generar la Curva S.
 * @param {object} currentUser - El objeto de usuario autenticado de Firebase.
 */
let isGeneratingPDF = false; // Variable de bloqueo

window.exportProjectToPDF = async function(projectId, db, sCurvePayload, currentUser) {
    if (isGeneratingPDF) {
        console.warn("Ya hay una generación de PDF en proceso. Se ignora esta solicitud.");
        return;
    }
    isGeneratingPDF = true;
    console.log(`[DIAGNÓSTICO 1/4] PDF Generator: Iniciando generación de PDF.`);
    
    try {
        // 1. Obtener los datos frescos del proyecto desde Firestore.
        const projectDoc = await db.collection('projects').doc(projectId).get();
        if (!projectDoc.exists) {
            isGeneratingPDF = false;
            throw new Error('El proyecto no fue encontrado en la base de datos.');
        }
        const projectData = projectDoc.data();

        // 2. Dar un pequeño respiro al navegador para que renderice el canvas del gráfico de Gantt.
        await new Promise(resolve => setTimeout(resolve, 500));

        // 3. Instanciar y ejecutar el generador de PDF.
        // Corrección: La librería jsPDF v2 se carga en window.jspdf.jsPDF.
        // Hacemos el código robusto para que funcione con cualquiera de las dos nomenclaturas.
        const jsPDFConstructor = window.jspdf?.jsPDF || window.jsPDF;

        const generator = new ProjectPDFGenerator(jsPDFConstructor, window.html2canvas);
        await generator.generate(projectData, sCurvePayload, currentUser);

    } catch (error) {
        console.error('Error al generar el PDF:', error);
        isGeneratingPDF = false;
        // Lanzar el error para que sea capturado por el llamador.
        throw new Error(`Ocurrió un error al generar el resumen en PDF: ${error.message}`);
    } finally {
        isGeneratingPDF = false; // Asegurarse de liberar el bloqueo
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
        this.sCurvePayload = null; // Para almacenar los datos de la curva S
        this.reportData = null; // Para almacenar los datos procesados del reporte
        this.drawer = null; // Para la instancia de PDFDrawer
        this.currentUser = null; // Para almacenar el usuario que genera el reporte
    }

    /**
     * Método principal que genera el documento PDF completo.
     * @param {object} projectData - Los datos del proyecto obtenidos de Firestore.
     * @param {object} sCurvePayload - El objeto con la imagen de la Curva S.
     * @param {object} currentUser - El objeto de usuario autenticado.
     */
    async generate(projectData, sCurvePayload, currentUser) {
        this.sCurvePayload = sCurvePayload;
        this.currentUser = currentUser;
        this.doc = new this.jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'letter'
        });

        // 1. Procesar los datos del proyecto
        const dataBuilder = new ReportDataBuilder(projectData);
        this.reportData = dataBuilder.build();
        this.projectData = projectData; // Aún necesario para algunas cosas como el nombre del archivo

        // Inicializar el drawer aquí para que esté disponible para todas las secciones
        this.drawer = new PDFDrawer(this.doc, PDF_COLORS);

        this.pageWidth = this.doc.internal.pageSize.getWidth();
        this.pageHeight = this.doc.internal.pageSize.getHeight();

        // Construir cada sección del PDF en orden.
        await this._buildHeaderAndMetrics();
        this._buildStatusSection(); // Restaurar la sección "¿En qué estamos trabajando?"
        this._buildStatusAndHighlightsSection(); // Mantener la sección de "Hitos Clave"
        
        this._buildPhaseSummarySection();
        // this._buildGanttSection(); // Sección de Gantt eliminada según solicitud.
        
        // Añadir la página de la Curva S en formato horizontal al final.
        await this._buildSCurvePage();

        // Finalizar añadiendo encabezados y pies de página a todas las páginas.
        this._addHeaderAndFooter();

        // Guardar el archivo.
        const projectName = this.projectData.projectName || 'Proyecto_sin_nombre';
        const fileName = `Resumen_${projectName.replace(/\s/g, '_')}.pdf`;
        this.doc.save(fileName);
    }

    // --- MÉTODOS DE CONSTRUCCIÓN DE SECCIONES ---

    /**
     * Construye una página final en orientación horizontal para la Curva S.
     * Ya no necesita ser asíncrono porque la imagen se recibe directamente.
     */    async _buildSCurvePage() {
        this.doc.addPage('letter', 'l');
        const landscapePageSize = this.doc.internal.pageSize;
        const landscapeWidth = landscapePageSize.getWidth();
        const landscapeHeight = landscapePageSize.getHeight(); // Corregido para usar el tamaño de la página horizontal
        this.yPos = 20; // Reset Y position for the new page

        this.drawer.drawSectionHeader('Rendimiento del Proyecto', this.yPos, landscapeWidth);
        this.yPos += 8; // Reducido de 15 a 8

        const sCurveData = this.sCurvePayload?.data;
        const metrics = this.reportData.advancedMetrics;

        // Validación robusta: Asegurarse de que todos los arrays de datos necesarios existan.
        const areDataConsistent = sCurveData &&
                                  sCurveData.dateLabels?.length > 0 &&
                                  sCurveData.plannedPercent?.length > 0 &&
                                  sCurveData.actualPercent?.length > 0;

        if (areDataConsistent) {
            console.log('[PDF Generation] Datos de Curva S recibidos. Procediendo a generar imagen del gráfico...');
            try {
                // 1. Crear un canvas temporal fuera de pantalla
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = 1200; // Alta resolución para una imagen nítida
                tempCanvas.height = 600; // Relación de aspecto 2:1
                const ctx = tempCanvas.getContext('2d');
                
                // 2. Generar el gráfico en el canvas temporal usando una Promise
                const finalImage = await new Promise((resolve, reject) => {
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: sCurveData.dateLabels.map(d => new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })),
                            datasets: [
                                { label: 'Plan - % Progreso', data: sCurveData.plannedPercent, borderColor: PDF_COLORS.secondary, borderDash: [5, 5], tension: 0.1, pointRadius: 0, fill: false },
                                { label: 'Real - % Progreso', data: sCurveData.actualPercent, borderColor: PDF_COLORS.accentGreen, tension: 0.1, pointRadius: 2, fill: false, backgroundColor: PDF_COLORS.accentGreen }
                            ]
                        },
                        options: {
                            responsive: false,
                            animation: {
                                duration: 0, // Forzar renderizado síncrono
                                onComplete: (animation) => {
                                    console.log('[PDF Generation] Chart.js onComplete: Renderizado completo. Capturando imagen...');
                                    const imageUrl = animation.chart.canvas.toDataURL('image/png', 1.0);
                                    setTimeout(() => resolve(imageUrl), 50); // Pequeño delay para asegurar que el buffer de la imagen esté listo.
                                }
                            },
                            plugins: {
                                customCanvasBackgroundColor: { color: 'white' },
                                legend: { position: 'top' },
                                title: { display: true, text: 'Curva S - Progreso Planificado vs. Real', font: { size: 18 } }
                            },
                            scales: { y: { min: 0, max: 100, title: { display: true, text: '% Completado' } } }
                        },
                        plugins: [{
                            id: 'customCanvasBackgroundColor',
                            beforeDraw: (chart, args, options) => {
                                const {ctx} = chart;
                                ctx.save();
                                ctx.globalCompositeOperation = 'destination-over';
                                ctx.fillStyle = options.color || 'white';
                                ctx.fillRect(0, 0, chart.width, chart.height);
                                ctx.restore();
                            }
                        }, {
                            id: 'todayLine',
                            afterDraw: (chart) => {
                                const ctx = chart.ctx;
                                const xAxis = chart.scales.x;
                                const yAxis = chart.scales.y;
                                const today = new Date();
                                const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

                                // Encontrar el índice de la fecha actual en las etiquetas de datos
                                const todayIndex = sCurveData.dateLabels.indexOf(todayStr);

                                if (todayIndex >= 0) {
                                    const x = xAxis.getPixelForValue(todayIndex);
                                    ctx.save();
                                    ctx.beginPath();
                                    ctx.moveTo(x, yAxis.top);
                                    ctx.lineTo(x, yAxis.bottom);
                                    ctx.lineWidth = 1;
                                    ctx.strokeStyle = PDF_COLORS.accentRed; // Rojo discreto
                                    ctx.setLineDash([4, 4]); // Línea punteada
                                    ctx.stroke();
                                    ctx.restore();
                                }
                            }
                        }]
                    });
                });

                if (finalImage.length < 500) {
                    throw new Error("El gráfico generado parece estar en blanco.");
                }
                console.log("[PDF Generation] Imagen de la Curva S generada exitosamente.");

                // Calcular espacio disponible para la imagen y las métricas
                const horizontalMargin = 20; // 20mm a cada lado
                const verticalMargin = 20; // 20mm arriba y abajo
                const metricsSectionHeight = 30; // Altura estimada para la sección de métricas horizontales
                const gapBetweenImageAndMetrics = 10; // Espacio entre la imagen y las métricas

                const availableWidthForContent = landscapeWidth - (horizontalMargin * 2);
                const availableHeightForContent = landscapeHeight - this.yPos - verticalMargin;
                const availableHeightForImage = availableHeightForContent - metricsSectionHeight - gapBetweenImageAndMetrics;

                const chartAspectRatio = 1200 / 600; // Relación de aspecto del canvas temporal (ancho / alto = 2)
                let imgWidth = availableWidthForContent;
                let imgHeight = imgWidth / chartAspectRatio;

                // Ajustar el tamaño de la imagen si excede la altura disponible
                if (imgHeight > availableHeightForImage) {
                    imgHeight = availableHeightForImage;
                    imgWidth = imgHeight * chartAspectRatio;
                }

                // Centrar la imagen horizontal y verticalmente dentro de su espacio
                const chartX = (landscapeWidth - imgWidth) / 2;
                const chartY = this.yPos + ((availableHeightForImage - imgHeight) / 2);

                this.doc.addImage(finalImage, 'PNG', chartX, chartY, imgWidth, imgHeight);

                if (metrics) {
                    const metricsTotalWidth = availableWidthForContent * 0.8; // Usar 80% del ancho disponible para las métricas
                    const metricsX = (landscapeWidth - metricsTotalWidth) / 2; // Centrar las métricas horizontalmente
                    const metricsY = chartY + imgHeight + gapBetweenImageAndMetrics; // Posicionar debajo de la imagen
                    this.drawer.drawHorizontalAdvancedStatusMetrics(metrics, metricsX, metricsY, metricsTotalWidth);
                }

            } catch (error) {
                console.error('Error generando el gráfico de Curva S para el PDF:', error);
                this.doc.setFont('helvetica', 'italic');
                this.doc.setFontSize(12);
                this.doc.setTextColor(PDF_COLORS.accentRed);
                this.doc.text('Error interno al generar el gráfico de la Curva S.', landscapeWidth / 2, this.yPos + 30, { align: 'center' });
            }

        } else {
            // Mensaje de fallback si los datos no son consistentes
            this.doc.setFont('helvetica', 'italic');
            this.doc.setFontSize(12);
            this.doc.setTextColor(PDF_COLORS.accentRed);
            const errorMessage = 'No se pudo generar el gráfico de la Curva S (datos inconsistentes o insuficientes).';
            console.warn(`[PDF Generation] ${errorMessage}`);
            this.doc.text(errorMessage, landscapeWidth / 2, this.yPos + 30, { align: 'center' });
        }
    }

    async _buildHeaderAndMetrics() {
        this.yPos = 15;

        // Logo y Título
        const logo = new Image();
        logo.src = 'logo_2025web.png'; // Asegúrate que la ruta sea correcta
        await new Promise(resolve => { logo.onload = resolve; }); // Esperar a que la imagen cargue para tener sus dimensiones

        // 1. Calcular el ancho del logo manteniendo la relación de aspecto
        const logoHeight = 30;
        const logoAspectRatio = logo.width / logo.height;
        const logoWidth = logoHeight * logoAspectRatio;
        const logoX = (this.pageWidth - logoWidth) / 2; // Centrar el logo

        this.doc.addImage(logo, 'PNG', logoX, this.yPos, logoWidth, logoHeight);
        this.yPos += logoHeight + 8; // Reducido el espacio después del logo (de 15mm a 8mm)

        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(20);
        this.doc.setTextColor(this.drawer.COLORS.primary);
        this.doc.text(this.reportData.projectName, this.pageWidth / 2, this.yPos, { align: 'center' });
        this.yPos += 8; // Reducido el espacio entre el título y las tarjetas (de 12mm a 8mm)

        // Métricas de progreso (calculadas desde los datos)
        this.drawer.drawMetricBoxes(this.reportData.progressMetrics, this.yPos);
        this.yPos += 35; // 2. Más espacio entre las tarjetas y la siguiente sección (ajustado de 25 a 35)
    }

        _buildStatusSection() {
            this.drawer.drawSectionHeader('¿En qué estamos trabajando?', this.yPos);
            this.yPos += 6; // Reducido de 10 a 6
    
            // 1. Definir el layout de 3 columnas
            const pageContentWidth = this.pageWidth - 30; // 15mm de margen a cada lado
            const gap = 5;
            const columnWidth = (pageContentWidth - (gap * 2)) / 3;
    
            const x1 = 15;
            const x2 = x1 + columnWidth + gap;
            const x3 = x2 + columnWidth + gap;
    
            const { currentTask, lastCompletedTask } = this.reportData.highlights;
            const { advancedMetrics } = this.reportData;
    
            this.drawer.drawInfoCard(
                'En Progreso', // Título restaurado
                currentTask,
                this.drawer.COLORS.accentOrange,
                x1, this.yPos, columnWidth
            );
    
            this.drawer.drawInfoCard(
                'Último Completado', // Título restaurado
                lastCompletedTask,
                this.drawer.COLORS.accentGreen,
                x2, this.yPos, columnWidth
            );
    
            console.log(`[DIAGNÓSTICO 2/4] PDF Generator: Se usarán estas métricas para dibujar:`, advancedMetrics);
            this.drawer.drawAdvancedStatusMetrics(advancedMetrics, x3, this.yPos, columnWidth);
    
            this.yPos += 65;
        }

    _buildStatusAndHighlightsSection() {
        this.drawer.drawSectionHeader('Estado y Puntos Clave', this.yPos);
        this.yPos += 6; // Reducido de 10 a 6
        this.drawer.drawHighlights(this.reportData.highlights, this.yPos);
        this.yPos += 40; // Aumentado de 25 a 40 para dar espacio a la lista de tareas
    }

    _buildPhaseSummarySection() {
        this.drawer.drawSectionHeader('Resumen por Fases', this.yPos);
        this.yPos += 6; // Reducido de 10 a 6
        const finalY = this.drawer.drawTable([['Fase', 'Tareas', 'Horas', 'Progreso']], this.reportData.phaseSummary, this.yPos);
        this.yPos = finalY + 10;
    }


    // --- MÉTODOS DE DIBUJO Y ESTILO ---

    _addHeaderAndFooter() {
        const pageCount = this.doc.internal.getNumberOfPages();
        const generationDate = new Date();
        const formattedDate = generationDate.toLocaleDateString('es-ES');
        const formattedTime = generationDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const userEmail = this.currentUser ? this.currentUser.email : 'Usuario Desconocido';

        for (let i = 1; i <= pageCount; i++) {
            this.doc.setPage(i);
            
            const currentPageWidth = this.doc.internal.pageSize.getWidth();
            const currentPageHeight = this.doc.internal.pageSize.getHeight();

            // Encabezado
            this.doc.setFontSize(10);
            this.doc.setTextColor(this.drawer.COLORS.lightText);
            this.doc.text(this.reportData.projectName, 15, 10);
            this.doc.text(`Fecha: ${formattedDate}`, currentPageWidth - 15, 10, { align: 'right' });
            this.doc.setDrawColor(this.drawer.COLORS.border);
            this.doc.line(15, 12, currentPageWidth - 15, 12);

            // Pie de página
            this.doc.setFontSize(8);
            this.doc.text(`Generado por: ${userEmail} el ${formattedDate} a las ${formattedTime}`, 15, currentPageHeight - 8);
            this.doc.text(`Página ${i} de ${pageCount}`, currentPageWidth - 15, currentPageHeight - 8, { align: 'right' });
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

    // --- MÉTODOS DE CÁLCULO (LÓGICA DE NEGOCIO) ---
    // Todos los métodos _calculate... y _get... se han movido a ReportDataBuilder

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

    _normalizeTask(raw) {
        const startDate = this._parseDate(raw.startDate);
        const endDate = this._parseDate(raw.endDate);
        const completedAt = this._parseDate(raw.completedAt);
        return {
            ...raw,
            startDate,
            endDate,
            completedAt,
        };
    }

    _parseDate(dateValue) {
        if (!dateValue) return null;
        if (dateValue instanceof Date) return dateValue;
        if (typeof dateValue.toDate === 'function') return dateValue.toDate(); // Timestamp de Firestore
        const d = new Date(dateValue);
        return isNaN(d.getTime()) ? null : d;
    }
}
