require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// Initialize Firebase Admin
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});

const db = admin.firestore();

// Initialize Gmail SMTP transporter
let gmailTransporter;
let gmailWorking = false;

(async () => {
  try {
    console.log('🔍 Initializing Gmail SMTP transporter...');

    gmailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    // Test the connection
    await gmailTransporter.verify();
    gmailWorking = true;
    console.log('✅ Gmail SMTP initialized and working correctly');
  } catch (error) {
    console.error('❌ Gmail SMTP initialization failed:', error.message);
    console.log('⚠️ Gmail not working - notifications will fail');
    gmailWorking = false;
  }
})();

const app = express();
const PORT = 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:8000', 'http://192.168.0.104:8000'], // Allow local development
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Email validation helper
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Diagnostic endpoint for Gmail
app.get('/api/diagnostic/gmail', async (req, res) => {
  try {
    console.log('🔍 Running Gmail SMTP diagnostic...');

    // Check credentials
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    const hasCredentials = !!(user && pass);

    console.log('🔍 Gmail credentials check:', {
      user: user ? user.substring(0, 10) + '...' : 'none',
      hasPassword: !!pass,
      passwordLength: pass ? pass.length : 0
    });

    // Try to send a test email
    const testMsg = {
      from: `"PDT Futura Diagnostic" <${user}>`,
      to: user, // Send to self for testing
      subject: 'Gmail SMTP Diagnostic Test',
      text: 'This is a diagnostic test email to verify Gmail SMTP configuration.',
      html: '<p>This is a diagnostic test email to verify Gmail SMTP configuration.</p>'
    };

    console.log('🔍 Attempting to send diagnostic email...');
    const sendResult = await gmailTransporter.sendMail(testMsg);
    console.log('✅ Diagnostic email sent successfully:', sendResult);

    res.json({
      status: 'OK',
      diagnostic: {
        credentials: {
          hasUser: !!user,
          hasPassword: !!pass,
          userPrefix: user ? user.substring(0, 10) + '...' : 'none'
        },
        testEmail: {
          sent: true,
          messageId: sendResult.messageId
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Gmail SMTP diagnostic failed:', error);

    res.status(500).json({
      status: 'ERROR',
      diagnostic: {
        credentials: {
          hasUser: !!process.env.GMAIL_USER,
          hasPassword: !!process.env.GMAIL_APP_PASSWORD
        },
        testEmail: {
          sent: false,
          error: {
            message: error.message,
            code: error.code
          }
        }
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Get notification system status
app.get('/api/notifications/status', (req, res) => {
  res.json({
    gmailWorking,
    testMode: process.env.TEST_MODE === 'true',
    timestamp: new Date().toISOString()
  });
});

// Get notification queue status
app.get('/api/notifications/queue', async (req, res) => {
  try {
    const queueSnapshot = await db.collection('notification_queue')
      .where('status', '==', 'failed')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const queuedNotifications = [];
    queueSnapshot.forEach(doc => {
      queuedNotifications.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()?.toISOString()
      });
    });

    res.json({
      success: true,
      queuedCount: queuedNotifications.length,
      notifications: queuedNotifications
    });

  } catch (error) {
    console.error('Error fetching notification queue:', error);
    res.status(500).json({ error: 'Failed to fetch notification queue', details: error.message });
  }
});

// Retry failed notifications
app.post('/api/notifications/retry/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notificationDoc = await db.collection('notification_queue').doc(notificationId).get();
    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notification = notificationDoc.data();

    // Try to resend the notification
    try {
      await sendTaskCompletedNotification(
        notification.projectData,
        notification.report,
        notification.authorizedEmails,
        notification.userData
      );

      // Update notification status
      await db.collection('notification_queue').doc(notificationId).update({
        status: 'completed',
        completedAt: admin.firestore.Timestamp.now(),
        retryCount: (notification.retryCount || 0) + 1
      });

      res.json({ success: true, message: 'Notification resent successfully' });

    } catch (sendError) {
      // Update retry count
      await db.collection('notification_queue').doc(notificationId).update({
        retryCount: (notification.retryCount || 0) + 1,
        lastError: sendError.message,
        lastRetryAt: admin.firestore.Timestamp.now()
      });

      res.status(500).json({
        error: 'Failed to resend notification',
        details: sendError.message
      });
    }

  } catch (error) {
    console.error('Error retrying notification:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Notification endpoints
app.post('/api/notify/new-user', async (req, res) => {
  try {
    const { userData } = req.body;

    if (!userData || !userData.email) {
      return res.status(400).json({ error: 'Missing userData with email' });
    }

    console.log(`📋 Processing new user notification for ${userData.email}`);

    // Send notification to admins
    const adminEmails = ['admin@gnce.com', 'gomez.fredy.sap@gmail.com'];
    await sendNewUserNotification(userData, adminEmails);

    res.json({
      success: true,
      message: 'New user notification sent successfully'
    });

  } catch (error) {
    console.error('❌ Error processing new user notification:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.post('/api/notify/user-added-to-project', async (req, res) => {
  try {
    const { projectData, newUser, addedBy } = req.body;

    if (!projectData || !newUser || !addedBy) {
      return res.status(400).json({ error: 'Missing required fields: projectData, newUser, addedBy' });
    }

    console.log(`📋 Processing user added to project notification for ${newUser.email} in ${projectData.name}`);

    // Get authorized emails for the project
    const recipients = await getProjectAuthorizedEmails(projectData.id);
    await sendUserAddedToProjectNotification(projectData, newUser, addedBy, recipients);

    res.json({
      success: true,
      message: 'User added to project notification sent successfully'
    });

  } catch (error) {
    console.error('❌ Error processing user added to project notification:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.post('/api/notify/task-completed', async (req, res) => {
  try {
    const { projectId, taskId, userId, taskData, completerData, html, to, subject } = req.body;

    if (!projectId || !taskId || !userId) {
      return res.status(400).json({ error: 'Missing required fields: projectId, taskId, userId' });
    }

    console.log(`📋 Processing task completion notification for project ${projectId}, task ${taskId}`);

    // If HTML is provided, use it directly (from notification-service.js)
    if (html && to && subject) {
      console.log('📧 Using pre-generated HTML from notification service');

      const mailOptions = {
        from: `"PDT Futura" <${process.env.GMAIL_USER}>`,
        to: to,
        subject: subject,
        html: html
      };

      try {
        const result = await gmailTransporter.sendMail(mailOptions);
        console.log('📧 Task completed notification sent successfully using pre-generated HTML');
        return res.json({
          success: true,
          message: 'Task completion notification sent successfully'
        });
      } catch (emailError) {
        console.error('❌ Error sending email with pre-generated HTML:', emailError);
        throw emailError;
      }
    }

    // Fallback to original logic if no HTML provided
    // Get project data
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectData = projectDoc.data();

    // Use provided task and completer data
    const taskInfo = taskData || {};
    const completerInfo = completerData || {};

    // Generate project report
    const report = await generateProjectReport(projectData);

    // Get authorized emails
    const authorizedEmails = await getProjectAuthorizedEmails(projectId);

    if (authorizedEmails.length === 0) {
      return res.status(400).json({ error: 'No authorized emails found for this project' });
    }

    // Send notification
    await sendTaskCompletedNotification(projectData, report, authorizedEmails, taskInfo, completerInfo);

    res.json({
      success: true,
      message: 'Task completion notification sent successfully'
    });

  } catch (error) {
    console.error('❌ Error processing task completion notification:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Helper functions
async function getProjectAuthorizedEmails(projectId) {
  try {
    const projectDoc = await db.collection('projects').doc(projectId).get();

    if (!projectDoc.exists) {
      return [];
    }

    const projectData = projectDoc.data();
    const authorizedUsers = projectData.authorizedUsers || [];

    const emails = [];
    for (const user of authorizedUsers) {
      // If user is an object with email, use it directly
      if (typeof user === 'object' && user && user.email) {
        emails.push(user.email);
      } else if (typeof user === 'string') {
        // If user is a string, treat it as user ID and look it up
        try {
          const userDoc = await db.collection('users').doc(user).get();
          if (userDoc.exists && userDoc.data().email) {
            emails.push(userDoc.data().email);
          }
        } catch (lookupError) {
          // Ignore lookup errors
        }
      }
    }

    const validEmails = emails.filter(email => validateEmail(email));
    return validEmails;
  } catch (error) {
    console.error('❌ Backend: Error obteniendo usuarios autorizados:', error);
    return [];
  }
}

async function generateProjectReport(projectData) {
  // Calculate project metrics
  let totalTasks = 0;
  let completedTasks = 0;
  let totalHours = 0;
  let completedHours = 0;

  if (projectData.phases && Array.isArray(projectData.phases)) {
    projectData.phases.forEach(phase => {
      if (phase.tasks && Array.isArray(phase.tasks)) {
        phase.tasks.forEach(task => {
          totalTasks++;
          totalHours += parseFloat(task.durationHours) || 0;
          if (task.completed) {
            completedTasks++;
            completedHours += parseFloat(task.durationHours) || 0;
          }
        });
      }
    });
  }

  const progressPercentage = totalHours > 0 ? (completedHours / totalHours) * 100 : 0;

  return {
    totalTasks,
    completedTasks,
    totalHours: Math.round(totalHours),
    completedHours: Math.round(completedHours),
    progressPercentage: Math.round(progressPercentage),
    projectName: projectData.name || 'Proyecto sin nombre'
  };
}

async function sendNewUserNotification(userData, recipients) {
  console.log('📧 Sending new user notification...');
  console.log('📧 Recipients:', recipients);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .user-info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🆕 Nuevo Usuario Registrado</h1>
                <p>Sistema PDT Futura</p>
            </div>
            <div class="content">
                <h2>Datos del Nuevo Usuario</h2>
                <div class="user-info">
                    <p><strong>Nombre:</strong> ${userData.displayName || 'No especificado'}</p>
                    <p><strong>Email:</strong> ${userData.email}</p>
                    <p><strong>Fecha de Registro:</strong> ${new Date().toLocaleString('es-ES')}</p>
                </div>
                <p>Por favor, verifique la información y confirme el acceso del usuario al sistema.</p>
            </div>
            <div class="footer">
                <p>PDT Futura - Sistema de Gestión de Proyectos</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"PDT Futura" <${process.env.GMAIL_USER}>`,
    to: recipients,
    subject: `🆕 Nuevo Usuario Registrado - ${userData.displayName || userData.email}`,
    html: htmlContent
  };

  try {
    const result = await gmailTransporter.sendMail(mailOptions);
    console.log('📧 New user notification sent successfully');
    return result;
  } catch (error) {
    console.error('❌ Error sending new user notification:', error);
    throw error;
  }
}

async function sendUserAddedToProjectNotification(projectData, newUser, addedBy, recipients) {
  console.log('📧 Sending user added to project notification...');
  console.log('📧 Recipients:', recipients);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .project-info, .user-info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>👥 Usuario Agregado al Proyecto</h1>
                <p>Sistema PDT Futura</p>
            </div>
            <div class="content">
                <div class="project-info">
                    <h3>Información del Proyecto</h3>
                    <p><strong>Proyecto:</strong> ${projectData.name || 'Sin nombre'}</p>
                    <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
                </div>
                <div class="user-info">
                    <h3>Nuevo Usuario Autorizado</h3>
                    <p><strong>Nombre:</strong> ${newUser.displayName || newUser.name || 'No especificado'}</p>
                    <p><strong>Email:</strong> ${newUser.email}</p>
                    <p><strong>Rol:</strong> ${newUser.role || 'Usuario'}</p>
                </div>
                <div class="user-info">
                    <h3>Agregado por</h3>
                    <p><strong>Nombre:</strong> ${addedBy.displayName || addedBy.name || 'Sistema'}</p>
                    <p><strong>Email:</strong> ${addedBy.email}</p>
                </div>
            </div>
            <div class="footer">
                <p>PDT Futura - Sistema de Gestión de Proyectos</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"PDT Futura" <${process.env.GMAIL_USER}>`,
    to: recipients,
    subject: `👥 Nuevo Usuario en Proyecto: ${projectData.name || 'Proyecto'}`,
    html: htmlContent
  };

  try {
    const result = await gmailTransporter.sendMail(mailOptions);
    console.log('📧 User added to project notification sent successfully');
    return result;
  } catch (error) {
    console.error('❌ Error sending user added to project notification:', error);
    throw error;
  }
}

async function sendTaskCompletedNotification(projectData, report, emails, taskInfo, completerInfo) {
  console.log('📧 Sending task completed notification...');
  console.log('📧 Recipients:', emails);

  // Calculate project dates and metrics using the same logic as vistaProyecto.html
  const projectStartDate = projectData.startDate && typeof projectData.startDate.toDate === 'function' ?
    projectData.startDate.toDate() : new Date(projectData.startDate);

  let projectEndDate = new Date(projectStartDate);
  let durationDays = 0;

  if (projectData.phases && projectData.phases.length > 0) {
    const lastPhase = projectData.phases[projectData.phases.length - 1];
    if (lastPhase.tasks && lastPhase.tasks.length > 0) {
      const lastTask = lastPhase.tasks[lastPhase.tasks.length - 1];
      if (lastTask.endDate) {
        projectEndDate = lastTask.endDate && typeof lastTask.endDate.toDate === 'function' ?
          lastTask.endDate.toDate() : new Date(lastTask.endDate);
        durationDays = Math.ceil((projectEndDate - projectStartDate) / (1000 * 60 * 60 * 24));
      }
    }
  }

  const lastUpdate = projectData.lastUpdated && typeof projectData.lastUpdated.toDate === 'function' ?
    projectData.lastUpdated.toDate() : (projectData.lastUpdated ? new Date(projectData.lastUpdated) : new Date());

  // Calculate S-curve metrics using the same logic as vistaProyecto.html
  let tasks = [];
  if (projectData.phases && Array.isArray(projectData.phases)) {
    projectData.phases.forEach(phase => {
      if (phase.tasks && Array.isArray(phase.tasks)) {
        phase.tasks.forEach(task => tasks.push(task));
      }
    });
  }
  tasks = tasks.filter(t => t.startDate).sort((a, b) => {
    const aDate = a.endDate && typeof a.endDate.toDate === 'function' ? a.endDate.toDate() : new Date(a.endDate || a.startDate);
    const bDate = b.endDate && typeof b.endDate.toDate === 'function' ? b.endDate.toDate() : new Date(b.endDate || b.startDate);
    return aDate - bDate;
  });

  const totalTasks = tasks.length;
  const totalHours = tasks.reduce((sum, t) => sum + (parseFloat(t.durationHours) || 0), 0);

  // Calculate planned vs actual progress
  const projectEnd = tasks[tasks.length - 1].endDate && typeof tasks[tasks.length - 1].endDate.toDate === 'function' ?
    tasks[tasks.length - 1].endDate.toDate() : new Date(tasks[tasks.length - 1].endDate);

  const dateLabels = [];
  const currentDate = new Date(projectStartDate);
  while (currentDate <= projectEnd) {
    dateLabels.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Calculate planned progress
  const plannedPercent = [];
  dateLabels.forEach(dateStr => {
    const currentDate = new Date(dateStr + 'T00:00:00');
    let tasksCompletedByDate = 0;
    tasks.forEach(task => {
      const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
      if (taskEnd <= currentDate) {
        tasksCompletedByDate++;
      }
    });
    plannedPercent.push(Math.min(100, (tasksCompletedByDate / totalTasks) * 100));
  });

  // Calculate actual progress
  const actualPercent = [];
  dateLabels.forEach(dateStr => {
    const currentDate = new Date(dateStr + 'T00:00:00');
    let actualTasksCompleted = 0;
    tasks.forEach(task => {
      if (task.completed) {
        const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);
        if (taskEnd <= currentDate) {
          actualTasksCompleted++;
        }
      }
    });
    actualPercent.push(Math.min(100, (actualTasksCompleted / totalTasks) * 100));
  });

  // Calculate SPI and project status
  const today = new Date();
  const todayIndex = dateLabels.findIndex(dateStr => dateStr >= today.toISOString().split('T')[0]);
  const currentIndex = todayIndex >= 0 ? todayIndex : dateLabels.length - 1;

  const currentPlannedPct = plannedPercent[currentIndex] || 0;
  const currentActualPct = actualPercent[currentIndex] || 0;

  const projectHasStarted = today >= projectStartDate || tasks.some(task => task.completed);

  let scheduleStatus, performanceStatus, projectStatus, scheduleVariance, spi;

  if (!projectHasStarted) {
    scheduleStatus = 'No iniciado';
    performanceStatus = 'No iniciado';
    projectStatus = 'No iniciado';
    scheduleVariance = 0;
    spi = 0;
  } else {
    scheduleVariance = currentActualPct - currentPlannedPct;
    const scheduleVarianceAbs = Math.abs(scheduleVariance);

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

  // Generate simple Gantt chart HTML
  let ganttHtml = '<div style="font-family: Arial, sans-serif; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin: 20px 0;">';
  ganttHtml += '<div style="background: #f8f9fa; padding: 10px; font-weight: bold; border-bottom: 1px solid #ddd;">Diagrama de Gantt - Cronograma de Tareas</div>';

  if (projectData.phases && Array.isArray(projectData.phases)) {
    const phaseColors = ['#667eea', '#764ba2', '#28a745', '#ffc107', '#e74c3c'];
    const totalDays = Math.ceil((projectEndDate - projectStartDate) / (1000 * 60 * 60 * 24)) + 1;
    const dayWidth = Math.max(2, Math.min(10, 400 / totalDays)); // Adaptive width

    projectData.phases.forEach((phase, phaseIndex) => {
      if (phase.tasks && Array.isArray(phase.tasks)) {
        phase.tasks.forEach((task, taskIndex) => {
          const taskStart = task.startDate && typeof task.startDate.toDate === 'function' ? task.startDate.toDate() : new Date(task.startDate);
          const taskEnd = task.endDate && typeof task.endDate.toDate === 'function' ? task.endDate.toDate() : new Date(task.endDate);

          if (taskStart && taskEnd && !isNaN(taskStart.getTime()) && !isNaN(taskEnd.getTime())) {
            const startOffset = Math.ceil((taskStart - projectStartDate) / (1000 * 60 * 60 * 24));
            const duration = Math.ceil((taskEnd - taskStart) / (1000 * 60 * 60 * 24)) + 1;
            const leftPx = startOffset * dayWidth;
            const widthPx = duration * dayWidth;

            const barColor = task.completed ? '#28a745' : phaseColors[phaseIndex % phaseColors.length];
            const taskName = `${taskIndex + 1}. ${task.name || 'Tarea sin nombre'}`;

            ganttHtml += `<div style="display: flex; padding: 4px 10px; border-bottom: 1px solid #eee; align-items: center;">`;
            ganttHtml += `<div style="width: 200px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${taskName}</div>`;
            ganttHtml += `<div style="flex: 1; position: relative; height: 20px; background: #f5f5f5;">`;
            ganttHtml += `<div style="position: absolute; left: ${leftPx}px; width: ${widthPx}px; height: 100%; background: ${barColor}; border-radius: 3px;"></div>`;
            ganttHtml += `</div></div>`;
          }
        });
      }
    });
  }
  ganttHtml += '</div>';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 30px; }
            .project-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
            .task-info { background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
            .metric-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
            .metric-value { font-size: 2rem; font-weight: bold; color: #495057; margin-bottom: 8px; }
            .metric-label { font-size: 0.9rem; color: #6c757d; }
            .s-curve-section { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6f42c1; }
            .gantt-container { margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; padding: 20px; background: #f8f9fa; }
            .status-indicator { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: bold; }
            .status-on-time { background: #d4edda; color: #155724; }
            .status-ahead { background: #d1ecf1; color: #0c5460; }
            .status-behind { background: #f8d7da; color: #721c24; }
            .status-completed { background: #d4edda; color: #155724; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎯 Tarea Completada</h1>
                <h2>${projectData.name || projectData.projectName || 'Proyecto sin nombre'}</h2>
                <p>La tarea "${taskInfo.name || 'Sin nombre'}" con duración ${taskInfo.durationHours || 0} horas, ha sido completada.</p>
            </div>
            <div class="content">
                <div class="task-info">
                    <h3>Información de la Tarea Completada</h3>
                    <p><strong>Tarea:</strong> ${taskInfo.name || 'Sin nombre'}</p>
                    <p><strong>Duración:</strong> ${taskInfo.durationHours || 0} horas</p>
                    <p><strong>Completado por:</strong> ${completerInfo.email || completerInfo.displayName || 'Usuario desconocido'}</p>
                    <p><strong>Fecha de completado:</strong> ${new Date().toLocaleString('es-ES')}</p>
                </div>

                <div class="project-info">
                    <h3>Información del Proyecto</h3>
                    <p><strong>Proyecto:</strong> ${projectData.name || projectData.projectName || 'Proyecto sin nombre'}</p>
                    <p><strong>Inicio:</strong> ${projectStartDate.toLocaleDateString('es-ES')}</p>
                    <p><strong>Fin Estimado:</strong> ${projectEndDate.toLocaleDateString('es-ES')}</p>
                    <p><strong>Duración:</strong> ${durationDays} días</p>
                    <p><strong>Última Actualización:</strong> ${lastUpdate.toLocaleString('es-ES')}</p>
                </div>

                <h3>Progreso General del Proyecto: ${Math.round((report.completedHours / report.totalHours) * 100) || 0}%</h3>
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-value">${report.totalTasks}</div>
                        <div class="metric-label">Total de Tareas</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${report.completedTasks}</div>
                        <div class="metric-label">Tareas Completadas</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${Math.round(report.totalHours)}</div>
                        <div class="metric-label">Total de Horas</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${Math.round(report.completedHours)}</div>
                        <div class="metric-label">Horas Completadas</div>
                    </div>
                </div>

                <div class="s-curve-section">
                    <h3>Curva S - Estado del Proyecto</h3>
                    <div class="metrics-grid">
                        <div class="metric-card">
                            <div class="metric-value ${scheduleVariance > 5 ? 'status-ahead' : scheduleVariance < -5 ? 'status-behind' : 'status-on-time'}" style="font-size: 1.2rem;">
                                ${scheduleStatus} ${projectHasStarted ? `(${scheduleVariance > 0 ? '+' : ''}${Math.round(scheduleVariance)}%)` : ''}
                            </div>
                            <div class="metric-label">Variación de Cronograma</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value ${spi > 1.1 ? 'status-ahead' : spi < 0.9 ? 'status-behind' : 'status-on-time'}" style="font-size: 1.2rem;">
                                ${performanceStatus} ${projectHasStarted ? `(SPI: ${spi.toFixed(2)})` : ''}
                            </div>
                            <div class="metric-label">Índice de Rendimiento</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value status-${projectStatus.toLowerCase().replace(' ', '-')}" style="font-size: 1.2rem;">
                                ${projectStatus}
                            </div>
                            <div class="metric-label">Estado del Proyecto</div>
                        </div>
                    </div>
                </div>

                <div class="gantt-container">
                    <h3>Diagrama de Gantt</h3>
                    ${ganttHtml}
                </div>

                <p>Este es un recordatorio automático del progreso del proyecto. Manténganse al día con las actualizaciones!</p>
            </div>
            <div class="footer">
                <p>PDT Futura - Sistema de Gestión de Proyectos</p>
                <p>Este email fue enviado automáticamente. Por favor, no responda directamente.</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"PDT Futura" <${process.env.GMAIL_USER}>`,
    to: emails,
    subject: `🎯 Tarea Completada - ${projectData.name || projectData.projectName || 'Proyecto'} - ${taskInfo.name || 'Tarea'}`,
    html: htmlContent
  };

  try {
    const result = await gmailTransporter.sendMail(mailOptions);
    console.log('📧 Task completed notification sent successfully to', emails.length, 'recipients');
    return result;
  } catch (error) {
    console.error('❌ Error sending task completed notification:', error);
    throw error;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PDT Futura Backend Server running on port ${PORT}`);
  console.log(`🧪 Test Mode: ${process.env.TEST_MODE === 'true' ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🔥 Firebase initialized: ${process.env.TEST_MODE === 'true' ? 'SIMULATED' : (admin.apps.length > 0 ? 'YES' : 'NO')}`);
  console.log(`📧 Gmail SMTP initialized: ${process.env.TEST_MODE === 'true' ? 'SIMULATED' : (gmailWorking ? 'YES' : 'NO')}`);
  console.log('✅ Server startup complete');
});

module.exports = app;