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